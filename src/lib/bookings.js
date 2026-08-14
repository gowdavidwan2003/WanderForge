/**
 * Booking cost helpers.
 *
 * Accommodation is stored as a per-night rate, so its contribution to the budget
 * depends on the stay length. Keeping the arithmetic here means the panel, the
 * trip header total, the PDF and the calendar export all agree.
 */

export function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(`${checkIn}T00:00:00`);
  const b = new Date(`${checkOut}T00:00:00`);
  const nights = Math.round((b - a) / 86400000);
  return nights > 0 ? nights : 0;
}

/** Total cost of one accommodation across its whole stay. */
export function accommodationTotal(stay) {
  const rate = Number(stay?.cost_per_night) || 0;
  if (!rate) return 0;
  // A stay with no dates still represents one night's commitment.
  const nights = nightsBetween(stay?.check_in, stay?.check_out) || 1;
  return rate * nights;
}

export function bookingsTotal(stays = [], transport = []) {
  const staysTotal = stays.reduce((sum, s) => sum + accommodationTotal(s), 0);
  const transportTotal = transport.reduce((sum, t) => sum + (Number(t.cost) || 0), 0);
  return { staysTotal, transportTotal, total: staysTotal + transportTotal };
}
