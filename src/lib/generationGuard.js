/**
 * Decides what pressing "AI Generate" should do.
 *
 * Generation used to insert unconditionally, so a second press wrote a complete
 * second copy of every activity with colliding order_index values — recoverable
 * only by deleting each one by hand. The dangerous press is not the one during a
 * run; it is the one after a run finishes, when the trip already has an itinerary
 * and nothing warns the user. An in-flight check alone never catches that.
 *
 * This lives outside the trip page so the rule can be tested without a session,
 * a trip row, or a Groq call.
 */

/**
 * @param existingCount activities already on the trip, across all days
 * @param inFlight      a generation is already running
 * @param locked        the itinerary is frozen
 * @returns {{action: 'ignore'|'confirm'|'generate', mode?: 'replace'|'append', existing?: number}}
 */
export function planGeneration({ existingCount = 0, inFlight = false, locked = false } = {}) {
  if (locked || inFlight) return { action: 'ignore' };

  const existing = Number(existingCount) || 0;
  if (existing > 0) return { action: 'confirm', existing };

  // Nothing to lose on an empty trip, so skip the prompt. 'replace' is accurate:
  // there is simply nothing to replace.
  return { action: 'generate', mode: 'replace' };
}

/**
 * Where a generated day's order_index should start.
 *
 * Appending must continue past what is already on the day. Reusing 0..n-1 was
 * what made a duplicated itinerary interleave rather than merely repeat, so the
 * two copies could not be told apart afterwards.
 */
export function orderOffsetFor(mode, existingOnDay = 0) {
  const count = Number(existingOnDay) || 0;
  return mode === 'append' ? Math.max(0, count) : 0;
}

/** Whether a mode must clear the day before writing. */
export function clearsExistingActivities(mode) {
  return mode === 'replace';
}
