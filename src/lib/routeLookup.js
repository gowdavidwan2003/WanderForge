import {
  legCacheKey,
  legKey,
  readCache,
  toPoint,
  toRow,
  writeCache,
} from '@/lib/routeCache';

/**
 * Real road distances and durations, cached and batched.
 *
 * Lifted out of /api/route-matrix so the generate route can measure a plan
 * before it decides whether to re-prompt, and so the editor can measure one it
 * has already saved.
 *
 * Why this exists at all: conflictChecker has always had a correction for
 * winding roads, and it has never run, because it needs the real road distance
 * and nothing supplied one.
 *
 * Measured against the route this product was built around — Chikmagaluru town to
 * Mullayanagiri, straight-line 10.1 km:
 *
 *   flat estimate, no road data   35 min   <- what every check used to do
 *   sinuosity model, road km only 71 min
 *   Google Routes, measured       56 min   <- 21.6 km, 44 min driving + overhead
 *
 * So the flat model was 1.6x optimistic, and the sinuosity fallback overshoots
 * by 1.27x. Using the provider's own duration when there is one is clearly best,
 * and is what resolveLegs supplies.
 *
 * Server-side only: these calls carry the operator's Google key.
 */

const ORS_PROFILE = {
  car: 'driving-car',
  mixed: 'driving-car',
  public_transit: 'driving-car',
  flight: 'driving-car',
  bike: 'cycling-regular',
  walking: 'foot-walking',
};

const GOOGLE_MODE = {
  car: 'DRIVE',
  mixed: 'DRIVE',
  flight: 'DRIVE',
  public_transit: 'TRANSIT',
  bike: 'BICYCLE',
  walking: 'WALK',
};

/** How many Routes calls may be in flight at once. */
const CONCURRENCY = 6;

/** Ceiling on one leg, so a hung provider cannot outlast the route's budget. */
const LEG_TIMEOUT_MS = 6_000;

/**
 * One Google Routes call.
 *
 * The batched computeRouteMatrix endpoint needs billing enabled, so this is one
 * computeRoutes per leg — which is exactly why the cache in front of it matters.
 */
export async function googleLeg(apiKey, from, to, mode, { signal } = {}) {
  const travelMode = GOOGLE_MODE[mode] || 'DRIVE';

  const body = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode,
  };
  // Traffic-aware routing is only valid for DRIVE, and better reflects what a
  // traveler actually sees in the Google Maps app.
  if (travelMode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw new Error(`Google Routes ${res.status}`);

  const data = await res.json();
  const route = data.routes?.[0];
  // No route is a real answer — an island, a closed border — and worth caching
  // so it is not re-asked on every check.
  if (!route) return { km: null, minutes: null, source: 'google' };

  // Durations come back as protobuf-style strings, e.g. "2809s".
  const secs = parseFloat(String(route.duration || '').replace('s', ''));
  return {
    km: (route.distanceMeters ?? 0) / 1000,
    minutes: Number.isFinite(secs) ? secs / 60 : null,
    source: 'google',
  };
}

/**
 * OpenRouteService, one matrix call for a whole chain.
 *
 * Much cheaper than per-leg Google calls, and the fallback when Google is
 * unconfigured or rate-limited.
 */
export async function orsMatrix(apiKey, coordinates, mode, { signal } = {}) {
  const profile = ORS_PROFILE[mode] || ORS_PROFILE.car;
  const res = await fetch(`https://api.openrouteservice.org/v2/matrix/${profile}`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: coordinates, metrics: ['duration', 'distance'] }),
    signal,
  });
  if (!res.ok) throw new Error(`ORS ${res.status}`);

  const data = await res.json();
  const legs = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const meters = data.distances?.[i]?.[i + 1];
    const seconds = data.durations?.[i]?.[i + 1];
    legs.push({
      from: i,
      to: i + 1,
      km: typeof meters === 'number' ? meters / 1000 : null,
      minutes: typeof seconds === 'number' ? seconds / 60 : null,
    });
  }
  return legs;
}

/**
 * Every consecutive pair on a day that has coordinates at both ends.
 *
 * Exported because both the generate route and the editor need the same notion
 * of "which legs matter", and because the pairs are what gets counted when
 * deciding whether a check is worth paying for.
 */
export function legsForDay(activities = []) {
  const pairs = [];
  for (let i = 1; i < activities.length; i++) {
    const from = toPoint(activities[i - 1]);
    const to = toPoint(activities[i]);
    if (!from || !to) continue;
    // A leg to the same place is not a journey.
    if (legKey(from, to) === legKey(from, from)) continue;
    pairs.push({ from, to });
  }
  return pairs;
}

/** Every leg across a whole itinerary, deduplicated. */
export function legsForItinerary(days = [], activitiesByDay = {}) {
  const seen = new Set();
  const pairs = [];

  for (const day of days) {
    for (const pair of legsForDay(activitiesByDay[day.id] || [])) {
      const key = legKey(pair.from, pair.to);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pairs.push(pair);
    }
  }

  return pairs;
}

/**
 * Resolve road distances and durations for a set of legs.
 *
 * Cache first, always. A destination somebody has already planned costs nothing,
 * and a regeneration of the same trip costs nothing — which is what makes it
 * affordable to run this on every generation rather than behind a button.
 *
 * Never throws. An unresolvable leg is simply absent from the result, and
 * conflictChecker falls back to its straight-line estimate for that pair, which
 * is what every check did before this existed.
 *
 * @returns {{legs: Object, stats: {requested, fromCache, fromProvider, missed}}}
 *          legs is keyed by legKey(from, to) — coordinates, not activity ids —
 *          ready to hand straight to checkItinerary.
 */
export async function resolveLegs(
  pairs = [],
  { mode = 'car', cache = null, deadlineAt = Infinity } = {}
) {
  const legs = {};
  const stats = { requested: pairs.length, fromCache: 0, fromProvider: 0, missed: 0 };
  if (pairs.length === 0) return { legs, stats };

  // --- 1. One round trip for the whole batch --------------------------
  const cached = await readCache(cache?.supabase, pairs.map((p) => legCacheKey(p.from, p.to, mode)));

  const misses = [];
  for (const pair of pairs) {
    const row = cached.get(legCacheKey(pair.from, pair.to, mode));
    if (!row) {
      misses.push(pair);
      continue;
    }
    stats.fromCache++;
    // A cached no-route is still a cache hit; it just has nothing to offer the
    // checker, which then uses its own estimate.
    if (row.km != null || row.minutes != null) {
      legs[legKey(pair.from, pair.to)] = { km: row.km, minutes: row.minutes };
    }
  }

  if (misses.length === 0) return { legs, stats };

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const orsKey = process.env.OPENROUTESERVICE_API_KEY || process.env.NEXT_PUBLIC_ORS_API_KEY;

  if (!googleKey && !orsKey) {
    stats.missed += misses.length;
    return { legs, stats, skipped: 'no-routing-key' };
  }

  const resolved = [];

  // --- 2. Google, pooled and deadline-bounded --------------------------
  if (googleKey) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < misses.length) {
        const pair = misses[cursor++];
        if (Date.now() >= deadlineAt) return;

        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          Math.max(0, Math.min(LEG_TIMEOUT_MS, deadlineAt - Date.now()))
        );

        try {
          const leg = await googleLeg(googleKey, pair.from, pair.to, mode, { signal: controller.signal });
          stats.fromProvider++;
          if (leg.km != null || leg.minutes != null) {
            legs[legKey(pair.from, pair.to)] = { km: leg.km, minutes: leg.minutes };
          } else {
            stats.missed++;
          }
          resolved.push(toRow(pair.from, pair.to, mode, leg));
        } catch {
          // A transport failure is NOT cached — caching it would make one bad
          // minute cost this leg its real numbers for thirty days.
          stats.missed++;
        } finally {
          clearTimeout(timer);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, misses.length) }, worker));
  }

  // --- 3. Whatever Google could not do, in one ORS matrix --------------
  const stillMissing = misses.filter((p) => !legs[legKey(p.from, p.to)]);
  if (orsKey && stillMissing.length && Date.now() < deadlineAt) {
    try {
      // ORS returns consecutive legs along a chain, so ask for each pair as its
      // own two-point chain rather than assuming the misses form a path.
      for (const pair of stillMissing.slice(0, 25)) {
        const [leg] = await orsMatrix(
          orsKey,
          [[pair.from.lng, pair.from.lat], [pair.to.lng, pair.to.lat]],
          mode
        );
        if (leg && (leg.km != null || leg.minutes != null)) {
          legs[legKey(pair.from, pair.to)] = { km: leg.km, minutes: leg.minutes };
          resolved.push(toRow(pair.from, pair.to, mode, { ...leg, source: 'ors' }));
          stats.fromProvider++;
          stats.missed = Math.max(0, stats.missed - 1);
        }
      }
    } catch (err) {
      console.warn('[WanderForge] ORS fallback failed:', err.message);
    }
  }

  // --- 4. Pay this bill once -------------------------------------------
  await writeCache(cache?.admin, resolved);

  return { legs, stats };
}
