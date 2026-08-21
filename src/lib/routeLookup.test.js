import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { legsForDay, legsForItinerary, resolveLegs } from '@/lib/routeLookup';
import { legCacheKey, legKey } from '@/lib/routeCache';

const TOWN = { lat: 13.3161, lng: 75.7720 };
const PEAK = { lat: 13.3919, lng: 75.7207 };
const FALLS = { lat: 13.4820, lng: 75.6390 };

const at = (p) => ({ latitude: p.lat, longitude: p.lng });

/** A Google Routes response for one leg. */
const googleRoute = (km, minutes) => ({
  ok: true,
  json: async () => ({
    routes: [{ distanceMeters: km * 1000, duration: `${minutes * 60}s` }],
  }),
});

/** Cache client pair over an in-memory store. */
function fakeCache(rows = []) {
  const store = new Map(rows.map((r) => [r.cache_key, r]));
  const written = [];
  return {
    store,
    written,
    supabase: {
      from: () => ({
        select: () => ({
          in: async (_c, keys) => ({ data: keys.map((k) => store.get(k)).filter(Boolean), error: null }),
        }),
      }),
    },
    admin: {
      from: () => ({
        upsert: async (rowsIn) => {
          written.push(...rowsIn);
          for (const r of rowsIn) store.set(r.cache_key, r);
          return { error: null };
        },
      }),
    },
  };
}

const cached = (from, to, mode, km, minutes) => ({
  cache_key: legCacheKey(from, to, mode),
  km,
  minutes,
  source: 'google',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
});

describe('legsForDay', () => {
  it('pairs consecutive activities that both have coordinates', () => {
    const pairs = legsForDay([at(TOWN), at(PEAK), at(FALLS)]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].from).toEqual(TOWN);
  });

  it('skips a pair when either end is unmapped', () => {
    expect(legsForDay([at(TOWN), { latitude: null, longitude: null }, at(PEAK)])).toHaveLength(0);
  });

  it('skips a leg to the same place', () => {
    // Two activities at one venue is not a journey, and asking a routing
    // provider about it is a billed call for a zero.
    expect(legsForDay([at(TOWN), at(TOWN)])).toHaveLength(0);
  });

  it('is empty for a day with fewer than two stops', () => {
    expect(legsForDay([at(TOWN)])).toEqual([]);
    expect(legsForDay([])).toEqual([]);
  });
});

describe('legsForItinerary', () => {
  it('deduplicates a leg that appears on more than one day', () => {
    const days = [{ id: 'd1' }, { id: 'd2' }];
    const acts = { d1: [at(TOWN), at(PEAK)], d2: [at(TOWN), at(PEAK)] };
    expect(legsForItinerary(days, acts)).toHaveLength(1);
  });
});

describe('resolveLegs', () => {
  const original = process.env.GOOGLE_MAPS_API_KEY;
  const originalOrs = process.env.OPENROUTESERVICE_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    delete process.env.OPENROUTESERVICE_API_KEY;
    delete process.env.NEXT_PUBLIC_ORS_API_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = original;
    if (originalOrs !== undefined) process.env.OPENROUTESERVICE_API_KEY = originalOrs;
    vi.unstubAllGlobals();
  });

  it('returns legs keyed the way checkItinerary looks them up', () => {
    vi.stubGlobal('fetch', vi.fn(async () => googleRoute(21.8, 71)));

    return resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'car' }).then(({ legs }) => {
      expect(legs[legKey(TOWN, PEAK)]).toEqual({ km: 21.8, minutes: 71 });
    });
  });

  /** The reason the cache exists: Routes is billed per leg. */
  it('costs nothing when the legs are already cached', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cache = fakeCache([cached(TOWN, PEAK, 'car', 21.8, 71)]);

    const { legs, stats } = await resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'car', cache });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.fromCache).toBe(1);
    expect(legs[legKey(TOWN, PEAK)].km).toBe(21.8);
  });

  it('stores what it had to pay for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => googleRoute(21.8, 71)));
    const cache = fakeCache();

    await resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'car', cache });

    expect(cache.written).toHaveLength(1);
    expect(cache.written[0].km).toBe(21.8);
    expect(new Date(cache.written[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('treats a different mode as a different question', async () => {
    const fetchMock = vi.fn(async () => googleRoute(21.8, 71));
    vi.stubGlobal('fetch', fetchMock);
    // Driving and walking the same road are not the same journey.
    const cache = fakeCache([cached(TOWN, PEAK, 'car', 21.8, 71)]);

    await resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'walking', cache });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches a confirmed no-route so it is not re-asked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ routes: [] }) })));
    const cache = fakeCache();

    const { legs, stats } = await resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'car', cache });

    expect(legs[legKey(TOWN, PEAK)]).toBeUndefined();
    expect(stats.missed).toBe(1);
    expect(cache.written[0].km).toBeNull();
  });

  it('does NOT cache a transport failure', async () => {
    // One bad minute must not cost this leg its real numbers for thirty days.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const cache = fakeCache();

    const { legs, stats } = await resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'car', cache });

    expect(Object.keys(legs)).toHaveLength(0);
    expect(stats.missed).toBe(1);
    expect(cache.written).toHaveLength(0);
  });

  it('starts no lookups once the deadline has passed', async () => {
    const fetchMock = vi.fn(async () => googleRoute(21.8, 71));
    vi.stubGlobal('fetch', fetchMock);

    await resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'car', deadlineAt: Date.now() - 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades to estimates when no routing key is configured', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { legs, skipped } = await resolveLegs([{ from: TOWN, to: PEAK }], { mode: 'car' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(skipped).toBe('no-routing-key');
    // Absent, not zero — the checker falls back to its own estimate.
    expect(Object.keys(legs)).toHaveLength(0);
  });

  it('does no work at all for an empty set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { stats } = await resolveLegs([]);
    expect(stats.requested).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
