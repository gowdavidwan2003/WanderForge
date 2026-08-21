import { NextResponse } from 'next/server';
import { groqChatCompletion } from '@/lib/groq';
import { REALISM_RULES, preferencesBlock } from '@/lib/itineraryPrompt';
import { requireUser } from '@/lib/api/requireUser';
import { clampRequestedDays } from '@/lib/tripLimits';
import { validateItinerary, validationRetryPrompt } from '@/lib/itinerarySchema';
import { geocodeItinerary } from '@/lib/placeLookup';
import {
  blockingIssues,
  checkGeneratedItinerary,
  conflictPayload,
  conflictRetryPrompt,
} from '@/lib/conflictReport';
import {
  MIN_COMPLETION_MS,
  MIN_GEOCODE_MS,
  createBudget,
} from '@/lib/aiBudget';

// Groq can sit on a connection well past a serverless default. Declaring the
// ceiling makes the timeout ours to control rather than the platform's, and
// aiBudget divides it between the completions, the geocoding and the check.
export const maxDuration = 60;

const MODEL = 'llama-3.3-70b-versatile';

/**
 * The response shape, stated once.
 *
 * Trimmed of the hand-tuned "then verify each day hour by hour, is there enough
 * time to get from A to B" arithmetic that used to live here. A language model
 * cannot reliably do that arithmetic, and asking it to only made the output more
 * confident, not more correct. conflictChecker does it with real road distances
 * after the fact, and names what it finds back to the model — see below. The
 * realism *rules* stay (in REALISM_RULES) because they shape what the model
 * chooses; the self-marking does not.
 */
const FORMAT_BLOCK = `RESPOND IN THIS EXACT JSON FORMAT (no other text, just JSON):
{
  "itinerary": [
    {
      "day": 1,
      "theme": "Day theme name",
      "activities": [
        {
          "title": "Activity name",
          "description": "Brief description and what makes it special",
          "location_name": "Specific location/address",
          "category": "sightseeing|food|transport|accommodation|adventure|shopping|nightlife|culture|nature|relaxation|other",
          "start_time": "09:00",
          "end_time": "11:00",
          "cost": 0,
          "notes": "Practical tips, best time, etc.",
          "booking_link": ""
        }
      ]
    }
  ],
  "summary": "Brief trip summary",
  "estimated_total_cost": 0,
  "currency": "local currency code",
  "pro_tips": ["tip1", "tip2", "tip3"]
}

Field rules, enforced on receipt:
- start_time and end_time: 24-hour "HH:MM" strings only. Never "9am", "TBD", "morning" or a range.
- end_time must be strictly later than start_time.
- category: exactly one of the eleven values listed above, nothing else.
- cost: a plain number in local currency units. No symbols, no commas, no words.`;

/**
 * Ask Groq once and get back parsed JSON, or the reason we cannot.
 *
 * Separates three outcomes the caller treats very differently: a provider
 * failure (give up, retrying costs quota and fails the same way), a malformed
 * response (retryable, and the model can be told what went wrong), and success.
 */
async function requestItinerary(messages, { budget, userApiKey }) {
  const result = await groqChatCompletion(
    {
      model: MODEL,
      messages,
      // Lower temperature keeps distance and duration estimates grounded rather
      // than creative. No max_tokens: it capped long itineraries, and Groq
      // reserves the full value against the per-minute token limit up front,
      // which was causing spurious rate-limit errors on back-to-back requests.
      temperature: 0.4,
      response_format: { type: 'json_object' },
    },
    { userApiKey, budgetMs: budget.completionSlice() }
  );

  if (!result.ok) {
    return { failure: NextResponse.json({ error: result.error }, { status: result.status }) };
  }

  const choice = result.data.choices?.[0];
  const content = choice?.message?.content;

  if (!content) {
    return { failure: NextResponse.json({ error: 'No response from AI' }, { status: 500 }) };
  }

  // Full-day itineraries are long. If the model hit the token ceiling the JSON is
  // cut off mid-object, so report that plainly instead of a bare parse error.
  if (choice.finish_reason === 'length') {
    return {
      failure: NextResponse.json(
        { error: 'The itinerary was too long to finish. Try generating fewer days at a time.' },
        { status: 502 }
      ),
    };
  }

  try {
    return { raw: JSON.parse(content), content };
  } catch {
    return {
      content,
      errors: ['response: was not valid JSON at all. Return a single JSON object and nothing else.'],
    };
  }
}

export async function POST(request) {
  // These routes spend the operator's Google and Groq quota, so they must
  // not be callable anonymously.
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const budget = createBudget();

  try {
    const body = await request.json();
    const {
      destination,
      days: requestedDays,
      interests = [],
      transportMode = 'mixed',
      budgetLevel = 'moderate',
      notes = '',
      userApiKey,
      destLat,
      destLng,
      totalBudget,
    } = body;

    // `days` is attacker-controlled and drives both cost centres: one AI day per
    // day, then one geocode per activity the model returns.
    const days = clampRequestedDays(requestedDays);

    // Biasing place lookups toward the destination is what stops "District
    // Museum" resolving to a same-named place on the other side of the country —
    // and a wrong coordinate makes the travel-time check worse than no check.
    const near =
      Number.isFinite(Number(destLat)) && Number.isFinite(Number(destLng))
        ? { lat: Number(destLat), lng: Number(destLng) }
        : null;

    const userPrompt = `Create a detailed ${days}-day itinerary for ${destination}.

${preferencesBlock({ transportMode, budgetLevel, interests, notes })}

Plan each of the ${days} days to make good use of the day, but ONLY with activities that are genuinely achievable given real travel times between the specific places you choose. Include meals at natural times.

${FORMAT_BLOCK}`;

    const messages = [
      { role: 'system', content: REALISM_RULES },
      { role: 'user', content: userPrompt },
    ];

    // ---- 1. A response that matches the contract -------------------------
    // Nothing reaches Postgres until this passes. Previously JSON.parse was the
    // entire contract, so "9am" in a TIME column or "TBD" in a CHECK-constrained
    // category was rejected row by row, halfway through writing the trip.
    let plan = null;
    let errors = null;
    let lastContent = null;
    let completions = 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        // One retry, and only if there is time for it. Returning the failure is
        // better than being killed mid-flight with no response body at all.
        if (!budget.canAfford(MIN_COMPLETION_MS)) break;

        // The model needs its own previous answer in context for the error paths
        // ("itinerary[0].activities[2].start_time") to mean anything. It costs a
        // second copy of the itinerary in tokens; a partially written trip costs
        // more.
        if (lastContent) messages.push({ role: 'assistant', content: lastContent });
        messages.push({ role: 'user', content: validationRetryPrompt(errors) });
      }

      const res = await requestItinerary(messages, { budget, userApiKey });
      completions++;

      // A provider error is not something a retry fixes — it fails identically
      // while burning the budget.
      if (res.failure) return res.failure;

      lastContent = res.content ?? null;

      if (res.errors) {
        errors = res.errors;
        continue;
      }

      const validated = validateItinerary(res.raw, { days });
      if (validated.ok) {
        plan = validated.data;
        errors = null;
        break;
      }

      errors = validated.errors;
      console.warn(
        `[WanderForge] Generated itinerary failed validation (attempt ${attempt + 1}): ${errors.slice(0, 5).join('; ')}`
      );
    }

    if (!plan) {
      return NextResponse.json(
        {
          error:
            'The AI returned an itinerary in a shape we could not use, twice. Nothing was saved — please try again.',
          details: errors ?? [],
        },
        { status: 502 }
      );
    }

    // ---- 2. Coordinates, then the deterministic check ---------------------
    // The checker's central question — can you actually get from this place to
    // that one in the gap left for it — needs coordinates, and geocoding used to
    // happen in the browser only after everything had been written.
    const tripShape = {
      transport_mode: transportMode,
      total_budget: Number(totalBudget) || null,
      currency: plan.currency || '',
    };

    let geo = { itinerary: plan.itinerary, located: 0, total: 0, coords: new Map() };
    if (budget.canAfford(MIN_GEOCODE_MS)) {
      geo = await geocodeItinerary(plan.itinerary, { near, deadlineAt: budget.deadlineAt() });
    }

    let check = checkGeneratedItinerary(geo.itinerary, tripShape);

    // ---- 3. One re-prompt naming the conflicts ---------------------------
    const conflictPrompt = conflictRetryPrompt(check.issues);
    if (conflictPrompt && budget.canAfford(MIN_COMPLETION_MS)) {
      if (lastContent) messages.push({ role: 'assistant', content: lastContent });
      messages.push({ role: 'user', content: conflictPrompt });

      const res = await requestItinerary(messages, { budget, userApiKey });
      completions++;

      if (!res.failure && !res.errors) {
        const revalidated = validateItinerary(res.raw, { days });
        if (revalidated.ok) {
          const reGeo = budget.canAfford(MIN_GEOCODE_MS)
            ? await geocodeItinerary(revalidated.data.itinerary, {
                near,
                deadlineAt: budget.deadlineAt(),
                // Most places survive a re-plan, and a lookup already paid for
                // must not be paid for twice.
                known: geo.coords,
              })
            : { itinerary: revalidated.data.itinerary, located: 0, total: 0, coords: geo.coords };

          const reCheck = checkGeneratedItinerary(reGeo.itinerary, tripShape);

          // Keep whichever plan is actually more achievable. A model asked to fix
          // a schedule will sometimes return one that is worse, and the traveler
          // should not pay for that.
          if (blockingIssues(reCheck.issues).length < blockingIssues(check.issues).length) {
            plan = revalidated.data;
            geo = reGeo;
            check = reCheck;
          }
        }
      }
    }

    // The itinerary always comes back, conflicts and all: a plan the traveler can
    // see and fix beats a 502 that loses the whole generation. `conflicts` is
    // persisted alongside the trip so an unachievable plan stays flagged rather
    // than silently becoming somebody's Tuesday.
    return NextResponse.json({
      ...plan,
      itinerary: geo.itinerary,
      conflicts: conflictPayload(check, {
        attempts: completions,
        geocoded: { located: geo.located, total: geo.total },
      }),
    });
  } catch (err) {
    console.error('AI Generation Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate itinerary' },
      { status: 500 }
    );
  }
}
