/**
 * Server-side place lookup.
 *
 * Lifted out of /api/geocode so the generate route can resolve coordinates
 * before it validates a plan. That matters because the conflict checker's whole
 * job — is the journey between these two places possible in the gap left for it
 * — needs coordinates, and until now the only geocoding happened in the browser
 * *after* everything had already been written.
 *
 * Nominatim geocodes addresses, not businesses — it could not find "The Planters
 * Court", "Hirekolale Lake" or even "Chikmagaluru" (OSM indexes that city as
 * "Chikmagalur"). Google Places Text Search handles venue names and spelling
 * variants, so it is tried first, with Nominatim kept as a no-key fallback.
 *
 * Server-side only: these calls carry the operator's Google key.
 */

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
 * Resolve one query to coordinates, Google first then Nominatim.
 *
 * @returns {{results: object[], source: string}} — empty results rather than a
 *          throw, because a place that cannot be found is a normal outcome.
 */
export async function lookupPlace(query, near = null, { signal } = {}) {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  if (googleKey) {
    try {
      const hit = await googlePlaces(googleKey, query, near, { signal });
      if (hit) return { results: [hit], source: 'google' };
    } catch (err) {
      console.warn('[WanderForge] Google Places unavailable, trying Nominatim:', err.message);
    }
  }

  const results = await nominatim(query, { signal });
  return { results, source: 'nominatim' };
}

/** How many lookups may be in flight at once against Google. */
const GEOCODE_CONCURRENCY = 6;

/**
 * Ceiling on a single lookup.
 *
 * The deadline stops the pool *starting* work, but a request already in flight
 * against a hung provider would sail past it — and the route's whole budget
 * exists so the platform never kills the invocation mid-flight.
 */
const LOOKUP_TIMEOUT_MS = 6_000;

/** Same place name written two ways is still one billable lookup. */
const cacheKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Attach coordinates to every activity in a validated itinerary.
 *
 * Returns a NEW itinerary rather than mutating, and never throws: an activity
 * that cannot be located keeps `latitude`/`longitude` null, which the conflict
 * checker reports as an unverifiable leg rather than a clean bill of health.
 *
 * Only runs when a Google key is configured. Nominatim asks for at most one
 * request per second, and a 7-day itinerary is fifty-odd places — hammering it
 * from a server would be abuse, and doing it serially would blow the route's
 * time budget. Without a key the browser keeps geocoding as it always has, one
 * activity at a time.
 *
 * @param itinerary   validated `data.itinerary`
 * @param near        destination coordinates to bias toward, when known
 * @param deadlineAt  epoch ms after which no new lookup is started
 * @param known       pre-resolved coordinates by place name, from an earlier pass
 * @returns {{itinerary: array, located: number, total: number, coords: Map}}
 */
export async function geocodeItinerary(
  itinerary,
  { near = null, deadlineAt = Infinity, known = new Map() } = {}
) {
  const coords = new Map(known);
  const activities = itinerary.flatMap((day) => day.activities);
  const total = activities.length;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleKey) {
    return { itinerary, located: 0, total, coords, skipped: 'no-google-key' };
  }

  const pending = [
    ...new Set(
      activities
        .map((a) => a.location_name)
        .filter(Boolean)
        .map(cacheKey)
        .filter((k) => !coords.has(k))
    ),
  ];

  // A fixed-size pool rather than one giant Promise.all: fifty simultaneous
  // requests is how a per-minute Places quota gets tripped in one keystroke.
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const key = pending[cursor++];
      if (Date.now() >= deadlineAt) return;

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(0, Math.min(LOOKUP_TIMEOUT_MS, deadlineAt - Date.now()))
      );

      try {
        // googlePlaces rather than lookupPlace: the Nominatim fallback is
        // deliberately not reachable from here, so a Google failure on one place
        // cannot quietly turn into fifty server-side Nominatim requests.
        const hit = await googlePlaces(googleKey, key, near, { signal: controller.signal });
        if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
          coords.set(key, { lat: hit.lat, lng: hit.lng });
        }
      } catch {
        // An unlocatable place is not a failed generation. It becomes a
        // 'missing-coords' note on the checked itinerary instead.
      } finally {
        clearTimeout(timer);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(GEOCODE_CONCURRENCY, pending.length) }, worker)
  );

  let located = 0;
  const withCoords = itinerary.map((day) => ({
    ...day,
    activities: day.activities.map((act) => {
      const hit = act.location_name ? coords.get(cacheKey(act.location_name)) : null;
      if (hit) located++;
      return { ...act, latitude: hit?.lat ?? null, longitude: hit?.lng ?? null };
    }),
  }));

  return { itinerary: withCoords, located, total, coords };
}
