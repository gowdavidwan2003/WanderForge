import { describe, expect, it } from 'vitest';

import {
  conflictsForActivity,
  dayConflictSummary,
  groupByDay,
  headlineFor,
  isHardConflict,
  worstSeverity,
} from '@/lib/conflictView';

const issue = (over = {}) => ({
  severity: 'warning',
  type: 'odd-hours',
  day: 1,
  activityId: 'a1',
  title: 'Museum',
  message: 'something',
  ...over,
});

const HARD = issue({ severity: 'error', type: 'travel-time', message: 'Short by 45m.' });
const OVERLAP = issue({ severity: 'error', type: 'overlap', activityId: 'a2' });
const SOFT = issue({ severity: 'warning', type: 'odd-hours' });
const NOTE = issue({ severity: 'info', type: 'missing-coords', activityId: undefined });

describe('isHardConflict', () => {
  it('treats the things that make a day unwalkable as hard', () => {
    expect(isHardConflict({ type: 'overlap' })).toBe(true);
    expect(isHardConflict({ type: 'invalid-duration' })).toBe(true);
    expect(isHardConflict({ type: 'travel-time' })).toBe(true);
  });

  it('treats advisories as soft, whatever their severity', () => {
    // A warning-severity travel-time issue is still hard; a warning-severity
    // long-hop is not. Severity says how loudly, type says whether.
    expect(isHardConflict({ type: 'travel-time', severity: 'warning' })).toBe(true);
    expect(isHardConflict({ type: 'long-hop', severity: 'warning' })).toBe(false);
    expect(isHardConflict({ type: 'over-budget' })).toBe(false);
    expect(isHardConflict({ type: 'odd-hours' })).toBe(false);
    expect(isHardConflict({ type: 'missing-coords' })).toBe(false);
    expect(isHardConflict(null)).toBe(false);
  });
});

describe('worstSeverity', () => {
  it('reports the most serious present', () => {
    expect(worstSeverity([SOFT, HARD, NOTE])).toBe('error');
    expect(worstSeverity([NOTE, SOFT])).toBe('warning');
    expect(worstSeverity([NOTE])).toBe('info');
  });

  it('is null when there is nothing', () => {
    expect(worstSeverity([])).toBeNull();
  });
});

describe('conflictsForActivity', () => {
  it('returns only what belongs to that activity', () => {
    const found = conflictsForActivity([HARD, OVERLAP, SOFT], 'a1');
    expect(found).toHaveLength(2);
    expect(found.every((i) => i.activityId === 'a1')).toBe(true);
  });

  it('never pins a whole-day issue to an activity', () => {
    // "This day is over budget" belongs to the day. Attaching it to whichever
    // activity happens to be last would be a lie about which one caused it.
    const dayIssue = issue({ type: 'over-budget', activityId: undefined });
    expect(conflictsForActivity([dayIssue], 'a1')).toHaveLength(0);
    expect(conflictsForActivity([dayIssue], undefined)).toHaveLength(0);
  });
});

describe('dayConflictSummary', () => {
  it('splits hard from soft and marks the day impossible', () => {
    const summary = dayConflictSummary([HARD, SOFT, NOTE, issue({ day: 2 })], 1);

    expect(summary.issues).toHaveLength(3);
    expect(summary.hard).toHaveLength(1);
    expect(summary.soft).toHaveLength(2);
    expect(summary.worst).toBe('error');
    expect(summary.impossible).toBe(true);
  });

  it('a day of only warnings is not impossible', () => {
    const summary = dayConflictSummary([SOFT, NOTE], 1);
    expect(summary.impossible).toBe(false);
    expect(summary.worst).toBe('warning');
  });

  it('a clean day reports nothing', () => {
    const summary = dayConflictSummary([issue({ day: 5 })], 1);
    expect(summary.issues).toHaveLength(0);
    expect(summary.worst).toBeNull();
    expect(summary.impossible).toBe(false);
  });
});

describe('groupByDay', () => {
  it('orders days and omits the ones with nothing to say', () => {
    const groups = groupByDay([issue({ day: 3 }), HARD, issue({ day: 3, type: 'overlap' })]);
    expect(groups.map((g) => g.day)).toEqual([1, 3]);
    expect(groups[1].hard).toHaveLength(1);
  });

  it('drops issues with no day rather than grouping them under undefined', () => {
    expect(groupByDay([issue({ day: undefined })])).toHaveLength(0);
  });

  it('is empty for a clean trip', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('headlineFor', () => {
  it('says plainly that a clean itinerary works', () => {
    const h = headlineFor({ issues: [] });
    expect(h.tone).toBe('ok');
    expect(h.title).toContain('works');
  });

  it('distinguishes "worth checking" from "will not work"', () => {
    const soft = headlineFor({ issues: [SOFT, NOTE] });
    expect(soft.tone).toBe('warn');
    expect(soft.title).toContain('Nothing impossible');

    const hard = headlineFor({ issues: [HARD, SOFT] });
    expect(hard.tone).toBe('bad');
    expect(hard.title).toContain('will not work');
  });

  it('counts the days affected, not just the issues', () => {
    const h = headlineFor({ issues: [HARD, issue({ day: 4, type: 'overlap', severity: 'error' })] });
    expect(h.detail).toContain('2 days');
  });

  it('handles a missing report without throwing', () => {
    expect(headlineFor(undefined).tone).toBe('ok');
  });
});
