/**
 * Weather, fetched on the destination rather than on the itinerary.
 *
 * fetchWeather() was called from inside fetchTripData(), so every realtime event
 * — including the echo of each of the 25 inserts an AI Generate makes — fetched
 * a forecast for coordinates that had not moved. The forecast depends on the
 * destination and the date, and neither changes when somebody edits an activity.
 *
 * A forecast is also worth keeping for a while. Open-Meteo updates hourly at
 * best, so re-fetching on every page view of the same trip buys nothing.
 * sessionStorage rather than memory so switching between trips and coming back
 * does not re-fetch either, and rather than localStorage so it cannot go stale
 * across days in a way nobody notices.
 */

const TTL_MS = 60 * 60 * 1000;
const PREFIX = 'wf-weather:';

/**
 * A usable coordinate, or null.
 *
 * Not Number.isFinite(Number(v)): Number(null) and Number('') are both 0, which
 * is a real place in the Gulf of Guinea. A trip with no destination coordinates
 * would have fetched a forecast for it.
 */
function coord(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coordinates rounded to ~1 km — finer than the forecast's own resolution. */
export function weatherKey(lat, lng) {
  return `${PREFIX}${coord(lat).toFixed(2)},${coord(lng).toFixed(2)}`;
}

/** Server-side rendering has no sessionStorage; treat that as a permanent miss. */
function store() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Storage can throw outright in a partitioned or cookie-blocked context.
    return null;
  }
}

export function readCachedWeather(lat, lng, now = Date.now()) {
  const s = store();
  if (!s || coord(lat) == null || coord(lng) == null) return null;

  try {
    const raw = s.getItem(weatherKey(lat, lng));
    if (!raw) return null;

    const { at, forecast } = JSON.parse(raw);
    if (!Array.isArray(forecast) || now - at > TTL_MS) return null;
    return forecast;
  } catch {
    return null;
  }
}

export function writeCachedWeather(lat, lng, forecast, now = Date.now()) {
  const s = store();
  if (!s || !Array.isArray(forecast) || coord(lat) == null || coord(lng) == null) return false;

  try {
    s.setItem(weatherKey(lat, lng), JSON.stringify({ at: now, forecast }));
    return true;
  } catch {
    // A full or unavailable quota is not a reason to fail the page.
    return false;
  }
}

/**
 * The forecast for a destination, from cache when it is fresh.
 *
 * Never throws: weather is decoration on the timeline, and losing it must not
 * take the trip with it.
 */
export async function fetchWeather(lat, lng) {
  if (coord(lat) == null || coord(lng) == null) return null;

  const cached = readCachedWeather(lat, lng);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    if (!Array.isArray(data.forecast)) return null;

    writeCachedWeather(lat, lng, data.forecast);
    return data.forecast;
  } catch {
    return null;
  }
}
