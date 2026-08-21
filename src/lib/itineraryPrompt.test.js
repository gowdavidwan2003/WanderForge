import { describe, expect, it } from 'vitest';
import { ACTIVITY_CATEGORIES, REALISM_RULES, normalizeCategory } from '@/lib/itineraryPrompt';

describe('normalizeCategory', () => {
  it('passes through the eleven allowed values unchanged', () => {
    for (const c of ACTIVITY_CATEGORIES) expect(normalizeCategory(c)).toBe(c);
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeCategory('Food')).toBe('food');
    expect(normalizeCategory('  SIGHTSEEING  ')).toBe('sightseeing');
  });

  // Every value here was produced by the planning model in a real generation.
  // activities.category has a CHECK constraint, so before this each of these was
  // rejected by Postgres and the activity silently vanished from the itinerary.
  it.each([
    ['meal', 'food'],
    ['viewpoint', 'sightseeing'],
    ['leisure', 'relaxation'],
    ['trekking', 'adventure'],
    ['market', 'shopping'],
  ])('maps the observed near-miss %s -> %s', (input, expected) => {
    expect(normalizeCategory(input)).toBe(expected);
  });

  it('keeps a meal a meal rather than filing it as other', () => {
    // Filing meals under 'other' makes a day look like it has no lunch in it.
    for (const v of ['meal', 'lunch', 'dinner', 'breakfast', 'restaurant', 'cafe']) {
      expect(normalizeCategory(v), v).toBe('food');
    }
  });

  it('takes the leading word from a compound value', () => {
    expect(normalizeCategory('food/drink')).toBe('food');
    expect(normalizeCategory('Food & Drink')).toBe('food');
    expect(normalizeCategory('sightseeing - culture')).toBe('sightseeing');
    expect(normalizeCategory('trekking/hiking')).toBe('adventure');
  });

  it('falls back to other rather than dropping the activity', () => {
    expect(normalizeCategory('quantum tourism')).toBe('other');
    expect(normalizeCategory('')).toBe('other');
    expect(normalizeCategory(null)).toBe('other');
    expect(normalizeCategory(undefined)).toBe('other');
    expect(normalizeCategory(42)).toBe('other');
  });

  it('always returns a value the database will accept', () => {
    const probes = [
      'meal', 'viewpoint', 'leisure', 'trekking', 'market', 'food/drink',
      'Hotel', 'safari', 'bazaar', '', null, undefined, 'nonsense', 'TRANSPORT',
    ];
    for (const p of probes) {
      expect(ACTIVITY_CATEGORIES, String(p)).toContain(normalizeCategory(p));
    }
  });
});

describe('REALISM_RULES', () => {
  // The prompt is charged against an 8,000 tokens-per-minute ceiling on every
  // planning call, so its size is a budget decision, not just an editorial one.
  it('stays small enough to leave room for the itinerary', () => {
    const approxTokens = Math.ceil(REALISM_RULES.length / 4);
    expect(approxTokens).toBeLessThan(900);
  });

  it('still states the rules the itineraries depend on', () => {
    for (const rule of [
      '25-30 km/h',      // ghat road speed
      '45 minutes',      // transport-entry threshold
      'RETURN JOURNEY',  // the leg most often forgotten
      'dinner',          // meals must be present
      'opening hours',
    ]) {
      expect(REALISM_RULES, rule).toContain(rule);
    }
  });

  it('is a single unterminated-free template with no stray fragments', () => {
    expect(REALISM_RULES.trim().endsWith('remove activities until it does.')).toBe(true);
  });
});
