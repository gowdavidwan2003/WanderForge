/**
 * Presenting conflict-checker output.
 *
 * checkItinerary returns one flat list of issues for a whole trip. The editor
 * needs it three ways at once — per activity for the inline marks, per day for
 * the sidebar and the fix button, and whole-trip for the panel — and each of
 * those has to say plainly whether something is impossible or merely worth a
 * look. A modal listing thirty items with no severity is how the old panel
 * managed to be both exhaustive and useless.
 *
 * Pure, so the grouping and the hard/soft split can be tested without rendering.
 */

import { BLOCKING_TYPES } from '@/lib/conflictReport';

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

/**
 * Hard: the day cannot be executed as written. Two things at once, an activity
 * that ends before it starts, a journey that does not fit the gap left for it.
 * No amount of optimism fixes these, so they are what the fix button targets.
 *
 * Everything else is soft: a museum at 08:00 might be shut, a day might run over
 * the average daily budget. Worth saying, never worth blocking on. The same
 * split decides whether the generate route spends a second completion, and it
 * has to mean the same thing in both places.
 */
export function isHardConflict(issue) {
  return BLOCKING_TYPES.has(issue?.type);
}

/** The most serious severity present, or null for an empty list. */
export function worstSeverity(issues = []) {
  let worst = null;
  for (const issue of issues) {
    if (worst == null || SEVERITY_RANK[issue.severity] < SEVERITY_RANK[worst]) {
      worst = issue.severity;
    }
  }
  return worst;
}

/**
 * The issues attached to one activity.
 *
 * Whole-day issues (over-budget, long-day) carry no activityId and deliberately
 * do not appear here — pinning "this day is over budget" to whichever activity
 * happens to be last would be a lie about which one caused it.
 */
export function conflictsForActivity(issues = [], activityId) {
  if (!activityId) return [];
  return issues.filter((i) => i.activityId === activityId);
}

/** Everything on one day, split the way the UI needs it. */
export function dayConflictSummary(issues = [], dayNumber) {
  const onDay = issues.filter((i) => i.day === dayNumber);
  const hard = onDay.filter(isHardConflict);

  return {
    issues: onDay,
    hard,
    soft: onDay.filter((i) => !isHardConflict(i)),
    worst: worstSeverity(onDay),
    // The question the fix button asks: is this day impossible, or just untidy?
    impossible: hard.length > 0,
  };
}

/**
 * Issues grouped by day, in day order, days with nothing omitted.
 *
 * @returns {Array<{day: number, issues, hard, soft, worst, impossible}>}
 */
export function groupByDay(issues = []) {
  const dayNumbers = [...new Set(issues.map((i) => i.day).filter((d) => d != null))];
  return dayNumbers
    .sort((a, b) => a - b)
    .map((day) => ({ day, ...dayConflictSummary(issues, day) }));
}

/** One line for the top of the panel, in the language a traveler would use. */
export function headlineFor(report) {
  const issues = report?.issues || [];
  const hard = issues.filter(isHardConflict);

  if (issues.length === 0) {
    return {
      tone: 'ok',
      title: 'This itinerary works',
      detail:
        'Every transition has enough time for the real journey between those two places.',
    };
  }

  if (hard.length === 0) {
    return {
      tone: 'warn',
      title: 'Nothing impossible, a few things worth checking',
      detail: `${issues.length} note${issues.length === 1 ? '' : 's'} — opening hours, budget and distances. None of them stop the trip working.`,
    };
  }

  const days = new Set(hard.map((i) => i.day));
  return {
    tone: 'bad',
    title: `${hard.length} thing${hard.length === 1 ? '' : 's'} that will not work`,
    detail: `Across ${days.size} day${days.size === 1 ? '' : 's'}. These are not warnings — as written, the day cannot be walked.`,
  };
}
