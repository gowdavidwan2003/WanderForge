import { describe, expect, it } from 'vitest';

import {
  datesForRange,
  daysBetween,
  describeDayChanges,
  formatDate,
  parseDate,
  planDayChanges,
  validateTripEdit,
} from '@/lib/tripDates';
import { MAX_TRIP_DAYS } from '@/lib/tripLimits';

const day = (n, date, id = `d${n}`) => ({ id, day_number: n, date });

describe('parseDate', () => {
  it('reads a date column value without a timezone shifting it', () => {
    // The bug this guards: new Date('2026-09-01') in a UTC-negative zone is
    // 31 August locally, so every day label slid back one.
    const d = parseDate('2026-09-01');
    expect(formatDate(d)).toBe('2026-09-01');
    expect(d.getUTCDate()).toBe(1);
  });

  it('tolerates a full timestamp', () => {
    expect(formatDate(parseDate('2026-09-01T00:00:00Z'))).toBe('2026-09-01');
  });

  it('is null for anything unusable', () => {
    for (const v of ['', null, undefined, 'tomorrow', '01/09/2026']) {
      expect(parseDate(v)).toBeNull();
    }
  });
});

describe('daysBetween', () => {
  it('counts inclusively, the way a traveler counts nights plus one', () => {
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-09-01', '2026-09-05')).toBe(5);
  });

  it('crosses a month and a leap day', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(4);
    expect(daysBetween('2028-02-27', '2028-03-01')).toBe(4);
  });

  it('is 0 when either end is missing', () => {
    expect(daysBetween(null, '2026-09-05')).toBe(0);
    expect(daysBetween('2026-09-05', 'nonsense')).toBe(0);
  });
});

describe('datesForRange', () => {
  it('walks consecutive days from the start', () => {
    expect(datesForRange('2026-08-30', 4)).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ]);
  });

  it('is empty for a bad start or a non-positive count', () => {
    expect(datesForRange('nope', 3)).toEqual([]);
    expect(datesForRange('2026-09-01', 0)).toEqual([]);
  });
});

describe('planDayChanges', () => {
  const existing = [
    day(1, '2026-09-01'),
    day(2, '2026-09-02'),
    day(3, '2026-09-03'),
  ];
  const activities = { d1: [{ id: 'a1' }], d2: [], d3: [{ id: 'a2' }, { id: 'a3' }] };

  it('reports no change when the dates are the same', () => {
    const plan = planDayChanges(existing, { startDate: '2026-09-01', endDate: '2026-09-03' }, activities);
    expect(plan.unchanged).toBe(true);
    expect(plan.removed).toEqual([]);
  });

  it('shifts every day when the trip moves, keeping all three', () => {
    const plan = planDayChanges(existing, { startDate: '2026-10-01', endDate: '2026-10-03' }, activities);
    expect(plan.shifted).toBe(3);
    expect(plan.added).toBe(0);
    expect(plan.removed).toEqual([]);
    expect(plan.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('adds empty days when the trip is extended', () => {
    const plan = planDayChanges(existing, { startDate: '2026-09-01', endDate: '2026-09-05' }, activities);
    expect(plan.added).toBe(2);
    expect(plan.removed).toEqual([]);
    expect(plan.days).toHaveLength(5);
  });

  /** The dangerous edit: shortening a trip destroys days and their activities. */
  it('names the days that fall off the end and what is on them', () => {
    const plan = planDayChanges(existing, { startDate: '2026-09-01', endDate: '2026-09-02' }, activities);
    expect(plan.removed).toEqual([{ day_number: 3, activityCount: 2 }]);
    expect(plan.activitiesLost).toBe(2);
  });

  it('matches days by number, not by date, so a moved trip strands nothing', () => {
    // Every date changes here. Matching on date would treat all three as new and
    // all three as removed, taking every activity with them.
    const plan = planDayChanges(existing, { startDate: '2027-01-01', endDate: '2027-01-03' }, activities);
    expect(plan.removed).toEqual([]);
    expect(plan.added).toBe(0);
    expect(plan.activitiesLost).toBe(0);
  });

  it('counts a shortening that also moves the trip', () => {
    const plan = planDayChanges(existing, { startDate: '2026-12-01', endDate: '2026-12-01' }, activities);
    expect(plan.days).toHaveLength(1);
    expect(plan.shifted).toBe(1);
    expect(plan.removed.map((d) => d.day_number)).toEqual([2, 3]);
    expect(plan.activitiesLost).toBe(2);
  });

  it('handles a trip that has no days yet', () => {
    const plan = planDayChanges([], { startDate: '2026-09-01', endDate: '2026-09-02' }, {});
    expect(plan.added).toBe(2);
    expect(plan.unchanged).toBe(false);
  });
});

describe('describeDayChanges', () => {
  const existing = [day(1, '2026-09-01'), day(2, '2026-09-02')];

  it('says nothing when nothing is removed', () => {
    const plan = planDayChanges(existing, { startDate: '2026-09-01', endDate: '2026-09-04' }, {});
    expect(describeDayChanges(plan)).toBeNull();
  });

  it('is reassuring when the removed days are empty', () => {
    const plan = planDayChanges(existing, { startDate: '2026-09-01', endDate: '2026-09-01' }, { d2: [] });
    expect(describeDayChanges(plan)).toContain('nothing is lost');
  });

  it('pluralises like a person, not a template', () => {
    const one = planDayChanges(existing, { startDate: '2026-09-01', endDate: '2026-09-01' }, { d2: [{ id: 'a1' }] });
    expect(describeDayChanges(one)).toContain('1 activity planned');
    expect(describeDayChanges(one)).toContain('Day 2');
  });

  it('is blunt when activities go with the day', () => {
    const plan = planDayChanges(
      existing,
      { startDate: '2026-09-01', endDate: '2026-09-01' },
      { d2: [{ id: 'a1' }, { id: 'a2' }] }
    );
    const text = describeDayChanges(plan);
    expect(text).toContain('2 activities');
    expect(text).toContain('cannot be undone');
  });
});

describe('validateTripEdit', () => {
  const valid = {
    title: 'Chikmagaluru',
    destination: 'Chikmagaluru, Karnataka',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    totalBudget: '20000',
  };

  it('accepts a well-formed edit', () => {
    expect(validateTripEdit(valid, MAX_TRIP_DAYS).ok).toBe(true);
  });

  it('requires a title and a destination', () => {
    expect(validateTripEdit({ ...valid, title: '   ' }).errors[0]).toContain('title');
    expect(validateTripEdit({ ...valid, destination: '' }).errors[0]).toContain('destination');
  });

  it('rejects an end date before the start', () => {
    const res = validateTripEdit({ ...valid, endDate: '2026-08-30' });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('before the start');
  });

  it('applies the same day cap the wizard does', () => {
    // A trip that could not have been created this way must not be reachable by
    // editing one that could.
    const res = validateTripEdit({ ...valid, endDate: '2027-09-01' }, MAX_TRIP_DAYS);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain(String(MAX_TRIP_DAYS));
  });

  it('allows an empty budget but not a nonsensical one', () => {
    expect(validateTripEdit({ ...valid, totalBudget: '' }).ok).toBe(true);
    expect(validateTripEdit({ ...valid, totalBudget: null }).ok).toBe(true);
    expect(validateTripEdit({ ...valid, totalBudget: '-5' }).ok).toBe(false);
    expect(validateTripEdit({ ...valid, totalBudget: 'lots' }).ok).toBe(false);
  });

  it('reports every problem at once rather than one at a time', () => {
    const res = validateTripEdit({ title: '', destination: '', startDate: 'x', endDate: 'y' });
    expect(res.errors.length).toBeGreaterThanOrEqual(4);
  });
});
