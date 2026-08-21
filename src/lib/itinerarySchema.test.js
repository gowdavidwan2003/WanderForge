import { describe, expect, it } from 'vitest';

import {
  coerceCategory,
  coerceCost,
  coerceTime,
  formatIssues,
  itinerarySchema,
  validateItinerary,
  validationRetryPrompt,
} from '@/lib/itinerarySchema';
import { ACTIVITY_CATEGORIES, normalizeCategory } from '@/lib/itineraryPrompt';

/** A minimal activity that passes, so each test can vary one field. */
const activity = (over = {}) => ({
  title: 'Mullayanagiri Peak',
  description: 'Highest peak in Karnataka',
  location_name: 'Mullayanagiri, Chikmagaluru',
  category: 'nature',
  start_time: '09:00',
  end_time: '11:30',
  cost: 200,
  notes: 'approx 1h30 by car on winding ghat road',
  booking_link: '',
  ...over,
});

const payload = (over = {}) => ({
  itinerary: [{ day: 1, theme: 'Hills', activities: [activity()] }],
  summary: 'A short trip',
  estimated_total_cost: 200,
  currency: 'INR',
  pro_tips: ['Start early'],
  ...over,
});

describe('coerceTime', () => {
  it('accepts times that are already correct', () => {
    expect(coerceTime('09:00')).toBe('09:00');
    expect(coerceTime('23:59')).toBe('23:59');
    expect(coerceTime('00:00')).toBe('00:00');
  });

  it('repairs the 12-hour forms models actually emit', () => {
    expect(coerceTime('9am')).toBe('09:00');
    expect(coerceTime('9 AM')).toBe('09:00');
    expect(coerceTime('9:30 pm')).toBe('21:30');
    expect(coerceTime('9:30 p.m.')).toBe('21:30');
    expect(coerceTime('12am')).toBe('00:00');
    expect(coerceTime('12pm')).toBe('12:00');
  });

  it('repairs separators, bare digits and Postgres-style seconds', () => {
    expect(coerceTime('9.30')).toBe('09:30');
    expect(coerceTime('9h30')).toBe('09:30');
    expect(coerceTime('0930')).toBe('09:30');
    expect(coerceTime('930')).toBe('09:30');
    expect(coerceTime('21:00:00')).toBe('21:00');
    expect(coerceTime(9)).toBe('09:00');
  });

  it('understands noon and midnight', () => {
    expect(coerceTime('noon')).toBe('12:00');
    expect(coerceTime('Midnight')).toBe('00:00');
  });

  it('refuses to invent a time it cannot know', () => {
    // The failure this whole module exists for: "TBD" used to reach a TIME column.
    expect(coerceTime('TBD')).toBeNull();
    expect(coerceTime('morning')).toBeNull();
    expect(coerceTime('after lunch')).toBeNull();
    expect(coerceTime('09:00-11:00')).toBeNull();
    expect(coerceTime('')).toBeNull();
    expect(coerceTime(null)).toBeNull();
  });

  it('rejects out-of-range clock values rather than wrapping them', () => {
    expect(coerceTime('25:00')).toBeNull();
    expect(coerceTime('12:75')).toBeNull();
    expect(coerceTime('13pm')).toBeNull();
    expect(coerceTime('0:99')).toBeNull();
  });

  it('leaves genuinely ambiguous minutes alone', () => {
    // "9.5" could be 09:05 or 09:30; guessing is wrong about half the time.
    expect(coerceTime('9.5')).toBeNull();
  });
});

describe('coerceCost', () => {
  it('passes numbers through, rounded to cents', () => {
    expect(coerceCost(0)).toBe(0);
    expect(coerceCost(1200)).toBe(1200);
    expect(coerceCost(12.345)).toBe(12.35);
  });

  it('strips currency noise around a figure', () => {
    expect(coerceCost('1,200')).toBe(1200);
    expect(coerceCost('Rs 1,200')).toBe(1200);
    expect(coerceCost('1200 INR')).toBe(1200);
    expect(coerceCost('approx 500')).toBe(500);
  });

  it('reads a range as its low end', () => {
    expect(coerceCost('500-800')).toBe(500);
  });

  it('treats "free" and friends as zero, and absence as zero', () => {
    expect(coerceCost('Free')).toBe(0);
    expect(coerceCost('N/A')).toBe(0);
    expect(coerceCost('included')).toBe(0);
    expect(coerceCost(null)).toBe(0);
    expect(coerceCost('')).toBe(0);
  });

  it('rejects what is not a cost at all', () => {
    expect(coerceCost('TBD')).toBeNull();
    expect(coerceCost('varies by season')).toBeNull();
    expect(coerceCost(-50)).toBeNull();
    expect(coerceCost(Number.NaN)).toBeNull();
  });
});

describe('coerceCategory', () => {
  it('keeps the eleven allowed values untouched', () => {
    for (const cat of ACTIVITY_CATEGORIES) {
      expect(coerceCategory(cat)).toBe(cat);
    }
  });

  it('maps the words models reach for instead', () => {
    expect(coerceCategory('restaurant')).toBe('food');
    expect(coerceCategory('Museum')).toBe('culture');
    expect(coerceCategory('hiking')).toBe('adventure');
    expect(coerceCategory('hotel')).toBe('accommodation');
    expect(coerceCategory('drive')).toBe('transport');
    expect(coerceCategory('markets')).toBe('shopping');
    expect(coerceCategory('food/drink')).toBe('food');
  });

  it('is the same function the non-schema write paths use', () => {
    // replanDay and the manual activity form write to the same
    // CHECK-constrained column without passing through this schema. Two
    // implementations would eventually give two answers.
    expect(coerceCategory).toBe(normalizeCategory);
  });

  it('takes the first option when the model echoes the format string', () => {
    expect(coerceCategory('sightseeing|food|transport')).toBe('sightseeing');
  });

  it('clamps anything else to a value the database will accept', () => {
    const out = coerceCategory('interdimensional portal');
    expect(ACTIVITY_CATEGORIES).toContain(out);
    expect(out).toBe('other');
  });

  it('never yields a value outside the eleven', () => {
    const junk = ['', null, undefined, 42, '???', 'FOOD ', 'Night-Life'];
    // An absent category becomes 'other'. Defaulting it to 'sightseeing' would
    // be inventing a fact about the activity to make the row insertable.
    expect(coerceCategory(null)).toBe('other');
    for (const v of junk) {
      expect(ACTIVITY_CATEGORIES).toContain(coerceCategory(v));
    }
  });
});

describe('validateItinerary', () => {
  it('accepts a well-formed itinerary', () => {
    const res = validateItinerary(payload(), { days: 1 });
    expect(res.ok).toBe(true);
    expect(res.data.itinerary[0].activities[0].start_time).toBe('09:00');
  });

  it('repairs a response that is wrong but recoverable', () => {
    const res = validateItinerary(
      payload({
        itinerary: [
          {
            day: '1',
            theme: 'Hills',
            activities: [
              activity({
                start_time: '9am',
                end_time: '11:30 AM',
                category: 'restaurant',
                cost: 'Rs 1,200',
              }),
            ],
          },
        ],
      }),
      { days: 1 }
    );

    expect(res.ok).toBe(true);
    const act = res.data.itinerary[0].activities[0];
    expect(act.start_time).toBe('09:00');
    expect(act.end_time).toBe('11:30');
    expect(act.category).toBe('food');
    expect(act.cost).toBe(1200);
    expect(res.data.itinerary[0].day).toBe(1);
  });

  it('rejects the whole response when one time cannot be coerced', () => {
    // The reported bug: "TBD" reached the insert loop and aborted it partway,
    // leaving days 1-3 populated and 4-7 empty. Nothing is written now.
    const res = validateItinerary(
      payload({
        itinerary: [
          { day: 1, theme: '', activities: [activity(), activity({ start_time: 'TBD' })] },
        ],
      }),
      { days: 1 }
    );

    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('itinerary[0].activities[1].start_time');
    expect(res.errors.join('\n')).toContain('"TBD"');
  });

  it('rejects an end time at or before the start time', () => {
    const res = validateItinerary(
      payload({
        itinerary: [
          { day: 1, theme: '', activities: [activity({ start_time: '14:00', end_time: '13:00' })] },
        ],
      })
    );

    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('end_time');
    expect(res.errors.join('\n')).toContain('later than start_time');
  });

  it('rejects a zero-length activity', () => {
    const res = validateItinerary(
      payload({
        itinerary: [
          { day: 1, theme: '', activities: [activity({ start_time: '10:00', end_time: '10:00' })] },
        ],
      })
    );
    expect(res.ok).toBe(false);
  });

  it('rejects a cost that is not a number', () => {
    const res = validateItinerary(
      payload({
        itinerary: [{ day: 1, theme: '', activities: [activity({ cost: 'varies' })] }],
      })
    );

    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('cost');
  });

  it('rejects a missing title', () => {
    const res = validateItinerary(
      payload({
        itinerary: [{ day: 1, theme: '', activities: [activity({ title: '   ' })] }],
      })
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('title');
  });

  it('rejects a day with no activities, rather than writing an empty day', () => {
    const res = validateItinerary(payload({ itinerary: [{ day: 1, activities: [] }] }));
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('at least one activity');
  });

  it('rejects anything that is not an object', () => {
    for (const junk of [null, 'nope', 42, []]) {
      expect(validateItinerary(junk).ok).toBe(false);
    }
  });

  it('rejects duplicate and out-of-range day numbers', () => {
    const dup = validateItinerary(
      payload({
        itinerary: [
          { day: 1, activities: [activity()] },
          { day: 1, activities: [activity()] },
        ],
      }),
      { days: 2 }
    );
    expect(dup.ok).toBe(false);
    expect(dup.errors.join('\n')).toContain('appears more than once');

    const over = validateItinerary(
      payload({ itinerary: [{ day: 9, activities: [activity()] }] }),
      { days: 3 }
    );
    expect(over.ok).toBe(false);
    expect(over.errors.join('\n')).toContain('outside the requested trip');
  });

  it('rejects a day count that does not match the request', () => {
    const res = validateItinerary(payload(), { days: 3 });
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('3 were requested');
  });

  it('skips the day-count check when no count was requested', () => {
    expect(validateItinerary(payload()).ok).toBe(true);
  });

  it('sorts days and their activities chronologically', () => {
    const res = validateItinerary(
      payload({
        itinerary: [
          {
            day: 2,
            activities: [
              activity({ title: 'Dinner', start_time: '19:00', end_time: '20:30' }),
              activity({ title: 'Breakfast', start_time: '08:00', end_time: '09:00' }),
            ],
          },
          { day: 1, activities: [activity()] },
        ],
      }),
      { days: 2 }
    );

    expect(res.ok).toBe(true);
    expect(res.data.itinerary.map((d) => d.day)).toEqual([1, 2]);
    expect(res.data.itinerary[1].activities.map((a) => a.title)).toEqual(['Breakfast', 'Dinner']);
  });

  it('fills optional text fields rather than leaving them undefined', () => {
    const res = validateItinerary({
      itinerary: [
        {
          day: 1,
          activities: [
            {
              title: 'Walk',
              category: 'nature',
              start_time: '09:00',
              end_time: '10:00',
            },
          ],
        },
      ],
    });

    expect(res.ok).toBe(true);
    const act = res.data.itinerary[0].activities[0];
    expect(act.description).toBe('');
    expect(act.notes).toBe('');
    expect(act.booking_link).toBe('');
    expect(act.cost).toBe(0);
    expect(res.data.currency).toBe('');
    expect(res.data.pro_tips).toEqual([]);
  });

  it('never emits a category the database would reject', () => {
    const res = validateItinerary(
      payload({
        itinerary: [
          {
            day: 1,
            activities: [
              activity({ category: 'wine tasting' }),
              activity({ category: undefined, start_time: '12:00', end_time: '13:00' }),
            ],
          },
        ],
      })
    );

    expect(res.ok).toBe(true);
    for (const act of res.data.itinerary[0].activities) {
      expect(ACTIVITY_CATEGORIES).toContain(act.category);
    }
  });
});

describe('formatIssues', () => {
  it('names the path and quotes what the model wrote', () => {
    const raw = payload({
      itinerary: [{ day: 1, activities: [activity({ start_time: '9 in the morning' })] }],
    });
    const parsed = itinerarySchema.safeParse(raw);

    expect(parsed.success).toBe(false);
    const lines = formatIssues(parsed.error.issues, raw);
    expect(lines[0]).toContain('itinerary[0].activities[0].start_time');
    expect(lines[0]).toContain('"9 in the morning"');
  });

  it('says so when a required field is absent entirely', () => {
    const raw = { summary: 'oops' };
    const parsed = itinerarySchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    expect(formatIssues(parsed.error.issues, raw).join('\n')).toContain('field missing');
  });
});

describe('validationRetryPrompt', () => {
  it('carries the specific errors and the format rules', () => {
    const prompt = validationRetryPrompt(['itinerary[0].activities[0].start_time: bad (got "TBD")']);
    expect(prompt).toContain('start_time: bad (got "TBD")');
    expect(prompt).toContain('HH:MM');
    for (const cat of ACTIVITY_CATEGORIES) {
      expect(prompt).toContain(cat);
    }
  });
});
