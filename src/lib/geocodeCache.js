/**
 * Shared cache for Google Places lookups.
 *
 * Places Text Search is the single most expensive call in the app: about $0.032
 * each, roughly 41 of them for a 5-day generation, so ~$1.30 a run — around 300x
 * the Groq completion that produced the itinerary. Groq rate-limits and fails
 * closed; Google keeps answering and keeps billing, so the cost only shows up on
 * the invoice.
 *
 * Nearly all of that is repeat work. A regenerate re-resolves every place it
 * resolved a minute earlier, a replan re-resolves the places it is explicitly
 * keeping, and destinations repeat heavily across users. The query string is
 * identical each time, so entries are shared across all users rather than scoped
 * to a trip: "Mullayanagiri" is the same mountain whoever asks.
 *
 * Server-side only. The key derivation is pure and tested; the I/O is thin.
 */

/**
 * Google Maps Platform terms allow caching content for up to 30 days.
 *
 * Enforced on read as well as by the purge job, so a cron that never ran delays
 * cleanup rather than serving stale content past the limit.
 */
export const CACHE_TTL_DAYS = 30;
export const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Normalise a place query so trivially different spellings share an entry.
 *
 * Case, surrounding whitespace, repeated spaces and trailing punctuation all
 * come out of a language model at random and none of them change the answer.
 * Nothing more aggressive than that: stripping words would merge places that are
 * genuinely different.
 */
export function normaliseQuery(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '');
}

/**
 * The bias cell a lookup belongs to.
 *
 * Bias is part of the key because it changes the answer — "District Museum" near
 * Chikmagaluru is not "District Museum" near Delhi. It is rounded to 0.1 degree
 * (~11 km) so that two users planning the same town share entries; the bias
 * radius sent to Google is 50 km, so a cell this size cannot move a result to a
 * different place.
 */
export function biasKey(near) {
  const lat = Number(near?.lat);
  const lng = Number(near?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

/** Primary key for one (query, bias) pair. */
export function cacheKey(query, near) {
  return `${normaliseQuery(query)}@${biasKey(near)}`;
}

/**
 * Is a stored row still usable?
 *
 * Belt and braces with the RLS policy's own `expires_at > NOW()`: this is the
 * check that holds when the row arrives from anywhere else, and it is the one
 * the tests can move time against.
 */
export function isFresh(row, now = Date.now()) {
  if (!row?.expires_at) return false;
  const expires = new Date(row.expires_at).getTime();
  return Number.isFinite(expires) && expires > now;
}

/** A cached row in the shape the rest of the code speaks. */
export function toHit(row) {
  if (row.lat == null || row.lng == null) return null;
  return {
    name: row.display_name || row.query,
    lat: row.lat,
    lng: row.lng,
    type: 'place',
    source: row.source || 'cache',
    cached: true,
  };
}

/** The row to store for one resolved (or confirmed-missing) query. */
export function toRow(query, near, hit, now = Date.now()) {
  return {
    cache_key: cacheKey(query, near),
    query: normaliseQuery(query),
    bias_key: biasKey(near),
    lat: hit?.lat ?? null,
    lng: hit?.lng ?? null,
    display_name: hit?.name ?? null,
    source: hit?.source || 'google',
    expires_at: new Date(now + CACHE_TTL_MS).toISOString(),
  };
}

/**
 * Read many keys in one round trip.
 *
 * @returns Map of cache_key → row. Empty on any failure: a cache that cannot be
 *          read is a cost problem, never a correctness one, so it must never
 *          fail a lookup.
 */
export async function readCache(supabase, keys, now = Date.now()) {
  const found = new Map();
  if (!supabase || keys.length === 0) return found;

  try {
    const { data, error } = await supabase
      .from('geocode_cache')
      .select('cache_key, query, lat, lng, display_name, source, expires_at')
      .in('cache_key', keys);

    if (error) {
      // Most likely the migration has not been run yet. Say so once, plainly,
      // rather than silently paying Google for every lookup forever.
      console.warn('[WanderForge] Geocode cache unreadable, falling back to Google:', error.message);
      return found;
    }

    for (const row of data || []) {
      if (isFresh(row, now)) found.set(row.cache_key, row);
    }
  } catch (err) {
    console.warn('[WanderForge] Geocode cache read failed:', err.message);
  }

  return found;
}

/**
 * Store resolved lookups.
 *
 * Needs the service-role client: the table has no insert policy, because one
 * user being able to write coordinates every other user then trusts is a worse
 * outcome than paying for a lookup. Without a service key the cache stays
 * read-only and this is a no-op.
 */
export async function writeCache(admin, rows) {
  if (!admin || rows.length === 0) return 0;

  try {
    const { error } = await admin
      .from('geocode_cache')
      .upsert(rows, { onConflict: 'cache_key' });

    if (error) {
      console.warn('[WanderForge] Geocode cache write failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn('[WanderForge] Geocode cache write failed:', err.message);
    return 0;
  }
}
