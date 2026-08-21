/**
 * Wall-clock budgeting for the generate route.
 *
 * The route declares `maxDuration = 60`, and it now does considerably more than
 * one Groq call: validate, maybe retry, geocode, run the conflict checker, maybe
 * re-prompt. Any of those can be slow, and overshooting the ceiling means the
 * platform kills the invocation and the caller gets an opaque 504 with no error
 * body — the worst possible outcome, because the user cannot tell it from a
 * generation that simply failed.
 *
 * So the route spends against one budget rather than hoping the pieces fit. Each
 * optional step asks whether it can be afforded before starting, and is skipped
 * — with the itinerary still returned — when it cannot. A plan that was checked
 * but not re-prompted is a fine outcome; a plan that was never returned is not.
 */

/** Total wall clock the route may spend, under the platform's 60s ceiling. */
export const GENERATE_BUDGET_MS = 50_000;

/** Don't start another completion without at least this much left. */
export const MIN_COMPLETION_MS = 14_000;

/** Kept back for geocoding, checking and serialising the response. */
export const POST_COMPLETION_RESERVE_MS = 9_000;

/** Don't start geocoding without at least this much left. */
export const MIN_GEOCODE_MS = 4_000;

/**
 * @param totalMs how long the whole route may take
 * @param now     injectable clock, so the arithmetic is testable without waiting
 */
export function createBudget(totalMs = GENERATE_BUDGET_MS, now = Date.now) {
  const startedAt = now();

  const remaining = () => totalMs - (now() - startedAt);

  return {
    startedAt,
    remaining,
    spent: () => now() - startedAt,

    /** True when `needMs` still fits. */
    canAfford: (needMs) => remaining() >= needMs,

    /**
     * Milliseconds to hand one Groq call, holding back `reserveMs` for the work
     * that has to happen after it. Never negative.
     */
    completionSlice: (reserveMs = POST_COMPLETION_RESERVE_MS) =>
      Math.max(0, remaining() - reserveMs),

    /** Epoch ms after which a geocoding pool must stop starting new lookups. */
    deadlineAt: (reserveMs = 2_000) => now() + Math.max(0, remaining() - reserveMs),
  };
}
