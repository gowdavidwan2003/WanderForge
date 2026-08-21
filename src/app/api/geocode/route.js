import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/requireUser';
import { lookupPlace, resolvePlaces } from '@/lib/placeLookup';
import { normaliseQuery } from '@/lib/geocodeCache';
import { getGeocodeCacheClients } from '@/lib/api/geocodeCacheClients';

/**
 * Place lookup for activity locations.
 *
 * The provider logic lives in @/lib/placeLookup so the generate route can resolve
 * coordinates server-side before the conflict checker runs — the checker cannot
 * judge travel time between two places it has no coordinates for.
 *
 * GET  resolves one query, for interactive lookups.
 * POST resolves many at once, cache-first. Every client loop that used to await
 *      one GET per activity should use it: at ~$0.032 a Places call, a 5-day
 *      itinerary geocoded one activity at a time is around $1.30 that a batch
 *      against a warm cache costs nothing.
 */

/** Refuse absurd batches rather than letting one request run up a bill. */
const MAX_BATCH = 60;

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

  try {
    const cache = await getGeocodeCacheClients();
    const { results, source } = await lookupPlace(query, near, { cache });
    return NextResponse.json({ results, source });
  } catch (err) {
    return NextResponse.json({ error: err.message, results: [] }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const { queries, lat, lng } = await request.json();

    if (!Array.isArray(queries)) {
      return NextResponse.json({ error: 'queries must be an array' }, { status: 400 });
    }
    if (queries.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Too many queries (max ${MAX_BATCH})` },
        { status: 400 }
      );
    }

    const near =
      Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
        ? { lat: Number(lat), lng: Number(lng) }
        : null;

    const cache = await getGeocodeCacheClients();
    const { hits, stats } = await resolvePlaces(queries, { near, cache });

    // Keyed by the caller's own strings, so it does not have to know how
    // queries are normalised. Unresolved places come back as null rather than
    // being absent, which is a different thing from "not asked for".
    const results = {};
    for (const query of queries) {
      const hit = hits.get(normaliseQuery(query));
      results[query] = hit ? { lat: hit.lat, lng: hit.lng, name: hit.name } : null;
    }

    return NextResponse.json({ results, stats });
  } catch (err) {
    return NextResponse.json({ error: err.message, results: {} }, { status: 500 });
  }
}
