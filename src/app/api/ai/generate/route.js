import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      destination,
      days,
      interests = [],
      transportMode = 'mixed',
      budgetLevel = 'moderate',
      notes = '',
      userApiKey,
    } = body;

    // Use user's own key or fallback to default Groq key
    const apiKey = userApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No API key available. Please add your own Groq key in Settings.' },
        { status: 400 }
      );
    }

    const transportInfo = {
      car: 'traveling by car (can cover longer distances between activities)',
      public_transit: 'using public transit (consider transit schedules and routes)',
      bike: 'cycling (keep activities within cycling distance)',
      walking: 'on foot (keep activities close together and walkable)',
      flight: 'flying between major destinations',
      mixed: 'using a mix of transport (walking for close-by, transit/car for further)',
    };

    const budgetInfo = {
      budget: 'budget-friendly options, street food, free attractions, hostels',
      moderate: 'balanced mix of paid and free, mid-range restaurants, 3-star hotels',
      luxury: 'premium experiences, fine dining, 5-star hotels, VIP tours',
    };

    const systemPrompt = `You are WanderForge AI, an expert travel planner. You create optimized itineraries that PRIORITIZE:
1. EXPERIENCE - Unforgettable, authentic activities
2. TIME - Minimize wasted time on transit, logical geographic ordering
3. MONEY - Best value for the budget level

Rules:
- Group geographically close activities together in the same day
- Schedule outdoor activities in the morning, indoor in afternoon for flexibility
- Include estimated costs in local currency
- Include specific location names and addresses when possible
- Add practical notes (best time to visit, avoid crowds tips)
- Consider opening hours and seasonal factors
- Suggest realistic time slots with travel time between activities`;

    const userPrompt = `Create a detailed ${days}-day itinerary for ${destination}.

Transport: ${transportInfo[transportMode] || transportInfo.mixed}
Budget: ${budgetInfo[budgetLevel] || budgetInfo.moderate}
Interests: ${interests.length > 0 ? interests.join(', ') : 'general sightseeing and culture'}
${notes ? `Additional notes: ${notes}` : ''}

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
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.error?.message || `Groq API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    const itinerary = JSON.parse(content);
    return NextResponse.json(itinerary);
  } catch (err) {
    console.error('AI Generation Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate itinerary' },
      { status: 500 }
    );
  }
}
