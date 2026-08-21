import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { geocodeItinerary, resolvePlaces } from '@/lib/placeLookup';
import { cacheKey } from '@/lib/geocodeCache';

const act = (location_name, over = {}) => ({
  title: location_name || 'Untitled',
  location_name,
  category: 'sightseeing',
  start_time: '09:00',
  end_time: '10:00',
  cost: 0,
  ...over,
});

/** A Google Places response for one place, at a coordinate derived from its name. */
const googleHit = (query) => ({
  ok: true,
  json: async () => ({
    places: [
      {
        displayName: { text: query },
        formattedAddress: query,
        location: { latitude: 13 + query.length / 100, longitude: 75 },
      },
    ],
  }),
});

const googleMock = () => vi.fn(async (_url, init) => googleHit(JSON.parse(init.body).textQuery));

/** A cache client pair over an in-memory row list. */
function fakeCache(rows = []) {
  const store = new Map(rows.map((r) => [r.cache_key, r]));
  const written = [];

  return {
    written,
    store,
    supabase: {
      from: () => ({
        select: () => ({
          in: async (_col, keys) => ({
            data: keys.map((k) => store.get(k)).filter(Boolean),
            error: null,
          }),
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

const fresh = (query, near, lat, lng) => ({
  cache_key: cacheKey(query, near),
  query,
  lat,
  lng,
  display_name: query,
  source: 'google',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
});

describe('resolvePlaces', () => {
  const original = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = 'test-key'; });
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = original;
    vi.unstubAllGlobals();
  });

  it('asks Google once per distinct place, however the name is written', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);

    const { hits, stats } = await resolvePlaces([
      'Coffee Museum', 'coffee museum', ' Coffee  Museum ', 'Hirekolale Lake',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stats.requested).toBe(4);
    expect(stats.unique).toBe(2);
    expect(hits.get('coffee museum')).toBeTruthy();
  });

  /** The done-when for S2-4. */
  it('costs nothing when the destination has been planned before', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);

    const near = { lat: 13.3161, lng: 75.772 };
    const cache = fakeCache([
      fresh('mullayanagiri', near, 13.39, 75.72),
      fresh('hirekolale lake', near, 13.31, 75.70),
    ]);

    const { hits, stats } = await resolvePlaces(['Mullayanagiri', 'Hirekolale Lake'], {
      near,
      cache,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.fromCache).toBe(2);
    expect(stats.fromProvider).toBe(0);
    expect(hits.get('mullayanagiri').lat).toBe(13.39);
  });

  it('stores what it had to pay for, so the next run is free', async () => {
    vi.stubGlobal('fetch', googleMock());
    const cache = fakeCache();

    await resolvePlaces(['Mullayanagiri'], { cache });

    expect(cache.written).toHaveLength(1);
    expect(cache.written[0].cache_key).toBe(cacheKey('mullayanagiri', null));
    expect(new Date(cache.written[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('caches a confirmed miss, because Google bills for those too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ places: [] }) })));
    const cache = fakeCache();

    const { stats } = await resolvePlaces(['Nowhere At All'], { cache });

    expect(stats.missed).toBe(1);
    expect(cache.written).toHaveLength(1);
    expect(cache.written[0].lat).toBeNull();
  });

  it('does NOT cache a transport failure', async () => {
    // Caching a network blip would make one bad minute cost that place for 30 days.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const cache = fakeCache();

    const { hits, stats } = await resolvePlaces(['Somewhere'], { cache });

    expect(hits.size).toBe(0);
    expect(stats.missed).toBe(1);
    expect(cache.written).toHaveLength(0);
    warn.mockRestore();
  });

  it('treats a different bias as a different question', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);
    const cache = fakeCache([fresh('district museum', { lat: 13.3, lng: 75.8 }, 13.3, 75.8)]);

    await resolvePlaces(['District Museum'], { near: { lat: 28.6, lng: 77.2 }, cache });

    // The Chikmagaluru entry must not answer for the Delhi lookup.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('starts no lookups once the deadline has passed', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);

    const { stats } = await resolvePlaces(['Somewhere'], { deadlineAt: Date.now() - 1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.fromProvider).toBe(0);
  });

  it('does not touch Nominatim from a batch without a Google key', async () => {
    // Nominatim asks for one request per second; a fifty-place itinerary from a
    // server would be abuse. The browser keeps resolving one at a time instead.
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { skipped } = await resolvePlaces(['Somewhere']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(skipped).toBe('no-google-key');
  });

  it('ignores blank queries entirely', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);

    const { stats } = await resolvePlaces(['', '   ', null, undefined]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.requested).toBe(0);
  });
});

describe('geocodeItinerary', () => {
  const original = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = 'test-key'; });
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = original;
    vi.unstubAllGlobals();
  });

  it('attaches coordinates without mutating the itinerary it was given', async () => {
    vi.stubGlobal('fetch', googleMock());

    const itinerary = [{ day: 1, activities: [act('Mullayanagiri'), act('Hirekolale Lake')] }];
    const result = await geocodeItinerary(itinerary);

    expect(result.located).toBe(2);
    expect(result.total).toBe(2);
    expect(result.itinerary[0].activities[0].latitude).toBeCloseTo(13.13, 5);
    expect(itinerary[0].activities[0].latitude).toBeUndefined();
  });

  it('never re-resolves an activity that already has coordinates', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);

    const result = await geocodeItinerary([
      { day: 1, activities: [act('Known Place', { latitude: 13.4, longitude: 75.7 })] },
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.located).toBe(1);
    expect(result.itinerary[0].activities[0].latitude).toBe(13.4);
  });

  it('reuses coordinates resolved on an earlier pass', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);

    const known = new Map([['baba budangiri', { lat: 13.4, lng: 75.7 }]]);
    const result = await geocodeItinerary([{ day: 1, activities: [act('Baba Budangiri')] }], { known });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.itinerary[0].activities[0].latitude).toBe(13.4);
  });

  it('leaves an unlocatable place without coordinates rather than failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));

    const result = await geocodeItinerary([{ day: 1, activities: [act('Nowhere At All')] }]);

    expect(result.located).toBe(0);
    expect(result.itinerary[0].activities[0].latitude).toBeNull();
    warn.mockRestore();
  });

  it('skips activities that carry no place name', async () => {
    const fetchMock = googleMock();
    vi.stubGlobal('fetch', fetchMock);

    const result = await geocodeItinerary([{ day: 1, activities: [act(''), act('Real Place')] }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.located).toBe(1);
    expect(result.itinerary[0].activities[0].latitude).toBeNull();
  });
});
