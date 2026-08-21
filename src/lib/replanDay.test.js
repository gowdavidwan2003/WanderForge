import { afterEach, describe, expect, it, vi } from 'vitest';

import { replanDay, snapshot, undoReplan, writeDay } from '@/lib/replanDay';

const existing = (id, over = {}) => ({
  id,
  title: `Kept ${id}`,
  description: 'd',
  location_name: `Place ${id}`,
  category: 'sightseeing',
  start_time: '09:00:00',
  end_time: '10:00:00',
  cost: 100,
  currency: 'INR',
  notes: 'n',
  booking_link: '',
  order_index: 0,
  latitude: 13.3,
  longitude: 75.8,
  ...over,
});

/** A supabase double that records rpc calls and returns whatever is queued. */
function fakeSupabase(result = { data: [], error: null }) {
  const calls = [];
  return {
    calls,
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      return result;
    }),
    // Present so an accidental direct table write would be visible rather than
    // throwing something unrelated.
    from: vi.fn(() => {
      throw new Error('replanDay must not write to tables directly');
    }),
  };
}

const planResponse = (activities) => ({
  json: async () => ({ theme: 'Hills', activities }),
});

const goodActivity = (over = {}) => ({
  title: 'Mullayanagiri',
  description: '',
  location_name: 'Mullayanagiri',
  category: 'nature',
  start_time: '11:00',
  end_time: '13:00',
  cost: 200,
  notes: '',
  ...over,
});

describe('snapshot', () => {
  it('carries ids, so a restore puts the same activities back', () => {
    const rows = snapshot([existing('a1'), existing('a2')]);
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it('fills the columns the RPC writes, with order derived when absent', () => {
    const [row] = snapshot([{ title: 'Bare' }]);
    expect(row).toMatchObject({
      title: 'Bare', description: '', category: 'other', cost: 0,
      order_index: 0, currency: 'USD', latitude: null, longitude: null,
    });
  });

  it('is empty for an empty day', () => {
    expect(snapshot([])).toEqual([]);
    expect(snapshot()).toEqual([]);
  });
});

describe('writeDay', () => {
  it('sends everything through the atomic RPC, not table writes', () => {
    const supabase = fakeSupabase({ data: [existing('new1')], error: null });
    return writeDay(supabase, 'day-1', snapshot([existing('a1')])).then((res) => {
      expect(res.ok).toBe(true);
      expect(supabase.calls[0].fn).toBe('replace_day_activities');
      expect(supabase.calls[0].args.p_trip_day_id).toBe('day-1');
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  it('refuses an empty replacement rather than emptying the day', async () => {
    // The whole failure mode: an absent plan must never become a deleted day.
    const supabase = fakeSupabase();
    const res = await writeDay(supabase, 'day-1', []);
    expect(res.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('reports failure without claiming anything partial happened', async () => {
    const supabase = fakeSupabase({ data: null, error: { message: 'locked' } });
    const res = await writeDay(supabase, 'day-1', snapshot([existing('a1')]));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('The day was not changed');
  });
});

describe('undoReplan', () => {
  it('restores through the same atomic path', async () => {
    const supabase = fakeSupabase({ data: [existing('a1')], error: null });
    const res = await undoReplan(supabase, 'day-1', snapshot([existing('a1')]));
    expect(res.ok).toBe(true);
    expect(supabase.calls[0].args.p_activities[0].id).toBe('a1');
  });

  it('says so when there is nothing to restore', async () => {
    const supabase = fakeSupabase();
    expect((await undoReplan(supabase, 'day-1', [])).ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('replanDay', () => {
  afterEach(() => vi.unstubAllGlobals());

  const day = { id: 'day-1', day_number: 2, date: '2026-09-01' };
  const trip = { destination: 'Chikmagaluru', currency: 'INR', dest_lat: 13.3, dest_lng: 75.8 };

  /** Routes the plan request and the geocode batch to separate handlers. */
  const stubFetch = (plan) =>
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/ai/replan-day')) return plan;
      return { json: async () => ({ results: {} }) };
    }));

  it('writes nothing when the AI call fails', async () => {
    stubFetch({ json: async () => ({ error: 'All keys rate-limited' }) });
    const supabase = fakeSupabase();

    const res = await replanDay(supabase, { trip, day, keep: [existing('a1')] });

    expect(res.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('writes nothing when the AI returns an empty day', async () => {
    stubFetch(planResponse([]));
    const supabase = fakeSupabase();

    const res = await replanDay(supabase, { trip, day, keep: [existing('a1')] });

    expect(res.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  /**
   * The reported failure: a plan that Postgres would reject used to be found one
   * row at a time, after the day had already been deleted.
   */
  it('writes nothing when the returned day fails validation', async () => {
    stubFetch(planResponse([goodActivity({ start_time: 'TBD' })]));
    const supabase = fakeSupabase();

    const res = await replanDay(supabase, { trip, day, keep: [existing('a1')] });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('nothing was changed');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('sends one atomic call once the plan is validated', async () => {
    stubFetch(planResponse([goodActivity(), goodActivity({ title: 'Dinner', category: 'food', start_time: '19:00', end_time: '20:00' })]));
    const supabase = fakeSupabase({ data: [existing('n1'), existing('n2')], error: null });

    const res = await replanDay(supabase, { trip, day, keep: [existing('a1')] });

    expect(res.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.calls[0].args.p_activities).toHaveLength(2);
    expect(supabase.calls[0].args.p_activities.map((a) => a.order_index)).toEqual([0, 1]);
  });

  it('returns a snapshot of the old day so the replan can be undone', async () => {
    stubFetch(planResponse([goodActivity()]));
    const supabase = fakeSupabase({ data: [existing('n1')], error: null });

    const res = await replanDay(supabase, { trip, day, keep: [existing('a1'), existing('a2')] });

    expect(res.undo.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(res.activities).toHaveLength(1);
  });

  it('does not report success when the write failed', async () => {
    stubFetch(planResponse([goodActivity()]));
    const supabase = fakeSupabase({ data: null, error: { message: 'itinerary is locked' } });

    const res = await replanDay(supabase, { trip, day, keep: [existing('a1')] });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('itinerary is locked');
  });

  it('reuses coordinates for places it is keeping rather than re-geocoding', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/api/ai/replan-day')) {
        return planResponse([goodActivity({ title: 'Kept a1', location_name: 'Place a1' })]);
      }
      return { json: async () => ({ results: {} }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const supabase = fakeSupabase({ data: [], error: null });

    await replanDay(supabase, { trip, day, keep: [existing('a1')] });

    // Only the plan request — nothing left for the geocoder to resolve.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/geocode'))).toHaveLength(0);
    expect(supabase.calls[0].args.p_activities[0].latitude).toBe(13.3);
  });

  it('refuses an empty day up front', async () => {
    const supabase = fakeSupabase();
    const res = await replanDay(supabase, { trip, day, keep: [] });
    expect(res.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
