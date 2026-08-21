/**
 * Working out what changing a trip's dates does to its days.
 *
 * A trip's days are numbered 1..n and carry a date each. Move the start date and
 * every day's date shifts; shorten the range and days fall off the end — and
 * those days may have activities on them, which cascade away with the day.
 *
 * That last part is why this is a module and not three lines inside a form
 * handler. Silently destroying a planned day because someone corrected an end
 * date by one is exactly the kind of loss the atomic-write work exists to
 * prevent, so the caller is told what is at risk before anything is written.
 *
 * Pure. Dates in and out are 'YYYY-MM-DD' strings, matching the DATE columns.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse 'YYYY-MM-DD' as a UTC date, so no timezone can shift it by a day. */
export function parseDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Inclusive day count between two dates, or 0 if either is unusable. */
export function daysBetween(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b) return 0;
  return Math.floor((b - a) / DAY_MS) + 1;
}

/** The dates a trip of this range should have, day 1 first. */
export function datesForRange(start, count) {
  const from = parseDate(start);
  if (!from || count < 1) return [];
  return Array.from({ length: count }, (_, i) => formatDate(new Date(from.getTime() + i * DAY_MS)));
}

/**
 * What a date change does to the existing days.
 *
 * Days are matched by day_number, not by date: the traveler's "day 3" is the
 * third day of the trip whatever calendar date it lands on, and its activities
 * belong to that position in the plan. Matching by date instead would move
 * activities to whichever day happened to share a date, or strand them all when
 * the trip shifts by a week.
 *
 * @param existingDays trip_days rows: { id, day_number, date }
 * @param activities   { [dayId]: Activity[] }, so removals can be counted
 * @returns {{
 *   days: Array<{day_number, date}>,   the full desired day list, for the RPC
 *   added: number,
 *   removed: Array<{day_number, activityCount}>,
 *   shifted: number,                   kept days whose date changes
 *   activitiesLost: number,
 *   unchanged: boolean
 * }}
 */
export function planDayChanges(existingDays = [], { startDate, endDate }, activities = {}) {
  const count = daysBetween(startDate, endDate);
  const dates = datesForRange(startDate, count);

  const days = dates.map((date, i) => ({ day_number: i + 1, date }));
  const byNumber = new Map(existingDays.map((d) => [d.day_number, d]));

  const removed = [];
  for (const day of existingDays) {
    if (day.day_number > count) {
      removed.push({
        day_number: day.day_number,
        activityCount: (activities[day.id] || []).length,
      });
    }
  }

  let shifted = 0;
  let added = 0;
  for (const day of days) {
    const existing = byNumber.get(day.day_number);
    if (!existing) added++;
    else if ((existing.date || null) !== day.date) shifted++;
  }

  return {
    days,
    added,
    removed,
    shifted,
    activitiesLost: removed.reduce((sum, d) => sum + d.activityCount, 0),
    unchanged: added === 0 && shifted === 0 && removed.length === 0,
  };
}

/**
 * The sentence shown before a destructive date change is applied.
 *
 * Returns null when nothing would be lost — there is no reason to interrupt
 * somebody fixing a typo with a confirmation about days.
 */
export function describeDayChanges(plan) {
  if (!plan || plan.removed.length === 0) return null;

  const dayList = plan.removed.map((d) => d.day_number).join(', ');
  const dayWord = plan.removed.length === 1 ? 'Day' : 'Days';

  if (plan.activitiesLost === 0) {
    return `${dayWord} ${dayList} fall outside the new dates and will be removed. They are empty, so nothing is lost.`;
  }

  return `${dayWord} ${dayList} fall outside the new dates and will be removed, along with ${plan.activitiesLost} ${plan.activitiesLost === 1 ? 'activity' : 'activities'} planned on ${plan.removed.length === 1 ? 'it' : 'them'}. This cannot be undone.`;
}

/**
 * Validate the editable fields of a trip.
 *
 * Mirrors what the wizard enforces on creation. A trip that could not have been
 * created this way should not be reachable by editing one that could.
 */
export function validateTripEdit({ title, destination, startDate, endDate, totalBudget }, maxDays) {
  const errors = [];

  if (!String(title || '').trim()) errors.push('A trip needs a title.');
  if (!String(destination || '').trim()) errors.push('A trip needs a destination.');

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (!start) errors.push('The start date is not a valid date.');
  if (!end) errors.push('The end date is not a valid date.');

  if (start && end) {
    if (end < start) errors.push('The end date is before the start date.');
    else if (maxDays && daysBetween(startDate, endDate) > maxDays) {
      errors.push(`Trips are limited to ${maxDays} days. Split a longer journey into separate trips.`);
    }
  }

  if (totalBudget !== '' && totalBudget != null) {
    const n = Number(totalBudget);
    if (!Number.isFinite(n) || n < 0) errors.push('The budget must be a number, or left empty.');
  }

  return { ok: errors.length === 0, errors };
}
