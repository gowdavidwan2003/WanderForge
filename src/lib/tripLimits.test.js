import { describe, expect, it } from 'vitest';
import {
  MAX_TRIP_DAYS,
  clampRequestedDays,
  exceedsDayLimit,
  tripDayCount,
} from './tripLimits.js';

describe('tripDayCount', () => {
  it('counts both endpoints', () => {
    expect(tripDayCount('2026-09-01', '2026-09-01')).toBe(1);
    expect(tripDayCount('2026-09-01', '2026-09-07')).toBe(7);
  });

  it('returns 0 when either date is missing', () => {
    expect(tripDayCount('', '2026-09-07')).toBe(0);
    expect(tripDayCount('2026-09-01', '')).toBe(0);
    expect(tripDayCount(null, null)).toBe(0);
  });

  // The bill driver: one AI day per day, then one billed geocode per activity.
  it('clamps a mistyped range instead of returning thousands of days', () => {
    expect(tripDayCount('2026-09-01', '2027-09-01')).toBe(MAX_TRIP_DAYS);
    expect(tripDayCount('2026-09-01', '2126-09-01')).toBe(MAX_TRIP_DAYS);
  });

  it('never returns less than one day for a valid range', () => {
    expect(tripDayCount('2026-09-07', '2026-09-01')).toBe(1);
  });

  it('returns 0 for unparseable input rather than NaN', () => {
    expect(tripDayCount('not-a-date', '2026-09-07')).toBe(0);
    expect(tripDayCount('2026-09-01', 'nonsense')).toBe(0);
  });
});

describe('exceedsDayLimit', () => {
  it('is false inside the cap', () => {
    expect(exceedsDayLimit('2026-09-01', '2026-09-07')).toBe(false);
    expect(exceedsDayLimit('2026-09-01', '2026-09-30')).toBe(false);
  });

  it('is true past the cap, so the wizard can say so', () => {
    expect(exceedsDayLimit('2026-09-01', '2026-11-01')).toBe(true);
    expect(exceedsDayLimit('2026-09-01', '2027-09-01')).toBe(true);
  });

  it('is false when dates are absent or invalid', () => {
    expect(exceedsDayLimit('', '')).toBe(false);
    expect(exceedsDayLimit('bad', '2026-09-07')).toBe(false);
  });
});

describe('clampRequestedDays', () => {
  it('passes through a sane client value', () => {
    expect(clampRequestedDays(7)).toBe(7);
    expect(clampRequestedDays('5')).toBe(5);
  });

  // `days` arrives in the request body, so it is attacker-controlled.
  it('caps an oversized request', () => {
    expect(clampRequestedDays(9999)).toBe(MAX_TRIP_DAYS);
    expect(clampRequestedDays(MAX_TRIP_DAYS + 1)).toBe(MAX_TRIP_DAYS);
  });

  it('floors to at least one day for junk input', () => {
    expect(clampRequestedDays(0)).toBe(1);
    expect(clampRequestedDays(-50)).toBe(1);
    expect(clampRequestedDays('abc')).toBe(1);
    expect(clampRequestedDays(undefined)).toBe(1);
    expect(clampRequestedDays(null)).toBe(1);
    expect(clampRequestedDays(2.9)).toBe(2);
  });

  // Infinity is malformed rather than a large request, so it floors to 1 rather
  // than clamping to the cap. That is the cost-safe direction: junk input buys
  // the smallest possible generation, not the largest allowed one.
  it('treats Infinity and NaN as junk, not as a maximal request', () => {
    expect(clampRequestedDays(Infinity)).toBe(1);
    expect(clampRequestedDays(-Infinity)).toBe(1);
    expect(clampRequestedDays(NaN)).toBe(1);
  });
});
