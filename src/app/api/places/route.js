import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/requireUser';

/**
 * Nearby point-of-interest search.
 *
 * Overpass is free and unlimited, so it stays the primary source — but it rejects
 * requests without a User-Agent (Node's fetch sends none, which returned 406 for
 * every call), and OSM coverage of businesses is patchy outside cities. Google
 * Places fills the gaps when Overpass comes back empty.
 */

const OVERPASS_FILTERS = {
  tourism: '"tourism"~"attraction|museum|viewpoint|gallery|artwork|zoo|theme_park"',
  food: '"amenity"~"restaurant|cafe|fast_food|bar|pub|food_court"',
  nature: '"natural"~"peak|water|beach|cliff|cave_entrance"',
  shopping: '"shop"~"mall|supermarket|gift|clothes|books"',
  nightlife: '"amenity"~"nightclub|bar|pub|casino"',
  culture: '"amenity"~"theatre|cinema|library|arts_centre"',
  accommodation: '"tourism"~"hotel|guest_house|hostel|apartment|resort"',
};

// What to ask Google for when Overpass has nothing.
const GOOGLE_QUERY = {
  tourism: 'tourist attractions',
  food: 'restaurants',
  nature: 'nature spots and viewpoints',
  shopping: 'shopping',
  nightlife: 'bars and nightlife',
  culture: 'museums and theatres',
  accommodation: 'hotels',
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

async function fromOverpass(lat, lng, radius, category) {
  const filter = OVERPASS_FILTERS[category] || OVERPASS_FILTERS.tourism;
  const query = `
    [out:json][timeout:20];
    (
      node[${filter}](around:${radius},${lat},${lng});
      way[${filter}](around:${radius},${lat},${lng});
    );
    out center 40;
  `;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass returns 406 without this. Its absence was why this route never
      // worked and the feature was never wired into the UI.
      'User-Agent': 'WanderForge/1.0 (travel itinerary planner)',
    },
  });

  if (!res.ok) throw new Error(`Overpass ${res.status}`);

  const data = await res.json();
  return (data.elements || [])
    .filter((el) => el.tags?.name)
    .map((el) => ({
      id: `osm-${el.id}`,
      name: el.tags.name,
      type: el.tags.tourism || el.tags.amenity || el.tags.shop || el.tags.natural || 'place',
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
      description: el.tags.description || el.tags['description:en'] || '',
      website: el.tags.website || '',
      phone: el.tags.phone || '',
      opening_hours: el.tags.opening_hours || '',
      cuisine: el.tags.cuisine || '',
      wheelchair: el.tags.wheelchair || '',
      source: 'osm',
    }))
    .filter((p) => p.lat && p.lng);
}

async function fromGoogle(apiKey, lat, lng, radius, category) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.primaryType,places.websiteUri',
    },
    body: JSON.stringify({
      textQuery: GOOGLE_QUERY[category] || GOOGLE_QUERY.tourism,
      maxResultCount: 20,
      locationBias: {
        circle: { center: { latitude: lat, longitude: lng }, radius: Number(radius) },
      },
    }),
  });

  if (!res.ok) throw new Error(`Google Places ${res.status}`);

  const data = await res.json();
  return (data.places || []).map((p) => ({
    id: `g-${p.id}`,
    name: p.displayName?.text || 'Unnamed place',
    type: p.primaryType || 'place',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    description: p.formattedAddress || '',
    website: p.websiteUri || '',
    rating: p.rating ?? null,
    source: 'google',
  })).filter((p) => p.lat && p.lng);
}

export async function GET(request) {
  // These routes spend the operator's Google and Groq quota, so they must
  // not be callable anonymously.
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat'));
  const lng = parseFloat(searchParams.get('lng'));
  const radius = Math.min(Number(searchParams.get('radius')) || 3000, 25000);
  const category = searchParams.get('category') || 'tourism';

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng required', places: [] }, { status: 400 });
  }

  let places = [];
  let source = null;

  try {
    places = await fromOverpass(lat, lng, radius, category);
    if (places.length) source = 'osm';
  } catch (err) {
    console.warn('[WanderForge] Overpass unavailable:', err.message);
  }

  if (places.length === 0 && process.env.GOOGLE_MAPS_API_KEY) {
    try {
      places = await fromGoogle(process.env.GOOGLE_MAPS_API_KEY, lat, lng, radius, category);
      source = 'google';
    } catch (err) {
      console.warn('[WanderForge] Google Places fallback failed:', err.message);
    }
  }

  const withDistance = places
    .map((p) => ({ ...p, distanceKm: haversineKm(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return NextResponse.json({ places: withDistance, source });
}
