/**
 * Booking cost helpers.
 *
 * Accommodation is stored as a per-night rate, so its contribution to the budget
 * depends on the stay length. Keeping the arithmetic here means the panel, the
 * trip header total, the PDF and the calendar export all agree.
 */

const parseDay = (value) => {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function nightsBetween(checkIn, checkOut) {
  const a = parseDay(checkIn);
  const b = parseDay(checkOut);
  if (!a || !b) return 0;
  const nights = Math.round((b - a) / 86400000);
  return nights > 0 ? nights : 0;
}

/**
 * What is wrong with a stay's dates, or null when they are fine.
 *
 * nightsBetween returns 0 for dates that are missing, unparseable or reversed,
 * and accommodationTotal then falls back to a single night. That fallback is
 * deliberate for a stay with no dates yet — it still represents a commitment —
 * but it made a genuine data error indistinguishable from an incomplete entry: a
 * check-out before its check-in silently billed exactly one night, and nothing
 * on screen said so.
 *
 * Returning the reason lets the UI say which it is, without changing what
 * anything costs.
 *
 * @returns {'no-dates'|'incomplete-dates'|'invalid-dates'|'reversed-dates'|'same-day'|null}
 */
export function stayDateIssue(stay) {
  const rawIn = stay?.check_in;
  const rawOut = stay?.check_out;

  if (!rawIn && !rawOut) return 'no-dates';
  if (!rawIn || !rawOut) return 'incomplete-dates';

  const a = parseDay(rawIn);
  const b = parseDay(rawOut);
  if (!a || !b) return 'invalid-dates';

  if (b < a) return 'reversed-dates';
  if (b.getTime() === a.getTime()) return 'same-day';
  return null;
}

/** Human-readable warning for a stay, or null when the dates are usable. */
export function stayDateWarning(stay) {
  switch (stayDateIssue(stay)) {
    case 'no-dates':
      return 'No dates set — counted as one night.';
    case 'incomplete-dates':
      return 'Only one date set — counted as one night.';
    case 'invalid-dates':
      return 'These dates could not be read — counted as one night.';
    case 'reversed-dates':
      return 'Check-out is before check-in — counted as one night until fixed.';
    case 'same-day':
      return 'Check-in and check-out are the same day — counted as one night.';
    default:
      return null;
  }
}

/**
 * Total cost of one accommodation across its whole stay.
 *
 * Unusable dates count as one night rather than zero, so a half-entered booking
 * still shows up in the budget instead of quietly costing nothing. The reason is
 * available separately through stayDateWarning, so "one night" is a stated
 * assumption rather than a silent one.
 */
export function accommodationTotal(stay) {
  const rate = Number(stay?.cost_per_night) || 0;
  if (!rate || rate < 0) return 0;
  const nights = nightsBetween(stay?.check_in, stay?.check_out) || 1;
  return rate * nights;
}

export function bookingsTotal(stays = [], transport = []) {
  const staysTotal = stays.reduce((sum, s) => sum + accommodationTotal(s), 0);
  const transportTotal = transport.reduce((sum, t) => sum + (Number(t.cost) || 0), 0);
  return { staysTotal, transportTotal, total: staysTotal + transportTotal };
}
