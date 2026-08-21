import { describe, expect, it } from 'vitest';

import {
  TRAVEL_TOLERANCE_MIN,
  checkItinerary,
  haversineKm,
  roadLegKey,
  travelMinutes,
} from '@/lib/conflictChecker';

/**
 * The core of the product's differentiator had no test file. This is the file,
 * and its main fixture is the day that exposed the transport bug in the editor —
 * a real generated itinerary, with the real coordinates, so the regression is
 * pinned to the case that actually happened rather than an invented one.
 */

// Real coordinates. Chikmagaluru town to Mullayanagiri is ~10 km straight line
// and ~22 km by road — the case the whole travel model was built around.
const TOWN = { latitude: 13.3161, longitude: 75.7720 };
const PEAK = { latitude: 13.3919, longitude: 75.7207 };
const TRAILHEAD = { latitude: 13.3860, longitude: 75.7280 };

const act = (over = {}) => ({
  id: `a${Math.random().toString(36).slice(2, 8)}`,
  title: 'Activity',
  category: 'sightseeing',
  start_time: '09:00',
  end_time: '10:00',
  cost: 0,
  latitude: null,
  longitude: null,
  ...over,
});

/** Run one day through the checker. */
const check = (activities, trip = { transport_mode: 'car' }) =>
  checkItinerary(trip, [{ id: 'd1', day_number: 3 }], { d1: activities });

const types = (result) => result.issues.map((i) => i.type);

/**
 * Day 3 of the Chikmagaluru trip, as generated. Lunch in the hills, the trek,
 * the drive back, dinner in town. Every warning the editor showed on this day
 * was wrong.
 */
const chikmagaluruDay3 = () => [
  act({
    id: 'lunch', title: 'Lunch at Hill Top Restaurant', category: 'food',
    start_time: '13:30', end_time: '14:45', ...TRAILHEAD,
  }),
  act({
    id: 'trek', title: 'Trek to Mullayanagiri Peak', category: 'adventure',
    start_time: '15:00', end_time: '17:30', ...PEAK,
  }),
  act({
    id: 'drive', title: 'Drive back to Chikmagalur', category: 'transport',
    start_time: '17:45', end_time: '19:15', ...TOWN,
  }),
  act({
    id: 'dinner', title: 'Dinner at Sri Rama Restaurant', category: 'food',
    start_time: '19:30', end_time: '20:30', ...TOWN,
  }),
];

describe('the Chikmagaluru day that exposed the bug', () => {
  it('reports nothing on a day that was correct all along', () => {
    // Before this fix: "Only 15m between Trek and Drive back, but the journey is
    // about 12.9 km — roughly 34m by car. Short by 19m." The drive is allotted
    // 90 minutes. The plan was right; the checker was wrong.
    const result = check(chikmagaluruDay3());
    expect(types(result)).not.toContain('travel-time');
    expect(result.summary.errors).toBe(0);
  });

  it('specifically does not flag the leg into the drive', () => {
    const result = check(chikmagaluruDay3());
    const about = result.issues.filter((i) => i.activityId === 'drive');
    expect(about).toEqual([]);
  });
});

describe('transport entries', () => {
  /** A → transport → B, which is the shape REALISM_RULES asks the model for. */
  const withTransport = (transportOver = {}) => [
    act({ id: 'a', title: 'Peak', start_time: '13:00', end_time: '14:00', ...PEAK }),
    act({
      id: 't', title: 'Drive to town', category: 'transport',
      start_time: '14:00', end_time: '15:00', ...TOWN, ...transportOver,
    }),
    act({ id: 'b', title: 'Dinner', category: 'food', start_time: '15:00', end_time: '16:00', ...TOWN }),
  ];

  it('does not demand travel time for the leg into it', () => {
    expect(types(check(withTransport()))).not.toContain('travel-time');
  });

  it('does not demand travel time for the leg out of it either', () => {
    // A transport entry carries one coordinate but a journey has two ends, and
    // the model names it for either — "Drive back to Chikmagalur" for the
    // destination, "Drive from Chikmagalur" for the origin. Suppressing only the
    // inbound leg would leave the same bug on the other side.
    const originNamed = withTransport({ title: 'Drive from the peak', ...PEAK });
    expect(types(check(originNamed))).not.toContain('travel-time');
  });

  it('still counts the distance toward the day total', () => {
    // Suppressing the warning must not make a 300 km day look like a short one.
    const far = [
      act({ id: 'a', title: 'Start', start_time: '06:00', end_time: '07:00', latitude: 12.9716, longitude: 77.5946 }),
      act({ id: 't', title: 'Long drive', category: 'transport', start_time: '07:00', end_time: '12:00', ...TOWN }),
      act({ id: 'b', title: 'Arrive', start_time: '12:00', end_time: '13:00', ...TOWN }),
    ];
    expect(types(check(far))).toContain('long-day');
  });

  it('does not warn about a long hop that has its own entry', () => {
    const far = [
      act({ id: 'a', title: 'Start', start_time: '06:00', end_time: '07:00', latitude: 12.9716, longitude: 77.5946 }),
      act({ id: 't', title: 'Long drive', category: 'transport', start_time: '07:00', end_time: '12:00', ...TOWN }),
    ];
    expect(types(check(far))).not.toContain('long-hop');
  });

  it('is not judged against venue opening hours', () => {
    // "Most venues are closed before 06:00" is true and irrelevant to a drive.
    const dawn = [act({ id: 't', title: 'Early drive', category: 'transport', start_time: '05:00', end_time: '08:00', ...TOWN })];
    expect(types(check(dawn))).not.toContain('odd-hours');

    const night = [act({ id: 't', title: 'Night drive', category: 'transport', start_time: '22:00', end_time: '23:50', ...TOWN })];
    expect(types(check(night))).not.toContain('odd-hours');
  });

  it('is still checked for the things that are always wrong', () => {
    // Exempt from place-based checks, not from internal consistency.
    const backwards = [act({ id: 't', title: 'Drive', category: 'transport', start_time: '15:00', end_time: '14:00', ...TOWN })];
    expect(types(check(backwards))).toContain('invalid-duration');

    const clashing = [
      act({ id: 'a', title: 'Trek', start_time: '13:00', end_time: '17:00', ...PEAK }),
      act({ id: 't', title: 'Drive', category: 'transport', start_time: '16:00', end_time: '17:30', ...TOWN }),
    ];
    expect(types(check(clashing))).toContain('overlap');
  });

  it('does not exempt accommodation, which is a place you travel to', () => {
    const hotel = [
      act({ id: 'a', title: 'Peak', start_time: '13:00', end_time: '14:00', ...PEAK }),
      act({ id: 'h', title: 'Check in', category: 'accommodation', start_time: '14:05', end_time: '14:30', ...TOWN }),
    ];
    expect(types(check(hotel))).toContain('travel-time');
  });
});

describe('the tolerance', () => {
  /**
   * Two places with a controllable gap between them.
   *
   * The gap has to stay positive — a negative one is an overlap, which the
   * checker reports instead and short-circuits before the travel check. That is
   * correct behaviour and it is why the error-severity case below uses a long
   * journey rather than a bigger negative offset on a short one.
   */
  const pair = (gapMinutes, from = PEAK, to = TOWN) => {
    const end = 8 * 60;
    const start = end + gapMinutes;
    const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return [
      act({ id: 'a', title: 'A', start_time: '07:00', end_time: hh(end), ...from }),
      act({ id: 'b', title: 'B', start_time: hh(start), end_time: hh(start + 60), ...to }),
    ];
  };

  const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

  // What the checker thinks this journey costs, so the cases below are anchored
  // to the model rather than to a guessed number.
  const needed = travelMinutes(
    haversineKm(PEAK.latitude, PEAK.longitude, TOWN.latitude, TOWN.longitude),
    'car'
  );

  it('says nothing when the shortfall is inside the error bar', () => {
    // The editor showed "Short by 3m" and "Short by 4m" on estimates derived
    // from straight-line distance. That is noise, and noise trains people to
    // ignore the warnings that matter.
    expect(types(check(pair(needed - 3)))).not.toContain('travel-time');
    expect(types(check(pair(needed - TRAVEL_TOLERANCE_MIN)))).not.toContain('travel-time');
  });

  it('warns once the shortfall is real', () => {
    expect(types(check(pair(needed - TRAVEL_TOLERANCE_MIN - 1)))).toContain('travel-time');
  });

  it('escalates to an error past thirty minutes', () => {
    // A long journey, so the shortfall can exceed thirty minutes while the gap
    // itself stays positive.
    const far = travelMinutes(
      haversineKm(BENGALURU.latitude, BENGALURU.longitude, TOWN.latitude, TOWN.longitude),
      'car'
    );
    const result = check(pair(far - 45, BENGALURU, TOWN));
    const issue = result.issues.find((i) => i.type === 'travel-time');
    expect(issue.severity).toBe('error');
  });

  it('keeps warning severity in the band between', () => {
    const result = check(pair(needed - 20));
    const issue = result.issues.find((i) => i.type === 'travel-time');
    expect(issue.severity).toBe('warning');
  });
});

describe('everything the fix must not have broken', () => {
  it('still catches an impossible journey between two places', () => {
    // Bengaluru to Chikmagaluru in fifteen minutes.
    const impossible = [
      act({ id: 'a', title: 'Bengaluru', start_time: '09:00', end_time: '10:00', latitude: 12.9716, longitude: 77.5946 }),
      act({ id: 'b', title: 'Chikmagaluru', start_time: '10:15', end_time: '11:00', ...TOWN }),
    ];
    const issue = check(impossible).issues.find((i) => i.type === 'travel-time');
    expect(issue.severity).toBe('error');
  });

  it('still catches overlaps', () => {
    const overlapping = [
      act({ id: 'a', title: 'Museum', start_time: '10:00', end_time: '12:00', ...TOWN }),
      act({ id: 'b', title: 'Lunch', category: 'food', start_time: '11:30', end_time: '12:30', ...TOWN }),
    ];
    expect(types(check(overlapping))).toContain('overlap');
  });

  it('still flags an over-budget day', () => {
    const pricey = [act({ id: 'a', title: 'Spa', cost: 9000, ...TOWN })];
    expect(types(check(pricey, { transport_mode: 'car', total_budget: 1000 }))).toContain('over-budget');
  });

  it('still notes activities with no coordinates', () => {
    const unmapped = [
      act({ id: 'a', title: 'A', ...TOWN }),
      act({ id: 'b', title: 'B', start_time: '11:00', end_time: '12:00' }),
    ];
    expect(types(check(unmapped))).toContain('missing-coords');
  });

  it('still flags a museum at dawn', () => {
    const early = [act({ id: 'a', title: 'Museum', category: 'culture', start_time: '05:00', end_time: '07:00', ...TOWN })];
    expect(types(check(early))).toContain('odd-hours');
  });
});

describe('travelMinutes', () => {
  it('prefers a routing provider’s own duration when there is one', () => {
    expect(travelMinutes(10, 'car', 22, 90)).toBe(102); // 90 driving + 12 overhead
  });

  it('applies the hairpin correction when road distance reveals one', () => {
    // Chikmagaluru → Mullayanagiri: 10.1 km straight, 21.8 km by road. A flat
    // 35 km/h model puts that at ~34 minutes; the real drive is about 90.
    const flat = travelMinutes(10.1, 'car');
    const ghat = travelMinutes(10.1, 'car', 21.8);
    expect(ghat).toBeGreaterThan(flat);
  });

  it('is the flat model when no road distance is supplied', () => {
    // Worth pinning: no caller currently passes road data, so this is the path
    // every check in the app actually takes.
    expect(travelMinutes(10.1, 'car')).toBeLessThan(40);
  });
});


describe('measured roads vs estimates', () => {
  /**
   * The whole reason routeLookup exists. Chikmagaluru town to Mullayanagiri is
   * 10.1 km straight line. Measured against Google Routes it is 21.6 km and 44
   * minutes of driving; the flat model calls the whole journey 35 minutes. Until
   * road data reached the checker, 35 was the number every warning was built on.
   */
  const townToPeak = [
    act({ id: 'a', title: 'Breakfast in town', start_time: '08:00', end_time: '09:00', ...TOWN }),
    act({ id: 'b', title: 'Mullayanagiri Peak', start_time: '09:30', end_time: '12:00', ...PEAK }),
  ];

  it('stays quiet on a 30-minute gap when it is only estimating', () => {
    // The flat model wants 35 minutes and 30 are available. Five short, inside
    // the tolerance, so nothing is said — and the real journey needs 56.
    expect(types(check(townToPeak))).not.toContain('travel-time');
  });

  it('catches the same day once the road is measured', () => {
    const legs = {
      // Real figures from Google Routes for this pair.
      [roadLegKey(TOWN, PEAK)]: { km: 21.6, minutes: 44 },
    };
    const result = checkItinerary(
      { transport_mode: 'car' },
      [{ id: 'd1', day_number: 1 }],
      { d1: townToPeak },
      legs
    );

    // 56 minutes needed against 30 available: 26 short, and now visible.
    const issue = result.issues.find((i) => i.type === 'travel-time');
    expect(issue).toBeDefined();
    // And it says so in the language of measurement rather than estimation.
    expect(issue.message).toContain('routing puts at');
    expect(issue.message).toContain('21.6 km by road');
  });

  it('uses the provider duration in preference to any speed model', () => {
    // A routing engine already knows about gradient, road class and traffic.
    // All the checker adds is the door-to-door overhead it never includes.
    expect(travelMinutes(10.1, 'car', 21.6, 44)).toBe(56);
  });

  it('falls back to the sinuosity model when only distance is known', () => {
    // ORS returns distance without a usable duration for some profiles.
    // Better than the flat model and still not the real answer: 71 against a
    // measured 56. A second-best, not a substitute for asking the provider.
    expect(travelMinutes(10.1, 'car')).toBe(35);
    expect(travelMinutes(10.1, 'car', 21.6)).toBe(71);
  });

  it('keys legs by coordinates, so they survive activities being re-inserted', () => {
    // Generation checks a plan with synthetic ids; the editor checks the same
    // places after they have real ones. An id-keyed leg would be lost between
    // the two, which is why nothing could ever populate the old key format.
    const before = { id: 'gen-day-1-act-0', ...TOWN };
    const after = { id: 'e5b1c9a2-real-uuid', ...TOWN };
    expect(roadLegKey(before, PEAK)).toBe(roadLegKey(after, PEAK));
  });

  it('rounds coordinates so a re-geocoded venue still hits the same leg', () => {
    // Geocoding returns very slightly different coordinates for one place over
    // time. Rounding to ~110 m keeps those on one cached leg.
    const nudged = { latitude: TOWN.latitude + 0.0002, longitude: TOWN.longitude - 0.0003 };
    expect(roadLegKey(nudged, PEAK)).toBe(roadLegKey(TOWN, PEAK));
  });

  it('is null for a leg with an unmapped end', () => {
    expect(roadLegKey(TOWN, { latitude: null, longitude: null })).toBeNull();
  });
});
