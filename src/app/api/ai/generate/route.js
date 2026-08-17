import { NextResponse } from 'next/server';
import { groqChatCompletion } from '@/lib/groq';
import { REALISM_RULES, TRANSPORT_INFO, BUDGET_INFO } from '@/lib/itineraryPrompt';
import { requireUser } from '@/lib/api/requireUser';
import { clampRequestedDays } from '@/lib/tripLimits';
import { PLANNING_MODEL, PLANNING_REASONING_EFFORT, planningMaxTokens } from '@/lib/groqModels';

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
    const body = await request.json();
    const {
      destination,
      days: requestedDays,
      interests = [],
      transportMode = 'mixed',
      budgetLevel = 'moderate',
      notes = '',
      userApiKey,
    } = body;

    // `days` is attacker-controlled and drives both cost centres: one AI day per
    // day, then one billed geocode per activity the model returns.
    const days = clampRequestedDays(requestedDays);

    const transportInfo = TRANSPORT_INFO;
    const budgetInfo = BUDGET_INFO;

    const systemPrompt = REALISM_RULES;

    const userPrompt = `Create a detailed ${days}-day itinerary for ${destination}.

Transport: ${transportInfo[transportMode] || transportInfo.mixed}
Budget: ${budgetInfo[budgetLevel] || budgetInfo.moderate}
Interests: ${interests.length > 0 ? interests.join(', ') : 'general sightseeing and culture'}
${notes ? `Additional notes: ${notes}` : ''}

Plan each of the ${days} days to make good use of the day, but ONLY with activities that are genuinely achievable given real travel times between the specific places you choose. Include meals at natural times.

Then verify each day hour by hour: for every consecutive pair, is there enough time to actually get from the first place to the second by ${transportMode === 'mixed' ? 'the available transport' : transportMode}, including parking and walking? Any hop over 45 minutes must be its own "transport" entry. If a day does not survive that check, remove activities until it does - a shorter, achievable day is the correct answer.

RESPOND IN THIS EXACT JSON FORMAT (no other text, just JSON):
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
}`;

    const result = await groqChatCompletion({
        model: PLANNING_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // Lower temperature keeps distance and duration estimates grounded rather
        // than creative. No max_tokens: it capped long itineraries, and Groq
        // reserves the full value against the per-minute token limit up front,
        // which was causing spurious rate-limit errors on back-to-back requests.
        temperature: 0.4,
        response_format: { type: 'json_object' },
        reasoning_effort: PLANNING_REASONING_EFFORT,
        max_completion_tokens: planningMaxTokens(days, systemPrompt + userPrompt),
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

    // Full-day itineraries are long. If the model hit the token ceiling the JSON is
    // cut off mid-object, so report that plainly instead of a bare parse error.
    if (choice.finish_reason === 'length') {
      return NextResponse.json(
        {
          error: `The itinerary was too long to finish (${days} days). Try generating fewer days at a time.`,
        },
        { status: 502 }
      );
    }

    let itinerary;
    try {
      itinerary = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: 'The AI returned malformed itinerary data. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json(itinerary);
  } catch (err) {
    console.error('AI Generation Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate itinerary' },
      { status: 500 }
    );
  }
}
