/**
 * Server-side place lookup, cached and batched.
 *
 * Lifted out of /api/geocode so the generate route can resolve coordinates
 * before it validates a plan. That matters because the conflict checker's whole
 * job — is the journey between these two places possible in the gap left for it
 * — needs coordinates, and geocoding used to happen in the browser only *after*
 * everything had already been written.
 *
 * Nominatim geocodes addresses, not businesses — it could not find "The Planters
 * Court", "Hirekolale Lake" or even "Chikmagaluru" (OSM indexes that city as
 * "Chikmagalur"). Google Places Text Search handles venue names and spelling
 * variants, so it is tried first, with Nominatim kept as a no-key fallback.
 *
 * Everything goes through resolvePlaces, which is batched and cache-backed.
 * Places is ~$0.032 a call and the app was making around 41 of them per 5-day
 * generation, re-resolving the same place names on every regenerate and replan —
 * about 300x the cost of the Groq completion that produced the itinerary, and
 * unlike Groq it never fails closed.
 *
 * Server-side only: these calls carry the operator's Google key.
 */

import {
  cacheKey,
  normaliseQuery,
  readCache,
  toHit,
  toRow,
  writeCache,
} from '@/lib/geocodeCache';

/** How many lookups may be in flight at once against Google. */
const GEOCODE_CONCURRENCY = 6;

/**
 * Ceiling on a single lookup.
 *
 * A deadline stops the pool *starting* work, but a request already in flight
 * against a hung provider would sail past it — and the generate route's budget
 * exists so the platform never kills the invocation mid-flight.
 */
const LOOKUP_TIMEOUT_MS = 6_000;

/** One Google Places Text Search, biased toward the trip's destination. */
export async function googlePlaces(apiKey, query, near, { signal } = {}) {
  const body = { textQuery: query, maxResultCount: 1 };

  // Bias toward the destination so "District Museum" resolves near the right
  // town rather than to a same-named place on the other side of the country.
  if (near?.lat != null && near?.lng != null) {
    body.locationBias = {
      circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 },
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
    signal,
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

/** Nominatim fallback. Returns every match, best first. */
export async function nominatim(query, { signal } = {}) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`,
    { headers: { 'User-Agent': 'WanderForge/1.0' }, signal }
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

/**
 * Resolve many place names at once.
 *
 * The order of operations is the cost fix: normalise and dedupe, then one cache
 * read for the whole batch, then Google for whatever is left — pooled, not the
 * sequential await-inside-a-nested-loop this replaces. A generation for a
 * destination somebody has already planned should reach Google zero times.
 *
 * Never throws. A place that cannot be resolved comes back as null, which
 * downstream becomes a 'missing-coords' note rather than a failed generation.
 *
 * @param queries     place names, in any casing, with duplicates
 * @param near        coordinates to bias toward, when known
 * @param deadlineAt  epoch ms after which no new lookup is started
 * @param cache       { supabase, admin } — read client and service-role writer
 * @param known       already-resolved coordinates by normalised query
 * @returns {{hits: Map, stats: {requested, unique, fromCache, fromProvider, missed}}}
 */
export async function resolvePlaces(
  queries = [],
  { near = null, deadlineAt = Infinity, cache = null, known = new Map() } = {}
) {
  const hits = new Map(known);
  const stats = { requested: 0, unique: 0, fromCache: 0, fromProvider: 0, missed: 0 };

  const wanted = [];
  for (const q of queries) {
    const norm = normaliseQuery(q);
    if (!norm) continue;
    stats.requested++;
    if (!hits.has(norm) && !wanted.includes(norm)) wanted.push(norm);
  }
  stats.unique = wanted.length;
  if (wanted.length === 0) return { hits, stats };

  // --- 1. One round trip for the whole batch ---------------------------
  const cached = await readCache(
    cache?.supabase,
    wanted.map((q) => cacheKey(q, near))
  );

  const misses = [];
  for (const norm of wanted) {
    const row = cached.get(cacheKey(norm, near));
    if (!row) {
      misses.push(norm);
      continue;
    }
    stats.fromCache++;
    // A cached miss is still a cache hit. An unfindable place name is re-asked
    // on every regenerate, and Google bills for those answers too.
    const hit = toHit(row);
    if (hit) hits.set(norm, hit);
    else stats.missed++;
  }

  if (misses.length === 0) return { hits, stats };

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) {
    // Nominatim asks for at most one request per second, and a 7-day itinerary
    // is fifty-odd places. Batching that from a server would be abuse, so
    // without a Google key the browser keeps resolving one at a time.
    stats.missed += misses.length;
    return { hits, stats, skipped: 'no-google-key' };
  }

  // --- 2. Pool the misses, bounded by the caller's deadline -------------
  const resolved = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < misses.length) {
      const norm = misses[cursor++];
      if (Date.now() >= deadlineAt) return;

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(0, Math.min(LOOKUP_TIMEOUT_MS, deadlineAt - Date.now()))
      );

      try {
        // googlePlaces rather than lookupPlace: the Nominatim fallback is
        // deliberately not reachable from a batch, so one Google failure cannot
        // quietly become fifty server-side Nominatim requests.
        const hit = await googlePlaces(googleKey, norm, near, { signal: controller.signal });
        stats.fromProvider++;
        if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
          hits.set(norm, hit);
          resolved.push(toRow(norm, near, hit));
        } else {
          stats.missed++;
          resolved.push(toRow(norm, near, null));
        }
      } catch {
        // A transport failure is not a confirmed miss, so it is NOT cached —
        // caching it would make one bad minute cost the place for 30 days.
        stats.missed++;
      } finally {
        clearTimeout(timer);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(GEOCODE_CONCURRENCY, misses.length) }, worker)
  );

  // --- 3. Pay this bill once ------------------------------------------
  await writeCache(cache?.admin, resolved);

  return { hits, stats };
}

/**
 * Resolve one query, Google first then Nominatim.
 *
 * The single-query path behind /api/geocode's GET, kept because Nominatim is a
 * usable fallback for one interactive lookup even though it is not for a batch.
 *
 * @returns {{results: object[], source: string}} — empty results rather than a
 *          throw, because a place that cannot be found is a normal outcome.
 */
export async function lookupPlace(query, near = null, { cache = null } = {}) {
  const { hits, stats } = await resolvePlaces([query], { near, cache });
  const hit = hits.get(normaliseQuery(query));

  if (hit) return { results: [hit], source: hit.cached ? 'cache' : hit.source };

  // Only fall back when Google was never asked. If Google answered and found
  // nothing, that answer is cached and asking Nominatim would undo it.
  if (stats.fromProvider === 0 && stats.fromCache === 0) {
    const results = await nominatim(query);
    return { results, source: 'nominatim' };
  }

  return { results: [], source: 'google' };
}

/**
 * Attach coordinates to every activity in a validated itinerary.
 *
 * Returns a NEW itinerary rather than mutating, and never throws: an activity
 * that cannot be located keeps `latitude`/`longitude` null, which the conflict
 * checker reports as an unverifiable leg rather than a clean bill of health.
 *
 * Activities that already carry coordinates are left alone — a replan keeps most
 * of its places, and re-resolving them is the same lookup paid for twice.
 *
 * @returns {{itinerary: array, located: number, total: number, hits: Map, stats: object}}
 */
export async function geocodeItinerary(
  itinerary,
  { near = null, deadlineAt = Infinity, known = new Map(), cache = null } = {}
) {
  const activities = itinerary.flatMap((day) => day.activities);
  const total = activities.length;

  const queries = activities
    .filter((a) => a.location_name && !Number.isFinite(a.latitude))
    .map((a) => a.location_name);

  const { hits, stats } = await resolvePlaces(queries, { near, deadlineAt, known, cache });

  let located = 0;
  const withCoords = itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((act) => {
      if (Number.isFinite(act.latitude) && Number.isFinite(act.longitude)) {
        located++;
        return act;
      }
      const hit = act.location_name ? hits.get(normaliseQuery(act.location_name)) : null;
      if (hit) located++;
      return { ...act, latitude: hit?.lat ?? null, longitude: hit?.lng ?? null };
    }),
  }));

  return { itinerary: withCoords, located, total, hits, stats };
}
