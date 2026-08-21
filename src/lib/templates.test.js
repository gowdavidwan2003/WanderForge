import { describe, expect, it } from 'vitest';

import { ALL_TAGS, TEMPLATE_COUNT, TEMPLATE_DATA, templateInterests } from '@/lib/templates';
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
  });

  it('deduplicates when two tags map to the same interest', () => {
    expect(templateInterests({ tags: ['romance', 'relaxation'] })).toEqual(['relaxation']);
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
});
