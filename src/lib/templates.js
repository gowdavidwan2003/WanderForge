/**
 * The starting points behind Explore.
 *
 * These used to be thirty destinations with nothing in them. "Use Template"
 * called create_trip_with_days, which writes a trip and its days and no
 * activities — so a template produced an empty calendar and the user still had
 * to run the planner to get anything. The word promised a plan; a blank one
 * arrived.
 *
 * They are now ten real plans, held in public.trip_templates: every day titled,
 * every stop with a time, a category, a cost and real coordinates. Five
 * international, five Indian. Ten itineraries somebody can follow beat thirty
 * stubs that say nothing.
 *
 * The database is the source of truth. What stays here:
 *
 *   TEMPLATE_DATA      card metadata only, as a fallback for when the fetch
 *                      fails. No plans — a degraded Explore page still lists
 *                      the destinations rather than showing nothing.
 *   TAG_TO_INTEREST    mirrored by public.template_interests() in migration 015
 *                      for the path where the database builds the trip itself.
 */

/**
 * Template tags are written for a reader; interests are a fixed vocabulary the
 * planner understands.
 *
 * This is where the user's choice used to be discarded. Explore wrote the tags
 * to `ai_preferences.tags`, and the generate route reads
 * `ai_preferences.interests` — so picking Tokyo for its food and culture sent
 * the planner nothing at all, and every template produced the same generic trip.
 *
 * The vocabularies also do not match: 'romance', 'luxury' and 'spiritual' are
 * reasonable things to say about a place and are not interests the wizard
 * offers. They map to the nearest one that is, rather than being passed through
 * to be silently ignored a second time.
 *
 * Keep in step with public.template_interests() in
 * supabase/migrations/015_template_itineraries.sql.
 */
const TAG_TO_INTEREST = {
  romance: 'relaxation',
  technology: 'sightseeing',
  luxury: 'shopping',
  spiritual: 'culture',
  beach: 'relaxation',
  heritage: 'history',
  // The rest are already interests the wizard offers: culture, food, nature,
  // relaxation, adventure, sightseeing, nightlife, shopping, history, photography.
};

/**
 * Card metadata for the ten official templates, in the order Explore shows them.
 *
 * Deliberately without itineraries. These exist so the page renders when the
 * database cannot be reached; a plan shown from here could be stale, and a
 * stale plan is worse than a card that sends you to the live one.
 */
export const TEMPLATE_DATA = [
  { destination: 'Paris, France', duration: 5, icon: '🗼', cover: '#E8B87D', tags: ['culture', 'food', 'romance'], desc: 'The City of Lights — iconic landmarks, world-class cuisine, and unforgettable strolls along the Seine.' },
  { destination: 'Tokyo, Japan', duration: 5, icon: '🏯', cover: '#C85A3A', tags: ['culture', 'food', 'technology'], desc: 'A mesmerizing blend of ancient temples, futuristic tech, and the best street food on Earth.' },
  { destination: 'Rome, Italy', duration: 4, icon: '🏛️', cover: '#B88A4D', tags: ['history', 'food', 'culture'], desc: 'Ancient ruins, Renaissance art, gelato on every corner, and la dolce vita.' },
  { destination: 'Bali, Indonesia', duration: 5, icon: '🌴', cover: '#4A8C2A', tags: ['nature', 'relaxation', 'adventure'], desc: 'Lush rice terraces, sacred temples, stunning beaches, and spiritual healing experiences.' },
  { destination: 'Dubai, UAE', duration: 4, icon: '🏙️', cover: '#DAA520', tags: ['luxury', 'shopping', 'adventure'], desc: 'Futuristic skyline, desert safaris, world-class shopping, and over-the-top luxury.' },
  { destination: 'Jaipur, Rajasthan, India', duration: 4, icon: '🐘', cover: '#E75480', tags: ['history', 'culture', 'shopping'], desc: 'The Pink City — majestic forts, vibrant bazaars, spicy curries, and royal heritage.' },
  { destination: 'Goa, India', duration: 4, icon: '🏖️', cover: '#00A5A5', tags: ['beach', 'nightlife', 'heritage'], desc: 'Beaches north and south, Portuguese churches, spice plantations, and the best seafood on the Konkan coast.' },
  { destination: 'Kochi to Munnar to Alleppey, Kerala, India', duration: 5, icon: '🛶', cover: '#1B7A5A', tags: ['nature', 'food', 'relaxation'], desc: 'Colonial Kochi, tea country in the Western Ghats, and a night on the Alleppey backwaters.' },
  { destination: 'Varanasi, Uttar Pradesh, India', duration: 3, icon: '🪔', cover: '#B5651D', tags: ['spiritual', 'culture', 'history'], desc: 'The ghats at dawn, the evening aarti, and the Buddha first sermon at Sarnath.' },
  { destination: 'Leh, Ladakh, India', duration: 5, icon: '🏔️', cover: '#4A6FA5', tags: ['adventure', 'nature', 'photography'], desc: 'High-altitude desert, Tibetan monasteries, and the road over Khardung La to the Nubra dunes.' },
];

/** How many starting points Explore offers. Imported by the landing page. */
export const TEMPLATE_COUNT = TEMPLATE_DATA.length;

/** Every tag, for the filter row when the database is unreachable. */
export const ALL_TAGS = [...new Set(TEMPLATE_DATA.flatMap((t) => t.tags))].sort();

/**
 * The interests to store on a trip created from this template.
 *
 * Deduplicated, because two tags can map to the same interest.
 */
export function templateInterests(template) {
  const mapped = (template?.tags || []).map((tag) => TAG_TO_INTEREST[tag] || tag);
  return [...new Set(mapped)];
}

/**
 * A database row in the shape the cards and the preview page expect.
 *
 * `tags` is JSONB and `days` comes out of itinerary_data, both of which can be
 * absent on a row somebody created by hand — hence the defaults rather than
 * trusting the column.
 */
function normalizeTemplate(row) {
  return {
    id: row.id,
    destination: row.destination,
    title: row.title,
    duration: row.duration_days,
    desc: row.description,
    icon: row.icon,
    cover: row.cover,
    currency: row.currency,
    tags: Array.isArray(row.tags) ? row.tags : [],
    days: row.itinerary_data?.days ?? [],
  };
}

/**
 * The official templates, for the Explore grid.
 *
 * itinerary_data is not selected: it is the largest column by far and the grid
 * shows none of it. The preview page fetches the plan for the one template it
 * is showing.
 *
 * Falls back to TEMPLATE_DATA on any failure, so Explore never renders empty.
 * Readable without a session — the RLS policy and the anon grant in migration
 * 015 are what make that true, and it is deliberate: a plan nobody can see
 * until they sign up cannot persuade anybody to sign up.
 */
export async function fetchOfficialTemplates(supabase) {
  const { data, error } = await supabase
    .from('trip_templates')
    .select('id, title, destination, duration_days, description, icon, cover, currency, tags')
    .eq('is_official', true)
    .order('destination');

  if (error || !data?.length) return TEMPLATE_DATA;
  return data.map(normalizeTemplate);
}

/** One template with its full day-by-day plan. Null if there is no such row. */
export async function fetchTemplateById(supabase, id) {
  const { data, error } = await supabase
    .from('trip_templates')
    .select('id, title, destination, duration_days, description, icon, cover, currency, tags, itinerary_data')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeTemplate(data);
}

/** What a template costs per person, summed over every activity in the plan. */
export function templateCost(template) {
  return (template?.days || []).reduce(
    (total, day) =>
      total + (day.activities || []).reduce((sum, a) => sum + (Number(a.cost) || 0), 0),
    0
  );
}

/** How many stops the plan holds, for the card and the preview header. */
export function templateStopCount(template) {
  return (template?.days || []).reduce((n, day) => n + (day.activities || []).length, 0);
}
