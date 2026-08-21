/**
 * The destination starting points behind Explore.
 *
 * These are not itineraries. Each one is a destination, a sensible length and a
 * few interests — pressing "Use" creates a real trip with those settings and
 * hands it to the AI to plan. Explore called them "curated templates", which
 * implied a hand-built day-by-day plan that has never existed; nothing here is
 * curated beyond the choice of city.
 *
 * Lives in lib rather than in the page so the landing page can count them
 * without importing a client component, and so the tag-to-interest mapping below
 * has one home.
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
 * The vocabularies also do not match: 'romance', 'technology' and 'luxury' are
 * reasonable things to say about a city and are not interests the wizard offers.
 * They map to the nearest one that is, rather than being passed through to be
 * silently ignored a second time.
 */
const TAG_TO_INTEREST = {
  romance: 'relaxation',
  technology: 'sightseeing',
  luxury: 'shopping',
  // The rest are already interests the wizard offers: culture, food, nature,
  // relaxation, adventure, sightseeing, nightlife, shopping, history, photography.
};

export const TEMPLATE_DATA = [
  { destination: 'Paris, France', duration: 5, icon: '🗼', cover: '#E8B87D', tags: ['culture', 'food', 'romance'], desc: 'The City of Lights — iconic landmarks, world-class cuisine, and unforgettable strolls along the Seine.' },
  { destination: 'Tokyo, Japan', duration: 7, icon: '🏯', cover: '#C85A3A', tags: ['culture', 'food', 'technology'], desc: 'A mesmerizing blend of ancient temples, futuristic tech, and the best street food on Earth.' },
  { destination: 'Bali, Indonesia', duration: 6, icon: '🌴', cover: '#4A8C2A', tags: ['nature', 'relaxation', 'adventure'], desc: 'Lush rice terraces, sacred temples, stunning beaches, and spiritual healing experiences.' },
  { destination: 'New York, USA', duration: 5, icon: '🗽', cover: '#42A5F5', tags: ['sightseeing', 'food', 'nightlife'], desc: 'The city that never sleeps — Broadway, Central Park, world-class museums, and pizza.' },
  { destination: 'Rome, Italy', duration: 4, icon: '🏛️', cover: '#B88A4D', tags: ['history', 'food', 'culture'], desc: 'Ancient ruins, Renaissance art, gelato on every corner, and la dolce vita.' },
  { destination: 'Dubai, UAE', duration: 4, icon: '🏙️', cover: '#DAA520', tags: ['luxury', 'shopping', 'adventure'], desc: 'Futuristic skyline, desert safaris, world-class shopping, and over-the-top luxury.' },
  { destination: 'London, UK', duration: 5, icon: '🎡', cover: '#8B4513', tags: ['history', 'culture', 'nightlife'], desc: 'Royal palaces, West End theatres, classic pubs, and iconic double-decker buses.' },
  { destination: 'Barcelona, Spain', duration: 5, icon: '⛪', cover: '#E57C23', tags: ['culture', 'food', 'nightlife'], desc: 'Gaudí masterpieces, tapas bars, Mediterranean beaches, and infectious energy.' },
  { destination: 'Sydney, Australia', duration: 6, icon: '🏖️', cover: '#0077B6', tags: ['nature', 'adventure', 'food'], desc: 'The Opera House, Bondi Beach, Blue Mountains, and the best coffee culture.' },
  { destination: 'Reykjavik, Iceland', duration: 4, icon: '🌋', cover: '#2D5016', tags: ['nature', 'adventure', 'photography'], desc: 'Northern Lights, geysers, blue lagoons, and otherworldly volcanic landscape.' },
  { destination: 'Santorini, Greece', duration: 4, icon: '🏝️', cover: '#2196F3', tags: ['romance', 'relaxation', 'food'], desc: 'White-washed villages, breathtaking sunsets, Mediterranean cuisine, and crystal waters.' },
  { destination: 'Marrakech, Morocco', duration: 4, icon: '🕌', cover: '#D2691E', tags: ['culture', 'food', 'shopping'], desc: 'Vibrant souks, stunning palaces, aromatic tagines, and desert excursions.' },
  { destination: 'Cape Town, South Africa', duration: 5, icon: '⛰️', cover: '#228B22', tags: ['nature', 'adventure', 'food'], desc: 'Table Mountain, wine country, stunning coastline, and incredible biodiversity.' },
  { destination: 'Bangkok, Thailand', duration: 5, icon: '🛕', cover: '#FF8C00', tags: ['food', 'culture', 'nightlife'], desc: 'Ornate temples, floating markets, legendary street food, and vibrant nightlife.' },
  { destination: 'Prague, Czech Republic', duration: 3, icon: '🏰', cover: '#8B0000', tags: ['history', 'culture', 'nightlife'], desc: 'Fairy-tale architecture, affordable beer, charming old town, and magical bridges.' },
  { destination: 'Maldives', duration: 5, icon: '🐠', cover: '#00CED1', tags: ['relaxation', 'nature', 'romance'], desc: 'Crystal-clear waters, overwater bungalows, world-class diving, and total serenity.' },
  { destination: 'Kyoto, Japan', duration: 4, icon: '⛩️', cover: '#DC143C', tags: ['culture', 'nature', 'history'], desc: 'Traditional geisha districts, bamboo forests, zen gardens, and 2000+ temples.' },
  { destination: 'Rio de Janeiro, Brazil', duration: 5, icon: '🎉', cover: '#32CD32', tags: ['adventure', 'nightlife', 'nature'], desc: 'Christ the Redeemer, Copacabana, samba rhythms, and the Amazon rainforest.' },
  { destination: 'Istanbul, Turkey', duration: 4, icon: '🌙', cover: '#4169E1', tags: ['history', 'food', 'culture'], desc: 'Where East meets West — bazaars, mosques, hamams, and incredible kebabs.' },
  { destination: 'Amsterdam, Netherlands', duration: 3, icon: '🌷', cover: '#FF6347', tags: ['culture', 'nightlife', 'photography'], desc: 'Canal cruises, world-class museums, cycling culture, and vibrant neighborhoods.' },
  { destination: 'Cusco, Peru', duration: 5, icon: '🦙', cover: '#8B4513', tags: ['history', 'adventure', 'nature'], desc: 'Gateway to Machu Picchu, Inca heritage, stunning Andes, and coca tea.' },
  { destination: 'Vienna, Austria', duration: 3, icon: '🎻', cover: '#9370DB', tags: ['culture', 'history', 'food'], desc: 'Imperial palaces, classical music, Sachertorte, and coffee house tradition.' },
  { destination: 'Singapore', duration: 3, icon: '🦁', cover: '#FF4500', tags: ['food', 'sightseeing', 'shopping'], desc: 'Marina Bay, hawker centres, Gardens by the Bay, and futuristic architecture.' },
  { destination: 'Lisbon, Portugal', duration: 4, icon: '⚓', cover: '#F4A460', tags: ['food', 'culture', 'nightlife'], desc: 'Colorful tiles, pastel de nata, fado music, and stunning coastal views.' },
  { destination: 'Jaipur, India', duration: 4, icon: '🐘', cover: '#E75480', tags: ['history', 'culture', 'shopping'], desc: 'The Pink City — majestic forts, vibrant bazaars, spicy curries, and royal heritage.' },
  { destination: 'Seoul, South Korea', duration: 5, icon: '🎎', cover: '#663399', tags: ['food', 'culture', 'technology'], desc: 'K-pop, kimchi, ancient palaces, neon streets, and the best skincare shopping.' },
  { destination: 'Cairo, Egypt', duration: 4, icon: '🐫', cover: '#CD853F', tags: ['history', 'adventure', 'culture'], desc: 'The Pyramids, the Sphinx, the Nile, and 5000 years of fascinating history.' },
  { destination: 'Queenstown, New Zealand', duration: 4, icon: '🏔️', cover: '#2E8B57', tags: ['adventure', 'nature', 'photography'], desc: 'Adventure capital — bungee jumping, skiing, Lord of the Rings landscapes.' },
  { destination: 'Havana, Cuba', duration: 4, icon: '🚗', cover: '#B22222', tags: ['culture', 'nightlife', 'history'], desc: 'Vintage cars, salsa music, colonial architecture, and mojitos on the Malecón.' },
  { destination: 'Dubai → Abu Dhabi, UAE', duration: 5, icon: '🌆', cover: '#B8860B', tags: ['luxury', 'adventure', 'culture'], desc: 'Desert safaris, world records, Grand Mosque, and the ultimate luxury experience.' },
];

/** How many starting points Explore offers. Imported by the landing page. */
export const TEMPLATE_COUNT = TEMPLATE_DATA.length;

/** Every tag, for the filter row. */
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
