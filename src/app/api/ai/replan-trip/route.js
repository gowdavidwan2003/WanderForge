import { NextResponse } from 'next/server';
import { groqChatCompletion } from '@/lib/groq';
import { REALISM_RULES, preferencesBlock } from '@/lib/itineraryPrompt';
import { requireUser } from '@/lib/api/requireUser';
import { getUserGroqKey } from '@/lib/api/userGroqKey';
import { PLANNING_MODEL, PLANNING_REASONING_EFFORT, planningMaxTokens } from '@/lib/groqModels';

/**
 * Re-plan a whole trip while preserving every place already on it.
 *
 * Some conflicts cannot be fixed inside a single day — two sights 112 km apart
 * scheduled two hours apart need one of them moved to another day entirely. That
 * requires replanning across days, which per-day replanning cannot do.
 *
 * The hard contract: every place the traveler has collected — typed by hand, added
 * by the assistant, or picked from nearby search — must still appear somewhere in
 * the result. Times, ordering and day assignment are free to change; the set of
 * places is not.
 */
// Groq can sit on a connection well past a serverless default. Declaring the
// ceiling makes the timeout ours to control rather than the platform's, and
// groq.js budgets its own attempts against this number.
export const maxDuration = 60;

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

  try {
    const {
      destination,
      days = [],       // [{ dayNumber, date }]
      mustKeep = [],   // every existing activity
      issues = [],     // conflict-checker findings, so it knows what to fix
      transportMode = 'mixed',
      budgetLevel = 'moderate',
      interests = [],
      notes = '',
      currency,
      skipRepair = false,
    } = await request.json();

    if (!destination || days.length === 0) {
      return NextResponse.json({ error: 'destination and days are required' }, { status: 400 });
    }
    if (mustKeep.length === 0) {
      return NextResponse.json({ error: 'There is nothing to replan yet.' }, { status: 400 });
    }


    // Numbered so the model can be told to account for every one of them.
    const placeList = mustKeep
      .map((a, i) => `  ${i + 1}. ${a.title}${a.location_name ? ` @ ${a.location_name}` : ''}${a.category ? ` [${a.category}]` : ''}`)
      .join('\n');

    const dayList = days
      .map((d) => `  Day ${d.dayNumber}${d.date ? ` — ${d.date}` : ''}`)
      .join('\n');

    const issueList = issues.length
      ? issues.slice(0, 25).map((i) => `  - Day ${i.day}: ${i.message}`).join('\n')
      : '  (none reported)';

    const userPrompt = `Rebuild the complete ${days.length}-day itinerary for ${destination}.

${preferencesBlock({ transportMode, budgetLevel, interests, notes })}
${currency ? `Costs in ${currency}.` : ''}

DAYS AVAILABLE — you have EXACTLY ${days.length} day${days.length === 1 ? '' : 's'}, numbered ${days.map((d) => d.dayNumber).join(', ')}. Do NOT invent any other day number; there is nowhere to put it and those activities would be lost:
${dayList}

MUST-VISIT PLACES — all ${mustKeep.length} of these are already chosen by the traveler and EVERY ONE must appear somewhere in the rebuilt itinerary as its OWN SEPARATE ENTRY. You may move a place to a different day, reorder it and change its times, but you may NOT drop it and you may NOT merge two of them into one entry (never produce a title like "Visit A and B" — that is two entries):
${placeList}

PROBLEMS WITH THE CURRENT PLAN — fix all of these:
${issueList}

HOW TO FIX THEM:
- Move places between days so each day is one tight geographic cluster. If two must-visit places are far apart, put them on different days rather than squeezing both into one.
- You only have ${days.length} day${days.length === 1 ? '' : 's'}. If everything genuinely cannot fit comfortably, still fit it all in — shorten visits and start earlier rather than spilling onto a day that does not exist.
- Give long excursions the day they need. A sight 100+ km away is a full-day trip: build that whole day around it and put nothing else far away on it.
- Insert "transport" entries for every journey over 45 minutes, including the return leg, with realistic durations for the terrain.
- Give every entry a start and end time. Nothing may be left untimed.
- Add meals and any small filler stops needed to make each day continuous.

Before answering, check BOTH of these:
1. All ${mustKeep.length} must-visit places appear somewhere in your output.
2. Every "day" value is one of: ${days.map((d) => d.dayNumber).join(', ')}. Nothing may reference any other day.
3. No single entry covers two or more must-visit places. Each gets its own entry with its own time slot.

RESPOND IN THIS EXACT JSON FORMAT (no other text, just JSON):
{
  "itinerary": [
    {
      "day": 1,
      "theme": "Day theme name",
      "activities": [
        {
          "title": "Activity name",
          "description": "Brief description",
          "location_name": "Specific searchable location including the town",
          "category": "sightseeing|food|transport|accommodation|adventure|shopping|nightlife|culture|nature|relaxation|other",
          "start_time": "09:00",
          "end_time": "11:00",
          "cost": 0,
          "notes": "Practical tip, including approximate travel time from the previous stop"
        }
      ]
    }
  ],
  "summary": "What changed and why",
  "moved": ["Place name — moved from Day 2 to Day 3 because ..."]
}`;

    const result = await groqChatCompletion({
        model: PLANNING_MODEL,
        messages: [
          { role: 'system', content: REALISM_RULES },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
        reasoning_effort: PLANNING_REASONING_EFFORT,
        max_completion_tokens: planningMaxTokens(days.length, REALISM_RULES + userPrompt),
    }, { userApiKey });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const data = result.data;
    const choice = data.choices?.[0];
    const content = choice?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }
    if (choice.finish_reason === 'length') {
      return NextResponse.json(
        { error: 'The rebuilt itinerary was too long to finish. Try again, or reduce the number of days.' },
        { status: 502 }
      );
    }

    let plan;
    try {
      plan = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: 'The AI returned malformed itinerary data. Please try again.' },
        { status: 502 }
      );
    }

    if (!Array.isArray(plan?.itinerary) || plan.itinerary.length === 0) {
      return NextResponse.json({ error: 'The AI returned an empty itinerary.' }, { status: 502 });
    }

    // The no-drop guarantee is enforced here, not trusted to the model.
    const validDays = new Set(days.map((d) => Number(d.dayNumber)));
    const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    const validate = (candidatePlan) => {
      const invalidDays = [...new Set(
        candidatePlan.itinerary.map((d) => Number(d.day)).filter((n) => !validDays.has(n))
      )];

      const produced = candidatePlan.itinerary
        .filter((d) => validDays.has(Number(d.day)))
        .flatMap((d) => d.activities || [])
        .map((a) => String(a.title || '').toLowerCase());

      const missing = mustKeep.filter((m) => {
        const target = norm(m.title);
        if (!target) return false;
        return !produced.some((pt) => {
          const candidate = norm(pt);
          return candidate.includes(target) || target.includes(candidate);
        });
      });

      return { invalidDays, missing };
    };

    let { invalidDays, missing } = validate(plan);

    // One corrective pass. The model drops places when a trip is tight, and
    // telling it exactly which ones recovers most of them — far better than
    // making the traveler retry blindly.
    if ((missing.length || invalidDays.length) && !skipRepair) {
      const repair = await groqChatCompletion({
        model: PLANNING_MODEL,
        messages: [
          { role: 'system', content: REALISM_RULES },
          { role: 'user', content: userPrompt },
          { role: 'assistant', content },
          {
            role: 'user',
            content: `That plan is not acceptable yet.
${
              missing.length
                ? `You left out these must-visit places entirely: ${missing.map((m) => m.title).join(', ')}. Add each one as its own separate entry on a suitable day.
`
                : ''
            }${
              invalidDays.length
                ? `You used Day ${invalidDays.join(', ')}, which does not exist. Only Days ${days.map((d) => d.dayNumber).join(', ')} are available.
`
                : ''
            }Return the COMPLETE corrected itinerary in the same JSON format, keeping everything else you already planned.`,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        reasoning_effort: PLANNING_REASONING_EFFORT,
        max_completion_tokens: planningMaxTokens(days.length, REALISM_RULES + userPrompt),
      }, { userApiKey });

      if (repair.ok) {
        const repaired = repair.data.choices?.[0]?.message?.content;
        try {
          const candidate = JSON.parse(repaired);
          if (Array.isArray(candidate?.itinerary) && candidate.itinerary.length) {
            const check = validate(candidate);
            // Only accept the repair if it is genuinely better.
            if (check.missing.length < missing.length && check.invalidDays.length === 0) {
              plan = candidate;
              invalidDays = check.invalidDays;
              missing = check.missing;
            }
          }
        } catch { /* keep the original plan and report what is missing */ }
      }
    }

    // A merged entry ("Visit A and B") satisfies a naive name check while
    // collapsing two chosen places into one row. Treat that as a defect too.
    const merged = [];
    for (const dayPlan of plan.itinerary) {
      if (!validDays.has(Number(dayPlan.day))) continue;
      for (const act of dayPlan.activities || []) {
        const candidate = norm(act.title);
        const matches = mustKeep
          .map((m) => m.title)
          .filter((t) => {
            const target = norm(t);
            return target && candidate.includes(target);
          });
        if (matches.length > 1) merged.push({ title: act.title, places: matches });
      }
    }

    return NextResponse.json({
      ...plan,
      merged,
      // `missing` is computed against valid days only, so a place parked on a
      // non-existent day correctly counts as missing rather than kept.
      missing: missing.map((m) => m.title),
      invalidDays,
      keptCount: mustKeep.length - missing.length,
      totalMustKeep: mustKeep.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
