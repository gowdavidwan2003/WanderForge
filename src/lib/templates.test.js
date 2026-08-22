import { describe, expect, it } from 'vitest';

import {
  ALL_TAGS,
  TEMPLATE_COUNT,
  TEMPLATE_DATA,
  templateCost,
  templateInterests,
  templateStopCount,
} from '@/lib/templates';
import { MAX_TRIP_DAYS } from '@/lib/tripLimits';

/** The vocabulary the wizard offers and the planner understands. */
const INTERESTS = [
  'sightseeing', 'food', 'adventure', 'culture', 'nature',
  'nightlife', 'shopping', 'relaxation', 'history', 'photography',
];

describe('templateInterests', () => {
  /**
   * The reported bug. Explore wrote the raw tags to `ai_preferences.tags`, and
   * the generate route reads `ai_preferences.interests` — so the destination the
   * user picked for its food and culture told the planner nothing at all.
   */
  it('produces interests the planner will actually read', () => {
    const tokyo = TEMPLATE_DATA.find((t) => t.destination.startsWith('Tokyo'));
    expect(templateInterests(tokyo)).toContain('food');
    expect(templateInterests(tokyo)).toContain('culture');
  });

  it('maps tags that are not interests onto ones that are', () => {
    // 'technology' is a fair thing to say about Tokyo and is not something the
    // wizard offers. Passing it through would be ignored a second time.
    expect(templateInterests({ tags: ['technology'] })).toEqual(['sightseeing']);
    expect(templateInterests({ tags: ['romance'] })).toEqual(['relaxation']);
    expect(templateInterests({ tags: ['luxury'] })).toEqual(['shopping']);
    expect(templateInterests({ tags: ['spiritual'] })).toEqual(['culture']);
    expect(templateInterests({ tags: ['beach'] })).toEqual(['relaxation']);
    expect(templateInterests({ tags: ['heritage'] })).toEqual(['history']);
  });

  it('deduplicates when two tags map to the same interest', () => {
    expect(templateInterests({ tags: ['romance', 'relaxation'] })).toEqual(['relaxation']);
    expect(templateInterests({ tags: ['beach', 'relaxation'] })).toEqual(['relaxation']);
  });

  it('survives a template with no tags', () => {
    expect(templateInterests({})).toEqual([]);
    expect(templateInterests()).toEqual([]);
  });

  /** The guarantee that matters: nothing reaches the planner that it drops. */
  it('every template maps entirely into the interest vocabulary', () => {
    for (const template of TEMPLATE_DATA) {
      for (const interest of templateInterests(template)) {
        expect(INTERESTS, `${template.destination} produced "${interest}"`).toContain(interest);
      }
    }
  });
});

describe('TEMPLATE_DATA', () => {
  it('is what the landing page counts', () => {
    expect(TEMPLATE_COUNT).toBe(TEMPLATE_DATA.length);
    expect(TEMPLATE_COUNT).toBeGreaterThan(0);
  });

  /**
   * The static list is the fallback for when the database read fails, so it has
   * to stay in step with what migration 015 seeds. If a template is added there
   * and not here, a degraded Explore page silently hides it.
   */
  it('matches the ten templates seeded into the database', () => {
    expect(TEMPLATE_DATA).toHaveLength(10);

    const indian = TEMPLATE_DATA.filter((t) => t.destination.endsWith('India'));
    expect(indian).toHaveLength(5);
  });

  it('has no template longer than a trip is allowed to be', () => {
    for (const t of TEMPLATE_DATA) {
      expect(t.duration, t.destination).toBeGreaterThan(0);
      expect(t.duration, t.destination).toBeLessThanOrEqual(MAX_TRIP_DAYS);
    }
  });

  it('gives every template the fields the card and the trip both need', () => {
    for (const t of TEMPLATE_DATA) {
      expect(t.destination, 'destination').toBeTruthy();
      expect(t.desc, `${t.destination} desc`).toBeTruthy();
      expect(t.icon, `${t.destination} icon`).toBeTruthy();
      expect(t.cover, `${t.destination} cover`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(t.tags.length, `${t.destination} tags`).toBeGreaterThan(0);
    }
  });

  it('offers no filter tag that matches nothing', () => {
    for (const tag of ALL_TAGS) {
      expect(TEMPLATE_DATA.some((t) => t.tags.includes(tag)), tag).toBe(true);
    }
  });

  it('lists no destination twice', () => {
    const names = TEMPLATE_DATA.map((t) => t.destination);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * The fallback deliberately carries no itineraries — a plan shown from a
   * build-time constant could contradict the live one, and a stale plan is
   * worse than a card that links to the real thing.
   */
  it('carries no plan, so nothing here can go stale against the database', () => {
    for (const t of TEMPLATE_DATA) {
      expect(t.days, `${t.destination} days`).toBeUndefined();
      expect(templateStopCount(t), `${t.destination} stops`).toBe(0);
      expect(templateCost(t), `${t.destination} cost`).toBe(0);
    }
  });
});

describe('templateStopCount and templateCost', () => {
  const template = {
    currency: 'EUR',
    days: [
      { day_number: 1, activities: [{ cost: 20 }, { cost: 5.5 }] },
      { day_number: 2, activities: [{ cost: 0 }, {}] },
    ],
  };

  it('counts every stop across every day', () => {
    expect(templateStopCount(template)).toBe(4);
  });

  it('sums the costs, treating a missing one as free', () => {
    expect(templateCost(template)).toBe(25.5);
  });

  it('survives a template with no plan at all', () => {
    expect(templateStopCount({})).toBe(0);
    expect(templateCost({})).toBe(0);
    expect(templateStopCount()).toBe(0);
    expect(templateCost()).toBe(0);
  });

  /** A day with no activities key at all, which a hand-written row could have. */
  it('survives a day with no activities', () => {
    const sparse = { days: [{ day_number: 1 }] };
    expect(templateStopCount(sparse)).toBe(0);
    expect(templateCost(sparse)).toBe(0);
  });
});
