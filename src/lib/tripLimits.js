/**
 * Bounds on trip size.
 *
 * getDayCount() derived a day count straight from two date inputs with no upper
 * bound, and that number drove both cost centres: the generate route asks the
 * model for one day per day, and the editor then geocodes every activity it
 * returns — one billed Google Places Text Search each. A 7-day trip is already
 * around 50 billable calls, so a mistyped end year was a five-figure request.
 *
 * 30 days is generous for a real itinerary while keeping a single generation
 * bounded. Enforced in the wizard so the user gets told, and again on the server
 * because `days` arrives from the client and cannot be trusted.
 */
export const MAX_TRIP_DAYS = 30;

/** Days between two dates, inclusive, clamped to the cap. 0 if either is unset. */
export function tripDayCount(startDate, endDate) {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (!Number.isFinite(days)) return 0;

  return Math.min(Math.max(1, days), MAX_TRIP_DAYS);
}

/** True when the range asks for more than we will plan. */
export function exceedsDayLimit(startDate, endDate) {
  if (!startDate || !endDate) return false;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;

  return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1 > MAX_TRIP_DAYS;
}

/** Server-side clamp for a day count supplied by a client. */
export function clampRequestedDays(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_TRIP_DAYS);
}
