import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { geocodeItinerary } from '@/lib/placeLookup';

const act = (location_name, over = {}) => ({
  title: location_name,
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

describe('geocodeItinerary', () => {
  const original = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = original;
    vi.unstubAllGlobals();
  });

  it('attaches coordinates without mutating the itinerary it was given', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => googleHit(JSON.parse(init.body).textQuery)));

    const itinerary = [{ day: 1, activities: [act('Mullayanagiri'), act('Hirekolale Lake')] }];
    const result = await geocodeItinerary(itinerary);

    expect(result.located).toBe(2);
    expect(result.total).toBe(2);
    expect(result.itinerary[0].activities[0].latitude).toBeCloseTo(13.13, 5);
    expect(itinerary[0].activities[0].latitude).toBeUndefined();
  });

  it('pays for a repeated place name only once', async () => {
    const fetchMock = vi.fn(async (_url, init) => googleHit(JSON.parse(init.body).textQuery));
    vi.stubGlobal('fetch', fetchMock);

    const result = await geocodeItinerary([
      { day: 1, activities: [act('Coffee Museum'), act('Coffee Museum')] },
      { day: 2, activities: [act('coffee museum ')] },
    ]);

    // Three activities, one distinct place: one billable lookup.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.located).toBe(3);
  });

  it('reuses coordinates resolved on an earlier pass', async () => {
    const fetchMock = vi.fn(async (_url, init) => googleHit(JSON.parse(init.body).textQuery));
    vi.stubGlobal('fetch', fetchMock);

    const known = new Map([['baba budangiri', { lat: 13.4, lng: 75.7 }]]);
    const result = await geocodeItinerary([{ day: 1, activities: [act('Baba Budangiri')] }], { known });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.itinerary[0].activities[0].latitude).toBe(13.4);
  });

  it('leaves an unlocatable place without coordinates rather than failing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));

    const result = await geocodeItinerary([{ day: 1, activities: [act('Nowhere At All')] }]);

    expect(result.located).toBe(0);
    expect(result.itinerary[0].activities[0].latitude).toBeNull();
  });

  it('starts no lookups once the deadline has passed', async () => {
    const fetchMock = vi.fn(async (_url, init) => googleHit(JSON.parse(init.body).textQuery));
    vi.stubGlobal('fetch', fetchMock);

    const result = await geocodeItinerary([{ day: 1, activities: [act('Somewhere')] }], {
      deadlineAt: Date.now() - 1,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.located).toBe(0);
  });

  it('does not touch Nominatim from the server without a Google key', async () => {
    // Nominatim asks for one request per second; a fifty-place itinerary from a
    // server would be abuse. The browser keeps geocoding one at a time instead.
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const itinerary = [{ day: 1, activities: [act('Somewhere')] }];
    const result = await geocodeItinerary(itinerary);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe('no-google-key');
    expect(result.itinerary).toBe(itinerary);
  });

  it('skips activities that carry no place name', async () => {
    const fetchMock = vi.fn(async (_url, init) => googleHit(JSON.parse(init.body).textQuery));
    vi.stubGlobal('fetch', fetchMock);

    const result = await geocodeItinerary([
      { day: 1, activities: [act(''), act('Real Place')] },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.located).toBe(1);
    expect(result.itinerary[0].activities[0].latitude).toBeNull();
  });
});
