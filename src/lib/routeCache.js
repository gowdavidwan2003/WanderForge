/**
 * Shared cache for road legs.
 *
 * Google Routes is billed per leg, and a five-day itinerary is around thirty-five
 * of them — re-billed on every regeneration, every replan, and every time
 * somebody opens the trip. That is exactly the bill the geocode cache was built
 * to stop, so this is deliberately the same design: coarse key, shared across
 * users, thirty-day expiry, service-role writes.
 *
 * A road between two points is public geography. It is the same road for
 * everybody and it does not change often.
 */

/** Google Maps Platform terms: cached content expires after 30 days. */
export const CACHE_TTL_DAYS = 30;
export const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Coordinate rounding for the cache key.
 *
 * Three decimal places is about 110 m. Two points that close share a road for
 * any journey worth checking — the difference is which side of the car park you
 * stood in — and rounding is what lets one cached leg serve every user planning
 * the same pair of places, since geocoding returns very slightly different
 * coordinates for the same venue over time.
 */
const PRECISION = 3;

const round = (v) => Number(v).toFixed(PRECISION);

/** A usable coordinate, or null. Number(null) is 0, which is a real place. */
export function coord(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasCoords(point) {
  return coord(point?.lat ?? point?.latitude) != null
    && coord(point?.lng ?? point?.longitude) != null;
}

/** Normalise either shape — {lat,lng} or a DB row's {latitude,longitude}. */
export function toPoint(o) {
  const lat = coord(o?.lat ?? o?.latitude);
  const lng = coord(o?.lng ?? o?.longitude);
  return lat == null || lng == null ? null : { lat, lng };
}

/**
 * The key for one directed leg.
 *
 * Directed, not symmetric: one-way systems, ferries and mountain roads are not
 * the same journey in reverse, and the durations genuinely differ.
 */
export function legCacheKey(from, to, mode = 'car') {
  const a = toPoint(from);
  const b = toPoint(to);
  if (!a || !b) return null;
  return `${mode}:${round(a.lat)},${round(a.lng)}>${round(b.lat)},${round(b.lng)}`;
}

/**
 * The key conflictChecker looks a leg up by.
 *
 * Coordinates rather than activity ids, deliberately. Ids are not stable across
 * the boundary that matters: the generate route checks a plan whose activities
 * have no database ids yet, then the same legs are needed again in the editor
 * after they have been inserted with real ones. Coordinates survive that, and
 * survive a replan that rewrites every id on the day.
 */
export function legKey(from, to) {
  const a = toPoint(from);
  const b = toPoint(to);
  if (!a || !b) return null;
  return `${round(a.lat)},${round(a.lng)}>${round(b.lat)},${round(b.lng)}`;
}

export function isFresh(row, now = Date.now()) {
  if (!row?.expires_at) return false;
  const expires = new Date(row.expires_at).getTime();
  return Number.isFinite(expires) && expires > now;
}

/** Build the row to store for one resolved (or confirmed unroutable) leg. */
export function toRow(from, to, mode, leg, now = Date.now()) {
  const a = toPoint(from);
  const b = toPoint(to);
  return {
    cache_key: legCacheKey(from, to, mode),
    mode,
    from_lat: a.lat,
    from_lng: a.lng,
    to_lat: b.lat,
    to_lng: b.lng,
    km: Number.isFinite(leg?.km) ? leg.km : null,
    minutes: Number.isFinite(leg?.minutes) ? leg.minutes : null,
    source: leg?.source || 'google',
    expires_at: new Date(now + CACHE_TTL_MS).toISOString(),
  };
}

/**
 * Read many legs in one round trip.
 *
 * Returns an empty map on any failure. A cache that cannot be read is a cost
 * problem and must never become a correctness one — the checker simply falls
 * back to its straight-line estimate, which is what it did before this existed.
 */
export async function readCache(supabase, keys, now = Date.now()) {
  const found = new Map();
  if (!supabase || keys.length === 0) return found;

  try {
    const { data, error } = await supabase
      .from('route_cache')
      .select('cache_key, km, minutes, source, expires_at')
      .in('cache_key', keys);

    if (error) {
      console.warn('[WanderForge] Route cache unreadable, falling back to estimates:', error.message);
      return found;
    }

    for (const row of data || []) {
      if (isFresh(row, now)) found.set(row.cache_key, row);
    }
  } catch (err) {
    console.warn('[WanderForge] Route cache read failed:', err.message);
  }

  return found;
}

/** Store resolved legs. Needs the service role; a no-op without one. */
export async function writeCache(admin, rows) {
  if (!admin || rows.length === 0) return 0;

  try {
    const { error } = await admin.from('route_cache').upsert(rows, { onConflict: 'cache_key' });
    if (error) {
      console.warn('[WanderForge] Route cache write failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn('[WanderForge] Route cache write failed:', err.message);
    return 0;
  }
}
