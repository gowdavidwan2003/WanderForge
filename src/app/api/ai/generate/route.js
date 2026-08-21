import { NextResponse } from 'next/server';
import { groqChatCompletion, groqChatCompletionStream } from '@/lib/groq';
import { REALISM_RULES, preferencesBlock } from '@/lib/itineraryPrompt';
import { requireUser } from '@/lib/api/requireUser';
import { getUserGroqKey } from '@/lib/api/userGroqKey';
import { clampRequestedDays } from '@/lib/tripLimits';
import { PLANNING_MODEL, PLANNING_REASONING_EFFORT, planningMaxTokens } from '@/lib/groqModels';
import { validateItinerary, validationRetryPrompt } from '@/lib/itinerarySchema';
import { geocodeItinerary } from '@/lib/placeLookup';
import { getGeocodeCacheClients } from '@/lib/api/geocodeCacheClients';
import {
  createItineraryStreamParser,
  extractJsonObject,
  groqTextDeltas,
  sseEvent,
} from '@/lib/streamingJson';
import {
  blockingIssues,
  checkGeneratedItinerary,
  conflictPayload,
  conflictRetryPrompt,
  toCheckerInput,
} from '@/lib/conflictReport';
import { legsForItinerary, resolveLegs } from '@/lib/routeLookup';
import {
  MIN_COMPLETION_MS,
  MIN_GEOCODE_MS,
  createBudget,
} from '@/lib/aiBudget';

// Groq can sit on a connection well past a serverless default. Declaring the
// ceiling makes the timeout ours to control rather than the platform's, and
// aiBudget divides it between the completions, the geocoding and the check.
export const maxDuration = 60;

/**
 * The response shape, stated once.
 *
 * Trimmed of the hand-tuned "then verify each day hour by hour, is there enough
 * time to get from A to B" arithmetic that used to live here. A language model
 * cannot reliably do that arithmetic, and asking it to only made the output more
 * confident, not more correct. conflictChecker does it deterministically, from road distance and mode speeds,
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
async function requestItinerary(messages, { budget, userApiKey, days }) {
  // Sized from THESE messages, not from the first prompt. Groq counts prompt plus
  // reserved completion against one per-minute allowance, and a retry's prompt
  // carries the conflicts and the plan digest on top of the original — reusing
  // the first request's ceiling would reserve more than the allowance and fail
  // the retry outright with a 413 rather than a 429.
  const promptText = messages.map((m) => m.content).join('\n');

  const result = await groqChatCompletion(
    {
      model: PLANNING_MODEL,
      messages,
      // Lower temperature keeps distance and duration estimates grounded rather
      // than creative.
      temperature: 0.4,
      response_format: { type: 'json_object' },
      reasoning_effort: PLANNING_REASONING_EFFORT,
      max_completion_tokens: planningMaxTokens(days, promptText),
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

/**
 * Everything after the model has finished writing.
 *
 * Shared by both paths: validate, resolve coordinates, run the deterministic
 * check, and re-prompt once if the plan is not achievable. Streaming changes
 * when the user sees the days, not what is done to them before they are saved.
 *
 * @param onStatus called with a short line for the progress display
 */
async function finishPlan(raw, {
  days, budget, userApiKey, messages, near, transportMode, totalBudget,
  onStatus = () => {},
}) {
  let plan = null;
  let errors = null;
  let completions = 1;

  const validated = validateItinerary(raw, { days });
  if (validated.ok) plan = validated.data;
  else errors = validated.errors;

  if (!plan && budget.canAfford(MIN_COMPLETION_MS)) {
    onStatus('Fixing the format the model got wrong…');
    messages.push({ role: 'user', content: validationRetryPrompt(errors) });

    const retry = await requestItinerary(messages, { budget, userApiKey, days });
    completions++;

    if (!retry.failure && !retry.errors) {
      const revalidated = validateItinerary(retry.raw, { days });
      if (revalidated.ok) { plan = revalidated.data; errors = null; }
      else errors = revalidated.errors;
    }
  }

  if (!plan) return { ok: false, errors: errors ?? [] };

  const tripShape = {
    transport_mode: transportMode,
    total_budget: Number(totalBudget) || null,
    currency: plan.currency || '',
  };

  onStatus('Placing everything on the map…');
  const cache = await getGeocodeCacheClients();
  let geo = { itinerary: plan.itinerary, located: 0, total: 0, hits: new Map(), stats: null };
  if (budget.canAfford(MIN_GEOCODE_MS)) {
    geo = await geocodeItinerary(plan.itinerary, { near, deadlineAt: budget.deadlineAt(), cache });
  }

  // Real road distances, so the winding-road correction in travelMinutes can
  // actually run. Without them every estimate is great-circle distance times 1.3
  // at a flat speed — measured 1.6x optimistic on the Chikmagaluru hill road
  // this product was built around. Cache-first, so a
  // destination somebody has already planned costs nothing, and a regeneration
  // of the same trip costs nothing.
  onStatus('Measuring the roads between your stops…');

  let roadLegs = {};
  let roadStats = null;
  if (budget.canAfford(MIN_GEOCODE_MS)) {
    const shaped = toCheckerInput(geo.itinerary);
    const resolved = await resolveLegs(legsForItinerary(shaped.days, shaped.activities), {
      mode: transportMode,
      cache,
      deadlineAt: budget.deadlineAt(),
    });
    roadLegs = resolved.legs;
    roadStats = resolved.stats;
  }

  onStatus('Working out how long each journey really takes…');
  let check = checkGeneratedItinerary(geo.itinerary, tripShape, roadLegs);

  const conflictPrompt = conflictRetryPrompt(check.issues, geo.itinerary);
  if (conflictPrompt && budget.canAfford(MIN_COMPLETION_MS)) {
    onStatus('Some days do not work — asking for a fix…');
    messages.push({ role: 'user', content: conflictPrompt });

    const retry = await requestItinerary(messages, { budget, userApiKey, days });
    completions++;

    if (!retry.failure && !retry.errors) {
      const revalidated = validateItinerary(retry.raw, { days });
      if (revalidated.ok) {
        const reGeo = budget.canAfford(MIN_GEOCODE_MS)
          ? await geocodeItinerary(revalidated.data.itinerary, {
              near, deadlineAt: budget.deadlineAt(), cache, known: geo.hits,
            })
          : { itinerary: revalidated.data.itinerary, located: 0, total: 0, hits: geo.hits };

        // Same legs where the places are unchanged; anything new falls back to
        // the estimate rather than spending a second round of Routes calls
        // inside the budget that is left.
        const reCheck = checkGeneratedItinerary(reGeo.itinerary, tripShape, roadLegs);
        // Keep whichever plan is actually more achievable. A model asked to fix
        // a schedule will sometimes return one that is worse.
        if (blockingIssues(reCheck.issues).length < blockingIssues(check.issues).length) {
          plan = revalidated.data;
          geo = reGeo;
          check = reCheck;
        }
      }
    }
  }

  return {
    ok: true,
    payload: {
      ...plan,
      itinerary: geo.itinerary,
      conflicts: conflictPayload(check, {
        attempts: completions,
        geocoded: { located: geo.located, total: geo.total, ...(geo.stats || {}) },
        roads: roadStats,
      }),
      // Handed to the client so the editor's live check measures the same
      // journeys this one did without paying for them twice. Keyed by
      // coordinates, so they survive the activities being inserted with real ids.
      roadLegs,
    },
  };
}

/**
 * Stream the itinerary day by day.
 *
 * The days that arrive here are a PREVIEW and nothing more. Nothing is saved
 * from them — they exist so the user sees their first day in a couple of seconds
 * instead of watching a spinner for forty. The authoritative payload arrives in
 * the `complete` event, after the same validate → geocode → check pipeline the
 * non-streaming path runs, and that is the only thing the client writes. Keeping
 * the write at the end is what preserves the guarantee from S2-1: no model
 * output, however it arrives, can produce a partially-populated trip.
 *
 * Splitting generation into one request per day would stream more cleanly and is
 * not possible here: Groq counts prompt plus reserved completion against a
 * single 8,000 tokens-per-minute allowance, and five requests each carrying the
 * system prompt would exceed it before the third.
 */
function streamItinerary({ messages, days, budget, userApiKey, near, transportMode, totalBudget }) {
  const encoder = new TextEncoder();
  // Aborted when the browser goes away, so a cancelled generation stops costing
  // money instead of running to completion into a socket nobody is reading.
  const upstream = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // The client has gone. cancel() below deals with the upstream.
        }
      };

      try {
        send('status', { message: 'Asking the AI to plan your trip…' });

        const promptText = messages.map((m) => m.content).join('\n');
        const result = await groqChatCompletionStream(
          {
            model: PLANNING_MODEL,
            messages,
            temperature: 0.4,
            // Deliberately NO response_format: json_object here, unlike the
            // non-streaming path. Measured against gpt-oss-120b on a 5-day
            // itinerary: with JSON mode the first byte arrives at 6.4s and all
            // 12KB lands in the following 3ms — it buffers the whole completion,
            // which makes streaming pointless. Without it, the first byte is at
            // 116ms and day 1 is on screen at 1.9s. The cost is that the model
            // may wrap its answer in prose or a fence, which extractJsonObject
            // handles and validateItinerary catches whatever is left.
            reasoning_effort: PLANNING_REASONING_EFFORT,
            max_completion_tokens: planningMaxTokens(days, promptText),
          },
          { userApiKey, budgetMs: budget.completionSlice(), signal: upstream.signal }
        );

        if (!result.ok) {
          send('error', { message: result.error, status: result.status });
          controller.close();
          return;
        }

        const parser = createItineraryStreamParser();
        let seen = 0;

        for await (const delta of groqTextDeltas(result.body, { signal: upstream.signal })) {
          for (const day of parser.push(delta)) {
            seen++;
            send('day', { day, index: seen, expected: days });
          }
        }

        if (upstream.signal.aborted) {
          controller.close();
          return;
        }

        send('status', { message: 'Checking the plan before saving it…' });

        // Tolerant of a fence or a sentence around it, because JSON mode is off
        // on this path. Returns null when the stream ended mid-object — the
        // model hit its token ceiling, or the connection dropped.
        const raw = extractJsonObject(parser.text());

        if (!raw) {
          // The days already on screen are a preview of something that will not
          // be saved, so say so rather than leaving them looking finished.
          send('error', {
            message: seen > 0
              ? `The itinerary stopped after ${seen} day${seen === 1 ? '' : 's'}. Try generating fewer days at a time.`
              : 'The AI returned malformed itinerary data. Please try again.',
          });
          controller.close();
          return;
        }

        const finished = await finishPlan(raw, {
          days, budget, userApiKey, messages, near, transportMode, totalBudget,
          onStatus: (message) => send('status', { message }),
        });

        if (!finished.ok) {
          send('error', {
            message:
              'The AI returned an itinerary in a shape we could not use, twice. Nothing was saved — please try again.',
            details: finished.errors,
          });
        } else {
          send('complete', finished.payload);
        }
      } catch (err) {
        if (!upstream.signal.aborted) {
          console.error('AI Streaming Error:', err);
          send('error', { message: err.message || 'Failed to generate itinerary' });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },

    /** The browser closed the connection — stop paying Groq for the rest. */
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Vercel and nginx both buffer proxied responses by default, which would
      // hold every event back until the stream ended and undo the entire point.
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(request) {
  // These routes spend the operator's Google and Groq quota, so they must
  // not be callable anonymously.
  const auth = await requireUser();
  if (auth.error) return auth.error;

  // From the session, not the request body. The body version meant the browser
  // had to hold the raw key, and any caller could supply any string and have it
  // billed. It also means a user with their own key stops competing for the
  // operator's shared per-organisation token allowance.
  const userApiKey = await getUserGroqKey();

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
      destLat,
      destLng,
      totalBudget,
      stream: wantsStream = false,
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

    // Streaming exists so the first day appears in seconds instead of forty.
    // Everything that decides what actually gets saved happens after the stream
    // ends, in finishPlan, exactly as it does below.
    if (wantsStream) {
      return streamItinerary({
        messages, days, budget, userApiKey, near, transportMode, totalBudget,
      });
    }

    // ---- The non-streaming path ------------------------------------------
    // Kept for callers that want one response: the AI Fill Day button, and any
    // client that cannot read a stream.
    //
    // Nothing reaches Postgres until validation passes. Previously JSON.parse
    // was the entire contract, so "9am" in a TIME column or "TBD" in a
    // CHECK-constrained category was rejected row by row, halfway through
    // writing the trip.
    const first = await requestItinerary(messages, { budget, userApiKey, days });

    // A provider error is not something a retry fixes — it fails identically
    // while burning the budget.
    if (first.failure) return first.failure;

    if (first.errors) {
      return NextResponse.json(
        {
          error: 'The AI did not return usable JSON. Nothing was saved — please try again.',
          details: first.errors,
        },
        { status: 502 }
      );
    }

    const finished = await finishPlan(first.raw, {
      days, budget, userApiKey, messages, near, transportMode, totalBudget,
    });

    if (!finished.ok) {
      console.warn(
        `[WanderForge] Generated itinerary failed validation twice: ${finished.errors.slice(0, 5).join('; ')}`
      );
      return NextResponse.json(
        {
          error:
            'The AI returned an itinerary in a shape we could not use, twice. Nothing was saved — please try again.',
          details: finished.errors,
        },
        { status: 502 }
      );
    }

    // The itinerary always comes back, conflicts and all: a plan the traveler can
    // see and fix beats a 502 that loses the whole generation. `conflicts` is
    // persisted alongside the trip so an unachievable plan stays flagged rather
    // than silently becoming somebody's Tuesday.
    return NextResponse.json(finished.payload);
  } catch (err) {
    console.error('AI Generation Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate itinerary' },
      { status: 500 }
    );
  }
}
