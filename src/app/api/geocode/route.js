import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/requireUser';

/**
 * Place lookup for activity locations.
 *
 * Nominatim geocodes addresses, not businesses — it could not find "The Planters
 * Court", "Hirekolale Lake" or even "Chikmagaluru" (OSM indexes that city as
 * "Chikmagalur"), which left every activity on a trip without coordinates.
 * Google Places Text Search handles venue names and spelling variants, so it is
 * tried first, with Nominatim kept as a no-key fallback.
 */

async function googlePlaces(apiKey, query, near) {
  const body = { textQuery: query, maxResultCount: 1 };

  // Bias toward the trip's destination so "District Museum" resolves near the
  // right town rather than to a same-named place on the other side of the country.
  if (near?.lat != null && near?.lng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: near.lat, longitude: near.lng },
        radius: 50000,
      },
    };
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Google Places ${res.status}`);

  const data = await res.json();
  const place = data.places?.[0];
  if (!place?.location) return null;

  return {
    name: place.formattedAddress || place.displayName?.text || query,
    lat: place.location.latitude,
    lng: place.location.longitude,
    type: 'place',
    source: 'google',
  };
}

async function nominatim(query) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`,
    { headers: { 'User-Agent': 'WanderForge/1.0' } }
  );
  if (!res.ok) throw new Error('Geocoding failed');

  const data = await res.json();
  return data.map((item) => ({
    name: item.display_name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    type: item.type,
    address: item.address,
    source: 'nominatim',
  }));
}

export async function GET(request) {
  // These routes spend the operator's Google and Groq quota, so they must
  // not be callable anonymously.
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const nearLat = parseFloat(searchParams.get('lat'));
  const nearLng = parseFloat(searchParams.get('lng'));

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  const near =
    Number.isFinite(nearLat) && Number.isFinite(nearLng)
      ? { lat: nearLat, lng: nearLng }
      : null;

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  if (googleKey) {
    try {
      const hit = await googlePlaces(googleKey, query, near);
      if (hit) return NextResponse.json({ results: [hit], source: 'google' });
    } catch (err) {
      console.warn('[WanderForge] Google Places unavailable, trying Nominatim:', err.message);
    }
  }

  try {
    const results = await nominatim(query);
    return NextResponse.json({ results, source: 'nominatim' });
  } catch (err) {
    return NextResponse.json({ error: err.message, results: [] }, { status: 500 });
  }
}
