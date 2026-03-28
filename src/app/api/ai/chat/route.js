import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { messages, tripContext, userApiKey } = await request.json();

    const apiKey = userApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key available' }, { status: 400 });
    }

    const systemPrompt = `You are WanderForge AI, a friendly travel planning assistant. You're helping a user plan their trip with these details:

${tripContext ? `
Destination: ${tripContext.destination}
Duration: ${tripContext.days} days
Transport: ${tripContext.transportMode}
Budget: ${tripContext.budgetLevel}
Current activities: ${tripContext.activityCount}
` : 'No trip context available.'}

You can help with:
- Suggesting activities, restaurants, and hidden gems
- Optimizing the order of activities
- Providing local tips and cultural advice
- Suggesting budget-friendly alternatives
- Recommending the best times to visit places
- Transportation and logistics advice
- Packing tips and safety advice

Keep your responses concise, helpful, and enthusiastic. Use emoji to make it engaging.
When suggesting specific activities, include: name, approximate time needed, estimated cost, and a brief tip.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-10), // Keep last 10 messages for context
        ],
        temperature: 0.8,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || `API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;

    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
