import { describe, expect, it } from 'vitest';

import {
  blockingIssues,
  checkGeneratedItinerary,
  conflictPayload,
  conflictRetryPrompt,
  planDigest,
  toCheckerInput,
} from '@/lib/conflictReport';

/**
 * Two real places about 10 km apart in a straight line but 22 km by road — the
 * Chikmagaluru town → Mullayanagiri case the checker was built around. Thirty
 * minutes between them is not enough by car.
 */
const TOWN = { lat: 13.3161, lng: 75.7720 };
const PEAK = { lat: 13.3919, lng: 75.7207 };

const act = (over = {}) => ({
  title: 'Something',
  description: '',
  location_name: 'Somewhere',
  category: 'sightseeing',
  start_time: '09:00',
  end_time: '10:00',
  cost: 0,
  notes: '',
  booking_link: '',
  latitude: null,
  longitude: null,
  ...over,
});

describe('toCheckerInput', () => {
  it('gives every day and activity the ids the checker keys on', () => {
    const { days, activities } = toCheckerInput([
      { day: 1, activities: [act(), act()] },
      { day: 2, activities: [act()] },
    ]);

    expect(days.map((d) => d.day_number)).toEqual([1, 2]);
    expect(Object.keys(activities)).toHaveLength(2);
    expect(activities[days[0].id]).toHaveLength(2);

    const ids = Object.values(activities).flat().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not mutate the itinerary it was handed', () => {
    const itinerary = [{ day: 1, activities: [act()] }];
    toCheckerInput(itinerary);
    expect(itinerary[0].activities[0].id).toBeUndefined();
  });
});

describe('checkGeneratedItinerary', () => {
  it('passes an achievable day', () => {
    const result = checkGeneratedItinerary(
      [
        {
          day: 1,
          activities: [
            act({ title: 'Breakfast in town', category: 'food', start_time: '08:00', end_time: '09:00', latitude: TOWN.lat, longitude: TOWN.lng }),
            act({ title: 'Mullayanagiri Peak', category: 'nature', start_time: '11:00', end_time: '13:00', latitude: PEAK.lat, longitude: PEAK.lng }),
          ],
        },
      ],
      { transport_mode: 'car' }
    );

    expect(blockingIssues(result.issues)).toHaveLength(0);
  });

  it('catches a journey that does not fit the gap left for it', () => {
    // This is the whole point: 30 minutes between town and a hill peak reads
    // fine in JSON and cannot be driven.
    const result = checkGeneratedItinerary(
      [
        {
          day: 1,
          activities: [
            act({ title: 'Breakfast in town', category: 'food', start_time: '08:00', end_time: '09:00', latitude: TOWN.lat, longitude: TOWN.lng }),
            act({ title: 'Mullayanagiri Peak', category: 'nature', start_time: '09:10', end_time: '11:00', latitude: PEAK.lat, longitude: PEAK.lng }),
          ],
        },
      ],
      { transport_mode: 'car' }
    );

    const blocking = blockingIssues(result.issues);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].type).toBe('travel-time');
    expect(blocking[0].day).toBe(1);
  });

  it('catches overlapping activities', () => {
    const result = checkGeneratedItinerary(
      [
        {
          day: 2,
          activities: [
            act({ title: 'Museum', start_time: '10:00', end_time: '12:00' }),
            act({ title: 'Lunch', category: 'food', start_time: '11:30', end_time: '12:30' }),
          ],
        },
      ],
      {}
    );

    const blocking = blockingIssues(result.issues);
    expect(blocking.map((i) => i.type)).toContain('overlap');
    expect(blocking[0].day).toBe(2);
  });

  it('does not treat advisory findings as blocking', () => {
    // An over-budget day is worth saying; it is not a reason to spend another
    // completion re-planning the trip.
    const result = checkGeneratedItinerary(
      [{ day: 1, activities: [act({ cost: 5000 }), act({ start_time: '11:00', end_time: '12:00', cost: 5000 })] }],
      { total_budget: 100, currency: 'INR' }
    );

    expect(result.issues.some((i) => i.type === 'over-budget')).toBe(true);
    expect(blockingIssues(result.issues)).toHaveLength(0);
  });

  it('reports unlocatable activities rather than passing them silently', () => {
    const result = checkGeneratedItinerary(
      [{ day: 1, activities: [act(), act({ start_time: '11:00', end_time: '12:00' })] }],
      {}
    );
    expect(result.issues.some((i) => i.type === 'missing-coords')).toBe(true);
  });
});

describe('conflictRetryPrompt', () => {
  it('is null when there is nothing blocking to fix', () => {
    expect(conflictRetryPrompt([])).toBeNull();
    expect(conflictRetryPrompt([{ severity: 'info', type: 'missing-coords', day: 1, message: 'x' }])).toBeNull();
  });

  it('names each conflict verbatim, grouped by day and in day order', () => {
    const prompt = conflictRetryPrompt([
      { severity: 'error', type: 'travel-time', day: 3, message: 'Only 30m between A and B, but the journey is 22 km.' },
      { severity: 'error', type: 'overlap', day: 1, message: '"Lunch" starts before "Museum" ends.' },
      { severity: 'info', type: 'missing-coords', day: 1, message: 'ignore me' },
    ]);

    expect(prompt).toContain('Only 30m between A and B');
    expect(prompt).toContain('"Lunch" starts before "Museum" ends.');
    expect(prompt).not.toContain('ignore me');
    expect(prompt.indexOf('Day 1:')).toBeLessThan(prompt.indexOf('Day 3:'));
  });

  it('tells the model to drop activities rather than shorten journeys', () => {
    const prompt = conflictRetryPrompt([
      { severity: 'warning', type: 'travel-time', day: 1, message: 'Short by 20m.' },
    ]);
    expect(prompt).toContain('Do not shorten a journey');
    expect(prompt).toContain('COMPLETE itinerary');
  });
});

describe('conflictPayload', () => {
  it('marks a clean plan achievable', () => {
    const payload = conflictPayload(
      { issues: [{ severity: 'info', type: 'missing-coords', day: 1, message: 'x' }], summary: { errors: 0 } },
      { attempts: 1 }
    );
    expect(payload.achievable).toBe(true);
    expect(payload.attempts).toBe(1);
  });

  it('marks a plan with a surviving conflict unachievable', () => {
    const payload = conflictPayload(
      { issues: [{ severity: 'error', type: 'travel-time', day: 1, message: 'x' }], summary: { errors: 1 } },
      { attempts: 2, geocoded: { located: 4, total: 5 } }
    );
    expect(payload.achievable).toBe(false);
    expect(payload.geocoded).toEqual({ located: 4, total: 5 });
  });
});

describe('planDigest', () => {
  const itinerary = [
    {
      day: 1,
      activities: [
        act({ title: 'Breakfast', category: 'food', location_name: 'Town Canteen', start_time: '08:00', end_time: '09:00' }),
        act({ title: 'Mullayanagiri', category: 'nature', location_name: 'Mullayanagiri', start_time: '11:00', end_time: '13:00' }),
      ],
    },
  ];

  it('carries what a rescheduling decision needs', () => {
    const digest = planDigest(itinerary);
    expect(digest).toContain('Day 1:');
    expect(digest).toContain('08:00-09:00 Breakfast @ Town Canteen [food]');
    // Place omitted when it just repeats the title — those tokens buy nothing.
    expect(digest).toContain('11:00-13:00 Mullayanagiri [nature]');
    expect(digest).not.toContain('Mullayanagiri @ Mullayanagiri');
  });

  it('is far smaller than echoing the JSON back', () => {
    // The reason it exists: prompt and reply share one 8,000 TPM allowance, so a
    // verbatim echo leaves too little budget to re-emit the itinerary.
    const digest = planDigest(itinerary);
    expect(digest.length).toBeLessThan(JSON.stringify(itinerary).length / 3);
  });

  it('survives an empty or malformed plan', () => {
    expect(planDigest([])).toBe('');
    expect(planDigest([{ day: 1 }])).toBe('Day 1:');
  });
});

describe('conflictRetryPrompt with the plan', () => {
  it('shows the model what it produced, in digest form', () => {
    const prompt = conflictRetryPrompt(
      [{ severity: 'error', type: 'travel-time', day: 1, message: 'Short by 50m.' }],
      [{ day: 1, activities: [act({ title: 'Peak', start_time: '09:00', end_time: '11:00' })] }]
    );

    expect(prompt).toContain('This is the itinerary you produced:');
    expect(prompt).toContain('09:00-11:00 Peak');
    expect(prompt).toContain('Short by 50m.');
  });

  it('still works when no plan is passed', () => {
    const prompt = conflictRetryPrompt([
      { severity: 'error', type: 'overlap', day: 2, message: 'They overlap.' },
    ]);
    expect(prompt).toContain('They overlap.');
  });
});
