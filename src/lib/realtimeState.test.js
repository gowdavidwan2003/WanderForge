import { describe, expect, it } from 'vitest';

import {
  applyActivityEvent,
  applyDayEvent,
  createEchoFilter,
  pickSelectedDay,
  sameRow,
  shapeTripPayload,
} from '@/lib/realtimeState';

const act = (id, dayId, over = {}) => ({
  id,
  trip_day_id: dayId,
  title: `Activity ${id}`,
  description: '',
  location_name: '',
  category: 'sightseeing',
  start_time: '09:00:00',
  end_time: '10:00:00',
  cost: 0,
  currency: 'INR',
  notes: '',
  booking_link: '',
  order_index: 0,
  latitude: null,
  longitude: null,
  ...over,
});

describe('shapeTripPayload', () => {
  const row = {
    id: 't1',
    title: 'Chikmagaluru',
    trip_days: [
      { id: 'd2', day_number: 2, activities: [act('a3', 'd2', { order_index: 1 }), act('a2', 'd2', { order_index: 0 })] },
      { id: 'd1', day_number: 1, activities: [act('a1', 'd1')] },
    ],
  };

  it('splits one embedded read into the three shapes the editor holds', () => {
    const { trip, days, activities } = shapeTripPayload(row);

    expect(trip.title).toBe('Chikmagaluru');
    expect(days.map((d) => d.day_number)).toEqual([1, 2]);
    expect(Object.keys(activities).sort()).toEqual(['d1', 'd2']);
  });

  it('orders days and their activities', () => {
    const { activities } = shapeTripPayload(row);
    expect(activities.d2.map((a) => a.id)).toEqual(['a2', 'a3']);
  });

  it('does not leave the embedded activities on the day rows', () => {
    // Two sources of truth for the same activities is how they drift apart.
    const { days, trip } = shapeTripPayload(row);
    expect(days[0].activities).toBeUndefined();
    expect(trip.trip_days).toBeUndefined();
  });

  it('handles a trip with no days', () => {
    expect(shapeTripPayload({ id: 't1' })).toEqual({ trip: { id: 't1' }, days: [], activities: {} });
    expect(shapeTripPayload(null).trip).toBeNull();
  });
});

describe('applyActivityEvent', () => {
  const base = { d1: [act('a1', 'd1', { order_index: 0 })], d2: [] };

  it('adds an insert into the right day, in order', () => {
    const next = applyActivityEvent(base, 'INSERT', act('a2', 'd1', { order_index: 1 }));
    expect(next.d1.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('places an out-of-order insert where it belongs', () => {
    const next = applyActivityEvent(base, 'INSERT', act('a0', 'd1', { order_index: -1 }));
    expect(next.d1.map((a) => a.id)).toEqual(['a0', 'a1']);
  });

  it('merges an update in place', () => {
    const next = applyActivityEvent(base, 'UPDATE', act('a1', 'd1', { title: 'Renamed' }));
    expect(next.d1[0].title).toBe('Renamed');
    expect(next.d1).toHaveLength(1);
  });

  it('removes a delete', () => {
    const next = applyActivityEvent(base, 'DELETE', act('a1', 'd1'));
    expect(next.d1).toHaveLength(0);
  });

  it('moves an activity that changed day, without duplicating it', () => {
    const next = applyActivityEvent(base, 'UPDATE', act('a1', 'd2'));
    expect(next.d1).toHaveLength(0);
    expect(next.d2.map((a) => a.id)).toEqual(['a1']);
  });

  /** The property that makes echo handling safe even when the filter misses. */
  it('returns the same object when nothing actually changed', () => {
    expect(applyActivityEvent(base, 'UPDATE', act('a1', 'd1'))).toBe(base);
    expect(applyActivityEvent(base, 'DELETE', act('nope', 'd1'))).toBe(base);
    expect(applyActivityEvent(base, 'INSERT', act('a9', 'unknown-day'))).toBe(base);
    expect(applyActivityEvent(base, 'INSERT', null)).toBe(base);
  });

  it('ignores a bumped updated_at as a change', () => {
    const withStamp = { d1: [{ ...act('a1', 'd1'), updated_at: 'yesterday' }], d2: [] };
    const same = applyActivityEvent(withStamp, 'UPDATE', { ...act('a1', 'd1'), updated_at: 'now' });
    expect(same).toBe(withStamp);
  });

  it('is idempotent, so a duplicated event cannot duplicate a row', () => {
    const row = act('a2', 'd1', { order_index: 1 });
    const once = applyActivityEvent(base, 'INSERT', row);
    const twice = applyActivityEvent(once, 'INSERT', row);
    expect(twice.d1).toHaveLength(2);
    expect(twice).toBe(once);
  });
});

describe('sameRow', () => {
  it('compares what is rendered, not every column', () => {
    expect(sameRow(act('a1', 'd1'), { ...act('a1', 'd1'), updated_at: 'x' })).toBe(true);
    expect(sameRow(act('a1', 'd1'), act('a1', 'd1', { cost: 5 }))).toBe(false);
  });
});

describe('applyDayEvent', () => {
  const days = [{ id: 'd1', day_number: 1 }, { id: 'd2', day_number: 2 }];
  const activities = { d1: [act('a1', 'd1')], d2: [] };

  it('inserts a day in order and gives it a bucket', () => {
    const next = applyDayEvent(days, activities, 'INSERT', { id: 'd0', day_number: 0 });
    expect(next.days.map((d) => d.id)).toEqual(['d0', 'd1', 'd2']);
    // Without a bucket, applyActivityEvent's membership check drops its events.
    expect(next.activities.d0).toEqual([]);
  });

  it('removes a deleted day and its activities', () => {
    const next = applyDayEvent(days, activities, 'DELETE', { id: 'd1' });
    expect(next.days.map((d) => d.id)).toEqual(['d2']);
    expect(next.activities.d1).toBeUndefined();
  });

  it('merges an update without disturbing the activities', () => {
    const next = applyDayEvent(days, activities, 'UPDATE', { id: 'd1', day_number: 1, notes: 'hi' });
    expect(next.days[0].notes).toBe('hi');
    expect(next.activities).toBe(activities);
  });

  it('ignores an event with no row', () => {
    expect(applyDayEvent(days, activities, 'INSERT', null).days).toBe(days);
  });
});

describe('pickSelectedDay', () => {
  const days = [{ id: 'd1', day_number: 1 }, { id: 'd5', day_number: 5 }];

  it('keeps the day the user is on across a reload', () => {
    // The reported bug: editing day 5 threw you back to day 1 on every event,
    // because the callback closed over a selectedDay that was always null.
    const stale = { id: 'd5', day_number: 5 };
    expect(pickSelectedDay(days, stale).id).toBe('d5');
  });

  it('matches by id, not by reference', () => {
    const reloaded = [{ id: 'd5', day_number: 5, notes: 'fresh' }];
    expect(pickSelectedDay(reloaded, { id: 'd5' }).notes).toBe('fresh');
  });

  it('falls back to the first day when the selection is gone', () => {
    expect(pickSelectedDay(days, { id: 'deleted' }).id).toBe('d1');
    expect(pickSelectedDay(days, null).id).toBe('d1');
  });

  it('is null for a trip with no days', () => {
    expect(pickSelectedDay([], { id: 'd1' })).toBeNull();
  });
});

describe('createEchoFilter', () => {
  const clock = (start = 0) => {
    let now = start;
    const fn = () => now;
    fn.advance = (ms) => { now += ms; };
    return fn;
  };

  it('recognises this tab’s own writes', () => {
    const echoes = createEchoFilter();
    echoes.remember(['a1', 'a2']);
    expect(echoes.isEcho('a1')).toBe(true);
    expect(echoes.isEcho('someone-else')).toBe(false);
  });

  it('forgets, so a collaborator’s later edit is never discarded as an echo', () => {
    const now = clock();
    const echoes = createEchoFilter(15_000, now);
    echoes.remember(['a1']);

    now.advance(14_000);
    expect(echoes.isEcho('a1')).toBe(true);

    now.advance(2_000);
    expect(echoes.isEcho('a1')).toBe(false);
  });

  it('does not grow without bound', () => {
    const now = clock();
    const echoes = createEchoFilter(1_000, now);
    echoes.remember(Array.from({ length: 50 }, (_, i) => `a${i}`));
    now.advance(2_000);
    echoes.remember(['fresh']);
    expect(echoes.size).toBe(1);
  });

  it('tolerates junk ids', () => {
    const echoes = createEchoFilter();
    echoes.remember([null, undefined, '']);
    echoes.remember(undefined);
    expect(echoes.isEcho(null)).toBe(false);
    expect(echoes.size).toBe(0);
  });
});
