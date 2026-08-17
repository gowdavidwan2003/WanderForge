import { NextResponse } from 'next/server';
import { groqChatCompletion } from '@/lib/groq';
import { REALISM_RULES, preferencesBlock } from '@/lib/itineraryPrompt';
import { requireUser } from '@/lib/api/requireUser';

/**
 * Re-plan a single day.
 *
 * Inserting one activity into an existing day cannot produce a coherent schedule
 * — the new item has to be woven in around travel time, meals and what is already
 * booked. Rather than wiping the whole trip to fix one day, this replans just the
 * affected day, applying the same realism rules as full generation.
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

  try {
    const {
      destination,
      date,
      dayNumber,
      keep = [],        // activities already on this day
      mustInclude = [], // newly requested places that must appear
      transportMode = 'mixed',
      budgetLevel = 'moderate',
      interests = [],
      notes = '',
      currency,
      userApiKey,
    } = await request.json();

    if (!destination) {
      return NextResponse.json({ error: 'destination is required' }, { status: 400 });
    }
    if (keep.length === 0 && mustInclude.length === 0) {
      return NextResponse.json({ error: 'Nothing to plan for this day' }, { status: 400 });
    }


    const describe = (list) =>
      list.map((a) => `  - ${a.title}${a.location_name ? ` @ ${a.location_name}` : ''}${a.category ? ` [${a.category}]` : ''}`).join('\n') || '  (none)';

    const userPrompt = `Re-plan Day ${dayNumber}${date ? ` (${date})` : ''} of a trip to ${destination}.

${preferencesBlock({ transportMode, budgetLevel, interests, notes })}
${currency ? `Costs in ${currency}.` : ''}

ALREADY PLANNED FOR THIS DAY — keep all of these, but you may reorder and retime them:
${describe(keep)}

MUST BE ADDED TO THIS DAY — the traveler explicitly asked for these:
${describe(mustInclude)}

Build ONE coherent day containing every item above. Reorder and retime freely so the
whole day works: sensible geographic order, realistic travel between each stop, meals
at natural times, nothing impossible. You may add a small number of extra stops only
where they genuinely fit and improve the day, and you may add "transport" entries for
journeys over 45 minutes.

If a must-include place is far from the rest of the day, build the day around it
rather than squeezing it in — and drop or shorten other items as needed.

RESPOND IN THIS EXACT JSON FORMAT (no other text, just JSON):
{
  "day": ${dayNumber},
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
}`;

    const result = await groqChatCompletion({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: REALISM_RULES },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
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
        { error: 'The replanned day was too long to finish. Try again.' },
        { status: 502 }
      );
    }

    let plan;
    try {
      plan = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: 'The AI returned malformed day data. Please try again.' },
        { status: 502 }
      );
    }

    if (!Array.isArray(plan?.activities) || plan.activities.length === 0) {
      return NextResponse.json({ error: 'The AI returned an empty day.' }, { status: 502 });
    }

    // A replan must never silently drop something the traveler explicitly asked for.
    const titles = plan.activities.map((a) => String(a.title || '').toLowerCase());
    const missing = mustInclude.filter(
      (m) => !titles.some((t) => t.includes(String(m.title || '').toLowerCase().slice(0, 12)))
    );

    return NextResponse.json({ ...plan, missing: missing.map((m) => m.title) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
