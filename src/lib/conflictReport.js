/**
 * Bridge between a freshly generated itinerary and the conflict checker.
 *
 * checkItinerary works on saved rows — trip days with ids, activities keyed by
 * day id. A generated plan has neither, so it is shaped into that form here and
 * checked before anything is written. Running the check after the insert would
 * have been easier and useless: by then the traveler already owns an itinerary
 * that cannot be walked.
 *
 * Pure. No network, no database.
 */

import { checkItinerary } from '@/lib/conflictChecker';

/**
 * The issue types that mean "this plan cannot be executed", as opposed to
 * "worth a look".
 *
 * travel-time is included at warning severity as well as error. The checker
 * grades anything under 30 minutes short as a warning, but a day that is 20
 * minutes short at every hop is exactly the failure this feature exists to
 * catch — it just fails politely.
 */
export const BLOCKING_TYPES = new Set(['overlap', 'invalid-duration', 'travel-time']);

/** Synthetic day id, so activities can be keyed the way the checker expects. */
const dayId = (dayNumber) => `gen-day-${dayNumber}`;

/**
 * Shape a validated itinerary into the checker's (trip, days, activities) form.
 *
 * Ids are synthetic and local to this request; nothing persists them. They exist
 * so the checker can key activities by day and name the activity an issue is
 * about.
 */
export function toCheckerInput(itinerary = []) {
  const days = itinerary.map((day) => ({ id: dayId(day.day), day_number: day.day }));

  const activities = {};
  for (const day of itinerary) {
    activities[dayId(day.day)] = day.activities.map((act, i) => ({
      ...act,
      id: `${dayId(day.day)}-act-${i}`,
    }));
  }

  return { days, activities };
}

/**
 * Check a validated itinerary.
 *
 * @param itinerary validated `data.itinerary`, with coordinates where known
 * @param trip      { transport_mode, total_budget, currency } for the checks
 *                  that need them
 * @param roadLegs  measured road legs, keyed by roadLegKey. Without them the
 *                  travel estimates are straight-line and optimistic on winding
 *                  roads, which is what they were until routeLookup existed.
 */
export function checkGeneratedItinerary(itinerary = [], trip = {}, roadLegs = {}) {
  const { days, activities } = toCheckerInput(itinerary);
  return checkItinerary(trip, days, activities, roadLegs);
}

/** The issues worth spending a second completion on. */
export function blockingIssues(issues = []) {
  return issues.filter((i) => BLOCKING_TYPES.has(i.type));
}

/**
 * The itinerary restated as compactly as it can be and still be actionable.
 *
 * The re-prompt used to carry the model's own previous answer verbatim, which is
 * the obvious way to give it context. It does not survive contact with the token
 * ceiling: Groq counts prompt plus reserved completion against one 8,000 TPM
 * allowance, and a 5-day itinerary echoed back as JSON is ~3,000 prompt tokens.
 * That leaves too little budget to re-emit the itinerary, so the retry truncates
 * — and a truncated retry looks exactly like a model that cannot follow
 * instructions, while actually being a model that was never given room to answer.
 *
 * A digest is ~15 tokens per activity instead of ~100, and carries everything a
 * rescheduling decision needs: which day, what order, what times, where.
 */
export function planDigest(itinerary = []) {
  const lines = [];
  for (const day of itinerary) {
    lines.push(`Day ${day.day}:`);
    for (const act of day.activities || []) {
      const where = act.location_name && act.location_name !== act.title
        ? ` @ ${act.location_name}`
        : '';
      lines.push(`  ${act.start_time}-${act.end_time} ${act.title}${where} [${act.category}]`);
    }
  }
  return lines.join('\n');
}

/**
 * Name the conflicts back to the model.
 *
 * The checker's messages are already written for a person — they quote both
 * activity titles, the gap available and the journey needed — so they are handed
 * over verbatim rather than re-summarised. Telling the model only "day 2 has a
 * travel-time problem" is what produced the same broken day a second time.
 */
export function conflictRetryPrompt(issues = [], itinerary = []) {
  const blocking = blockingIssues(issues);
  if (blocking.length === 0) return null;

  const byDay = new Map();
  for (const issue of blocking) {
    if (!byDay.has(issue.day)) byDay.set(issue.day, []);
    byDay.get(issue.day).push(issue.message);
  }

  const lines = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    lines.push(`Day ${day}:`);
    for (const message of byDay.get(day)) lines.push(`  - ${message}`);
  }

  const digest = planDigest(itinerary);

  return [
    'This is the itinerary you produced:',
    '',
    digest,
    '',
    'It was checked against estimated road distances and driving times, and these transitions do not work:',
    '',
    ...lines,
    '',
    'These are measured, not estimated — do not argue with them, fix them. For each one:',
    '- Remove an activity from that day, or move it to another day, until the remaining ones fit.',
    '- Or add a "transport" entry covering the journey, with start_time and end_time that actually span it.',
    '- Do not shorten a journey to make it fit. Do not simply shift times by a few minutes.',
    '',
    'Fewer activities on a day is the correct answer. Resend the COMPLETE itinerary as JSON in the same format, with every day present.',
  ].join('\n');
}

/**
 * The conflict payload stored alongside the trip.
 *
 * Only what a person needs to see later: the checker can be re-run at any time
 * against the saved rows, so this is a record of what was known at generation
 * time rather than a cache to be trusted forever.
 */
export function conflictPayload(result, { attempts = 1, geocoded = null, roads = null } = {}) {
  return {
    issues: result.issues,
    summary: result.summary,
    // How many completions it took to get here — a plan that needed a
    // re-prompt and still has conflicts is a different thing from one that
    // never had any.
    attempts,
    geocoded,
    // How many journeys were measured rather than estimated. An itinerary
    // checked entirely against straight-line distance is a weaker statement
    // than one checked against roads, and the difference should be visible.
    roads,
    achievable: blockingIssues(result.issues).length === 0,
  };
}
