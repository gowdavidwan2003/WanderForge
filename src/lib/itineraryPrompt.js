/**
 * Shared itinerary-planning prompt.
 *
 * Both full generation and single-day replanning must apply the same realism
 * rules — travel time, durations, geography, meals. Keeping one copy here stops
 * the two paths drifting apart, which is how a replanned day could otherwise end
 * up looser than the original plan.
 */

export const TRANSPORT_INFO = {
  car: 'traveling by car (can cover longer distances between activities)',
  public_transit: 'using public transit (consider transit schedules and routes)',
  bike: 'cycling (keep activities within cycling distance)',
  walking: 'on foot (keep activities close together and walkable)',
  flight: 'flying between major destinations',
  mixed: 'using a mix of transport (walking for close-by, transit/car for further)',
};

export const BUDGET_INFO = {
  budget: 'budget-friendly options, street food, free attractions, hostels',
  moderate: 'balanced mix of paid and free, mid-range restaurants, 3-star hotels',
  luxury: 'premium experiences, fine dining, 5-star hotels, VIP tours',
};

export const ACTIVITY_CATEGORIES = [
  'sightseeing', 'food', 'transport', 'accommodation', 'adventure', 'shopping',
  'nightlife', 'culture', 'nature', 'relaxation', 'other',
];

/**
 * Force a model-supplied category into the set the database accepts.
 *
 * activities.category carries a CHECK constraint listing exactly these values, so
 * anything outside it — "food/drink", "sightseeing/culture", a capitalised
 * "Food" — is rejected by Postgres and that activity is silently dropped from the
 * itinerary. The prompt asks for one of the eleven, but a model improvises, and
 * the replacement planning model does so more often than the retired one did: a
 * five-day generation produced an out-of-enum value on the first try.
 *
 * Unknown values become 'other' rather than being discarded — the activity itself
 * is still worth keeping.
 */
/**
 * Words the model actually reaches for instead of the eleven allowed values.
 *
 * Every entry here was observed in real generations: "meal", "viewpoint",
 * "leisure", "trekking" and "market" all appeared. Mapping them keeps the
 * activity's meaning — a meal filed as "other" stops being a meal, so the day no
 * longer looks like it has lunch in it.
 */
const CATEGORY_SYNONYMS = {
  meal: 'food', meals: 'food', dining: 'food', restaurant: 'food', cafe: 'food',
  breakfast: 'food', lunch: 'food', dinner: 'food', drinks: 'food',
  viewpoint: 'sightseeing', landmark: 'sightseeing', monument: 'sightseeing',
  temple: 'culture', museum: 'culture', heritage: 'culture', historical: 'culture',
  trekking: 'adventure', trek: 'adventure', hiking: 'adventure', hike: 'adventure',
  safari: 'adventure', trail: 'adventure',
  leisure: 'relaxation', rest: 'relaxation', spa: 'relaxation', wellness: 'relaxation',
  market: 'shopping', shop: 'shopping', bazaar: 'shopping',
  travel: 'transport', drive: 'transport', flight: 'transport', commute: 'transport',
  hotel: 'accommodation', stay: 'accommodation', lodging: 'accommodation',
  scenic: 'nature', wildlife: 'nature', outdoors: 'nature', park: 'nature',
  bar: 'nightlife', club: 'nightlife',
};

export function normalizeCategory(value) {
  const raw = String(value ?? '').toLowerCase().trim();
  if (ACTIVITY_CATEGORIES.includes(raw)) return raw;
  if (CATEGORY_SYNONYMS[raw]) return CATEGORY_SYNONYMS[raw];

  // "food/drink", "food & drink", "Food - Dining" all start with a usable word.
  const first = raw.split(/[^a-z]+/).filter(Boolean)[0];
  if (ACTIVITY_CATEGORIES.includes(first)) return first;
  if (CATEGORY_SYNONYMS[first]) return CATEGORY_SYNONYMS[first];

  return 'other';
}

/**
 * System prompt for every planning call.
 *
 * Deliberately compact. The earlier version ran to roughly 1,280 tokens, and it
 * was charged against the account's 8,000 tokens-per-minute allowance on every
 * request — Groq counts prompt plus reserved completion before running anything.
 * That left too little for the itinerary itself, which is why generation had to
 * run at 'low' reasoning and still truncated on longer trips.
 *
 * This version is around 550 tokens and frees roughly 700 for output, which is
 * what makes 'medium' reasoning affordable. Nothing load-bearing was dropped: the
 * road-speed figures, the parking-and-walking overhead, the 45-minute transport
 * rule including the return leg, the duration guidance, the three meals and the
 * no-silent-gaps rule are all still stated. What went was repetition, restated
 * emphasis, and a six-point self-check that repeated rules already given above it.
 */
export const REALISM_RULES = `You are WanderForge AI, an expert travel planner. Produce itineraries a real traveler can actually follow. Priority order: ACHIEVABLE first, then the most rewarding experience, then value for the budget.

ACHIEVABILITY OVERRIDES EVERYTHING. A packed impossible day is a failure; a shorter honest day is correct. Never compress travel time to make something fit — drop it or move it to another day. An activity's start_time must never precede the previous end_time plus the real travel time between those two places.

TRAVEL TIME MUST BE REAL — judge the actual road, never straight-line distance. Door-to-door averages: hill/ghat/forest roads 25-30 km/h (a 40 km hill road is 1.5 hours, not 30 minutes); dense city 15-20 km/h; town roads 30-40 km/h; highways 50-60 km/h; walking 4 km/h and only under 2 km. Then add 15-30 minutes for parking, walking in from the car, ticket queues, and the final rough stretch to peaks and trailheads. Trailheads, peaks, waterfalls and viewpoints are usually 1-2 hours each way from a town centre. When unsure, overestimate — being early costs nothing, being an hour short ruins the day. Any hop over 45 minutes is its own entry with category "transport" and its own times, titled like "Drive to Mullayanagiri trailhead", and THE RETURN JOURNEY COUNTS as its own entry too. Put the assumption in that entry's notes, e.g. "approx 1h30 by car on winding ghat road".

DURATIONS: museum/palace 2-3h; landmark/temple 45min-1h30; viewpoint 30-45min; market 1-1h30; sit-down meal 1h (1h30 dinner); park or nature walk 1-2h; peak trek 3-5h on the mountain plus travel each way, which consumes a whole morning or day; waterfall or safari excursion half a day minimum including travel.

GEOGRAPHY: one geographic cluster per day, ordered as a loop ending near where it started. Never mix a far mountain excursion with a town-centre walk in the same morning. Build a whole day around a distant major sight.

FILL THE DAY HONESTLY: aim to use roughly 08:00-21:00, but only with entries that genuinely fit. Breakfast, lunch and dinner every day, adjusted around travel — a packed lunch en route if the traveler is on a mountain at 13:00; dinner is never omitted. No unexplained gap over 45 minutes: make it a transport entry or a real activity, and if time is free near base use something easy and close by, never another long drive. Strenuous activities early, easy ones after a trek. Respect opening hours, last-entry times and weekly closures.

EVERY ENTRY must include an estimated cost in local currency, a specific searchable location name or address, and one practical tip.

Before answering, walk each day hour by hour and confirm every transition has time for the real journey including parking, that no day needs you in two distant places at once, that every hop over 45 minutes — both directions — is its own transport entry, and that all three meals are present. If it does not hold, remove activities until it does.`;

export function preferencesBlock({ transportMode, budgetLevel, interests = [], notes = '' }) {
  return [
    `Transport: ${TRANSPORT_INFO[transportMode] || TRANSPORT_INFO.mixed}`,
    `Budget: ${BUDGET_INFO[budgetLevel] || BUDGET_INFO.moderate}`,
    `Interests: ${interests.length ? interests.join(', ') : 'general sightseeing and culture'}`,
    notes ? `Additional notes from the traveler: ${notes}` : '',
  ].filter(Boolean).join('\n');
}
