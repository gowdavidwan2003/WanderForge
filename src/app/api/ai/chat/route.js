import { NextResponse } from 'next/server';
import { groqChatCompletion } from '@/lib/groq';

const CATEGORIES = [
  'sightseeing', 'food', 'transport', 'accommodation', 'adventure', 'shopping',
  'nightlife', 'culture', 'nature', 'relaxation', 'other',
];

/**
 * The assistant can propose concrete itinerary edits. It previously had no way to
 * change anything, yet would happily reply "I've added X to your itinerary" —
 * claiming a side effect that never happened. Now it either calls this tool (and
 * the client applies the result) or it says plainly that nothing was changed.
 */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'modify_itinerary',
      description:
        "Add or remove activities in the user's trip. Call this ONLY when the user explicitly asks to change their itinerary (e.g. 'add it', 'remove that', 'put it on day 2'). Never call it for questions or suggestions.",
      parameters: {
        type: 'object',
        properties: {
          add: {
            type: 'array',
            description: 'Activities to add.',
            items: {
              type: 'object',
              properties: {
                day: { type: 'integer', description: 'Day number to add it to (1-based).' },
                title: { type: 'string' },
                description: { type: 'string' },
                location_name: {
                  type: 'string',
                  description: 'Specific, searchable place name including the town.',
                },
                category: { type: 'string', enum: CATEGORIES },
                start_time: { type: 'string', description: '24h HH:MM' },
                end_time: { type: 'string', description: '24h HH:MM' },
                cost: { type: 'number', description: 'Estimated cost in local currency.' },
                notes: { type: 'string' },
              },
              required: ['day', 'title', 'location_name', 'category', 'start_time', 'end_time'],
            },
          },
          remove: {
            type: 'array',
            description: 'Exact titles of existing activities to remove.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
];

function describeItinerary(itinerary) {
  if (!itinerary?.length) return 'The itinerary is currently empty.';
  return itinerary
    .map((d) => {
      const acts = (d.activities || [])
        .map((a) => `    - ${a.start_time || '??'}-${a.end_time || '??'} ${a.title} (${a.category}) @ ${a.location_name || 'no location'}`)
        .join('\n');
      return `  Day ${d.day} (${d.date || 'no date'}):\n${acts || '    (nothing planned)'}`;
    })
    .join('\n');
}

export async function POST(request) {
  try {
    const { messages, tripContext, itinerary, userApiKey } = await request.json();

    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
    }


    const systemPrompt = `You are WanderForge AI, a friendly travel planning assistant helping with this trip:

${tripContext ? `Destination: ${tripContext.destination}
Duration: ${tripContext.days} days
Transport: ${tripContext.transportMode}
Budget level: ${tripContext.budgetLevel}
Currency: ${tripContext.currency || 'local currency'}` : 'No trip context available.'}

CURRENT ITINERARY:
${describeItinerary(itinerary)}

You can help with suggestions, local tips, budget alternatives, timing and logistics.

CHANGING THE ITINERARY:
- When the user asks you to add or remove something, call the modify_itinerary tool. Do not describe the change in prose alone.
- NEVER claim you have added, removed or changed anything unless you actually called modify_itinerary in this turn. If you cannot make a change, say so plainly.
- When adding, pick a day and a time slot that does not clash with what is already scheduled, and leave realistic travel time between places. Mountain and ghat roads are slow: assume 25-30 km/h.
- Use a specific, searchable location_name including the town, so it can be placed on the map.
- If the user only asks for ideas or opinions, answer normally and do NOT call the tool.

Keep responses concise and warm. Use emoji sparingly.`;

    const result = await groqChatCompletion({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, ...messages.slice(-10)],
        temperature: 0.6,
        tools: TOOLS,
        tool_choice: 'auto',
    }, { userApiKey });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const data = result.data;
    const message = data.choices?.[0]?.message;

    // Surface any proposed edits separately so the client can preview them and
    // apply them against the database with the user's own permissions.
    let actions = null;
    const call = message?.tool_calls?.find((t) => t.function?.name === 'modify_itinerary');
    if (call) {
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        const add = Array.isArray(args.add) ? args.add : [];
        const remove = Array.isArray(args.remove) ? args.remove : [];
        if (add.length || remove.length) actions = { add, remove };
      } catch {
        // Malformed arguments: fall through and just return the text reply.
      }
    }

    return NextResponse.json({
      reply: message?.content || (actions ? 'Here are the changes I can make:' : ''),
      actions,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
