import { describe, expect, it } from 'vitest';

import {
  GENERATE_BUDGET_MS,
  MIN_COMPLETION_MS,
  POST_COMPLETION_RESERVE_MS,
  createBudget,
} from '@/lib/aiBudget';
import { PER_ATTEMPT_MS } from '@/lib/groq';

/** A clock the test moves by hand, so nothing here has to actually wait. */
function fakeClock(start = 1_000_000) {
  let now = start;
  const fn = () => now;
  fn.advance = (ms) => { now += ms; };
  return fn;
}

describe('createBudget', () => {
  it('starts with the whole budget available', () => {
    const clock = fakeClock();
    const budget = createBudget(GENERATE_BUDGET_MS, clock);
    expect(budget.remaining()).toBe(GENERATE_BUDGET_MS);
    expect(budget.spent()).toBe(0);
  });

  it('spends down as the clock moves', () => {
    const clock = fakeClock();
    const budget = createBudget(50_000, clock);
    clock.advance(20_000);
    expect(budget.spent()).toBe(20_000);
    expect(budget.remaining()).toBe(30_000);
  });

  it('refuses another completion once one would not fit', () => {
    const clock = fakeClock();
    const budget = createBudget(50_000, clock);

    expect(budget.canAfford(MIN_COMPLETION_MS)).toBe(true);
    clock.advance(40_000);
    expect(budget.canAfford(MIN_COMPLETION_MS)).toBe(false);
  });

  it('holds back time for the work that follows a completion', () => {
    const clock = fakeClock();
    const budget = createBudget(50_000, clock);
    expect(budget.completionSlice()).toBe(50_000 - POST_COMPLETION_RESERVE_MS);
  });

  it('never hands out a negative slice or a deadline in the past', () => {
    const clock = fakeClock();
    const budget = createBudget(50_000, clock);
    clock.advance(90_000);

    expect(budget.completionSlice()).toBe(0);
    expect(budget.deadlineAt()).toBe(clock());
  });

  /**
   * The guarantee the route's `maxDuration = 60` rests on. Three completions
   * (initial, validation retry, conflict re-prompt) each taking the slice they
   * were granted must still land inside the budget — otherwise the platform kills
   * the invocation and the caller gets a 504 with no body, which is
   * indistinguishable from a generation that simply failed.
   */
  it('keeps three sequential completions inside the total', () => {
    const clock = fakeClock();
    const budget = createBudget(GENERATE_BUDGET_MS, clock);

    for (let i = 0; i < 3; i++) {
      if (!budget.canAfford(MIN_COMPLETION_MS)) break;
      // A completion cannot outlast the slice it is given, and groq.js caps a
      // single attempt at PER_ATTEMPT_MS regardless.
      clock.advance(Math.min(budget.completionSlice(), PER_ATTEMPT_MS));
    }

    expect(budget.spent()).toBeLessThanOrEqual(GENERATE_BUDGET_MS);
  });

  it('leaves the platform ceiling some headroom', () => {
    // maxDuration is 60s; the budget has to finish inside it with room to
    // serialise a response.
    expect(GENERATE_BUDGET_MS).toBeLessThan(60_000);
  });
});
