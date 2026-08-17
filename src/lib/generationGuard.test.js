import { describe, expect, it } from 'vitest';
import { clearsExistingActivities, orderOffsetFor, planGeneration } from './generationGuard.js';

describe('planGeneration', () => {
  it('generates straight away on an empty trip', () => {
    expect(planGeneration({ existingCount: 0 })).toEqual({ action: 'generate', mode: 'replace' });
  });

  // The regression: pressing Generate on a trip that already has an itinerary
  // used to insert a second copy of everything without asking.
  it('asks before touching an itinerary that already exists', () => {
    expect(planGeneration({ existingCount: 34 })).toEqual({ action: 'confirm', existing: 34 });
  });

  it('asks even when only one activity exists', () => {
    expect(planGeneration({ existingCount: 1 })).toEqual({ action: 'confirm', existing: 1 });
  });

  // The double-click case: the second press must not start a second run.
  it('ignores a press while a generation is already running', () => {
    expect(planGeneration({ existingCount: 0, inFlight: true })).toEqual({ action: 'ignore' });
    expect(planGeneration({ existingCount: 12, inFlight: true })).toEqual({ action: 'ignore' });
  });

  it('ignores a press on a locked itinerary', () => {
    expect(planGeneration({ existingCount: 0, locked: true })).toEqual({ action: 'ignore' });
    expect(planGeneration({ existingCount: 12, locked: true })).toEqual({ action: 'ignore' });
  });

  it('never returns generate when anything already exists', () => {
    for (const n of [1, 2, 7, 25, 100]) {
      expect(planGeneration({ existingCount: n }).action).not.toBe('generate');
    }
  });

  it('treats missing and malformed input as an empty trip rather than throwing', () => {
    expect(planGeneration()).toEqual({ action: 'generate', mode: 'replace' });
    expect(planGeneration({})).toEqual({ action: 'generate', mode: 'replace' });
    expect(planGeneration({ existingCount: undefined })).toEqual({ action: 'generate', mode: 'replace' });
    expect(planGeneration({ existingCount: NaN })).toEqual({ action: 'generate', mode: 'replace' });
  });

  // Two clicks in the same tick: the first flips the in-flight flag before any
  // await, so the second must see it and bail.
  it('lets exactly one of two rapid presses through', () => {
    let inFlight = false;
    const press = () => {
      const decision = planGeneration({ existingCount: 0, inFlight });
      if (decision.action === 'generate') inFlight = true;
      return decision.action;
    };
    expect([press(), press()]).toEqual(['generate', 'ignore']);
  });

  it('lets exactly one of two rapid presses through when confirming too', () => {
    // Confirming does not start a run, so the modal simply opens twice over
    // itself — but once the run starts, further presses are ignored.
    let inFlight = false;
    const confirmThenRun = () => {
      const decision = planGeneration({ existingCount: 5, inFlight });
      if (decision.action === 'confirm') inFlight = true; // user picks an option
      return decision.action;
    };
    expect([confirmThenRun(), confirmThenRun()]).toEqual(['confirm', 'ignore']);
  });
});

describe('orderOffsetFor', () => {
  it('starts at zero when replacing', () => {
    expect(orderOffsetFor('replace', 8)).toBe(0);
    expect(orderOffsetFor('replace', 0)).toBe(0);
  });

  it('continues past existing activities when appending', () => {
    expect(orderOffsetFor('append', 8)).toBe(8);
    expect(orderOffsetFor('append', 0)).toBe(0);
  });

  it('never returns a negative or non-numeric offset', () => {
    expect(orderOffsetFor('append', -3)).toBe(0);
    expect(orderOffsetFor('append', undefined)).toBe(0);
    expect(orderOffsetFor('append', 'x')).toBe(0);
  });
});

describe('clearsExistingActivities', () => {
  it('only replace deletes first', () => {
    expect(clearsExistingActivities('replace')).toBe(true);
    expect(clearsExistingActivities('append')).toBe(false);
  });
});
