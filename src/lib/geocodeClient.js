/**
 * Browser-side geocoding, batched.
 *
 * Every path that needed coordinates used to await one /api/geocode GET per
 * activity inside a loop — slow, and expensive in a way nothing surfaced: at
 * ~$0.032 a Places call, a 5-day itinerary was around $1.30, re-spent in full
 * every time it was regenerated or replanned. The server resolves a whole batch
 * against a shared cache in one round trip, so ask it once.
 *
 * Never throws. A place that cannot be resolved is absent from the returned map,
 * which callers already handle by saving the activity without coordinates.
 */

/** The server's own ceiling; chunk to stay under it rather than being rejected. */
const MAX_BATCH = 60;

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * @param queries place names; blanks and duplicates are dropped
 * @param near    { lat, lng } to bias toward, when known
 * @returns Map of the ORIGINAL query string → { lat, lng, name }
 */
export async function geocodeBatch(queries = [], near = null) {
  const found = new Map();
  const unique = [...new Set(queries.filter((q) => q && String(q).trim()))];
  if (unique.length === 0) return found;

  for (const batch of chunk(unique, MAX_BATCH)) {
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: batch,
          ...(near?.lat != null && near?.lng != null ? { lat: near.lat, lng: near.lng } : {}),
        }),
      });

      const data = await res.json();
      for (const [query, hit] of Object.entries(data.results || {})) {
        if (hit) found.set(query, hit);
      }
    } catch {
      // Coordinates are an enhancement — the map pin and the travel-time check.
      // Losing them must never lose the itinerary they belong to.
    }
  }

  return found;
}

/**
 * The place names in a set of activities that still need resolving.
 *
 * Skipping the ones that already have coordinates is most of the saving on a
 * replan, where nearly every place is one the traveler is explicitly keeping.
 */
export function unresolvedLocations(activities = []) {
  return activities
    .filter((a) => a?.location_name && !(Number.isFinite(a.latitude) && Number.isFinite(a.longitude)))
    .map((a) => a.location_name);
}
