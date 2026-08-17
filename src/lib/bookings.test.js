import { describe, expect, it } from 'vitest';
import {
  accommodationTotal,
  bookingsTotal,
  nightsBetween,
  stayDateIssue,
  stayDateWarning,
} from '@/lib/bookings';

describe('nightsBetween', () => {
  it('counts nights, not days', () => {
    expect(nightsBetween('2026-09-01', '2026-09-04')).toBe(3);
    expect(nightsBetween('2026-09-01', '2026-09-02')).toBe(1);
  });

  it('is zero for a same-day range', () => {
    expect(nightsBetween('2026-09-01', '2026-09-01')).toBe(0);
  });

  it('is zero rather than negative when the dates are reversed', () => {
    expect(nightsBetween('2026-09-10', '2026-09-01')).toBe(0);
  });

  it('is zero for missing or unparseable dates', () => {
    expect(nightsBetween(null, '2026-09-04')).toBe(0);
    expect(nightsBetween('2026-09-01', null)).toBe(0);
    expect(nightsBetween('not-a-date', '2026-09-04')).toBe(0);
    expect(nightsBetween('2026-09-01', 'nonsense')).toBe(0);
  });

  it('crosses a month and a DST boundary without dropping a night', () => {
    expect(nightsBetween('2026-08-30', '2026-09-02')).toBe(3);
    // Northern-hemisphere clock change falls inside this range.
    expect(nightsBetween('2026-10-24', '2026-10-27')).toBe(3);
  });
});

describe('stayDateIssue', () => {
  // The point of this helper: a check-out before its check-in used to bill
  // exactly one night with nothing on screen saying anything was wrong.
  it('names reversed dates', () => {
    expect(stayDateIssue({ check_in: '2026-09-10', check_out: '2026-09-01' })).toBe('reversed-dates');
    expect(stayDateWarning({ check_in: '2026-09-10', check_out: '2026-09-01' }))
      .toMatch(/before check-in/i);
  });

  it('distinguishes missing from incomplete from unreadable', () => {
    expect(stayDateIssue({})).toBe('no-dates');
    expect(stayDateIssue({ check_in: '2026-09-01' })).toBe('incomplete-dates');
    expect(stayDateIssue({ check_out: '2026-09-01' })).toBe('incomplete-dates');
    expect(stayDateIssue({ check_in: 'x', check_out: 'y' })).toBe('invalid-dates');
  });

  it('flags a same-day stay', () => {
    expect(stayDateIssue({ check_in: '2026-09-01', check_out: '2026-09-01' })).toBe('same-day');
  });

  it('is null for a usable range, and has no warning', () => {
    const stay = { check_in: '2026-09-01', check_out: '2026-09-04' };
    expect(stayDateIssue(stay)).toBeNull();
    expect(stayDateWarning(stay)).toBeNull();
  });

  it('every issue has a warning a user could act on', () => {
    const cases = [
      {},
      { check_in: '2026-09-01' },
      { check_in: 'x', check_out: 'y' },
      { check_in: '2026-09-10', check_out: '2026-09-01' },
      { check_in: '2026-09-01', check_out: '2026-09-01' },
    ];
    for (const stay of cases) {
      expect(stayDateWarning(stay), JSON.stringify(stay)).toBeTruthy();
    }
  });
});

describe('accommodationTotal', () => {
  it('multiplies the nightly rate by the nights', () => {
    expect(accommodationTotal({ cost_per_night: 2500, check_in: '2026-09-01', check_out: '2026-09-04' }))
      .toBe(7500);
  });

  it('is zero with no rate, whatever the dates', () => {
    expect(accommodationTotal({ check_in: '2026-09-01', check_out: '2026-09-04' })).toBe(0);
    expect(accommodationTotal({ cost_per_night: 0 })).toBe(0);
    expect(accommodationTotal(null)).toBe(0);
  });

  it('never returns a negative total', () => {
    expect(accommodationTotal({ cost_per_night: -500, check_in: '2026-09-01', check_out: '2026-09-04' }))
      .toBe(0);
  });

  // Documented behaviour rather than an accident: a half-entered booking still
  // shows in the budget instead of quietly costing nothing. What changed is that
  // the reason is now retrievable.
  it('counts one night for unusable dates, and says why', () => {
    for (const stay of [
      { cost_per_night: 2500 },
      { cost_per_night: 2500, check_in: '2026-09-01' },
      { cost_per_night: 2500, check_in: '2026-09-10', check_out: '2026-09-01' },
      { cost_per_night: 2500, check_in: '2026-09-01', check_out: '2026-09-01' },
    ]) {
      expect(accommodationTotal(stay)).toBe(2500);
      expect(stayDateWarning(stay)).toBeTruthy();
    }
  });
});

describe('bookingsTotal', () => {
  it('adds stays and transport', () => {
    const stays = [
      { cost_per_night: 2000, check_in: '2026-09-01', check_out: '2026-09-03' },
      { cost_per_night: 1500, check_in: '2026-09-03', check_out: '2026-09-04' },
    ];
    const transport = [{ cost: 4000 }, { cost: 250 }];
    expect(bookingsTotal(stays, transport)).toEqual({
      staysTotal: 5500,
      transportTotal: 4250,
      total: 9750,
    });
  });

  it('handles empty input', () => {
    expect(bookingsTotal()).toEqual({ staysTotal: 0, transportTotal: 0, total: 0 });
    expect(bookingsTotal([], [])).toEqual({ staysTotal: 0, transportTotal: 0, total: 0 });
  });

  it('ignores non-numeric transport costs rather than producing NaN', () => {
    const result = bookingsTotal([], [{ cost: 'abc' }, { cost: null }, { cost: 100 }]);
    expect(result.transportTotal).toBe(100);
    expect(Number.isNaN(result.total)).toBe(false);
  });
});
