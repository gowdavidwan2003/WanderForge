import { afterEach, describe, expect, it, vi } from 'vitest';

import { geocodeBatch, unresolvedLocations } from '@/lib/geocodeClient';

/** Echoes every query back as a resolved hit. */
const okResponse = () =>
  vi.fn(async (_url, init) => {
    const { queries } = JSON.parse(init.body);
    return {
      json: async () => ({
        results: Object.fromEntries(queries.map((q) => [q, { lat: 1, lng: 2, name: q }])),
      }),
    };
  });

describe('geocodeBatch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves a whole list in one request', async () => {
    const fetchMock = okResponse();
    vi.stubGlobal('fetch', fetchMock);

    const found = await geocodeBatch(['A', 'B', 'C']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(found.get('B')).toEqual({ lat: 1, lng: 2, name: 'B' });
  });

  it('drops blanks and duplicates before asking', async () => {
    const fetchMock = okResponse();
    vi.stubGlobal('fetch', fetchMock);

    await geocodeBatch(['A', 'A', '', null, '   ', 'B']);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).queries).toEqual(['A', 'B']);
  });

  it('does not call the network at all for an empty list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect((await geocodeBatch([])).size).toBe(0);
    expect((await geocodeBatch(['', null])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bias only when there is one', async () => {
    const fetchMock = okResponse();
    vi.stubGlobal('fetch', fetchMock);

    await geocodeBatch(['A'], { lat: 13.3, lng: 75.8 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ lat: 13.3, lng: 75.8 });

    await geocodeBatch(['B'], null);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).lat).toBeUndefined();
  });

  it('chunks past the server’s batch ceiling rather than being rejected', async () => {
    const fetchMock = okResponse();
    vi.stubGlobal('fetch', fetchMock);

    const found = await geocodeBatch(Array.from({ length: 130 }, (_, i) => `P${i}`));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(found.size).toBe(130);
  });

  it('omits unresolved places rather than storing a null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ results: { A: { lat: 1, lng: 2, name: 'A' }, B: null } }),
    })));

    const found = await geocodeBatch(['A', 'B']);
    expect(found.has('A')).toBe(true);
    expect(found.has('B')).toBe(false);
  });

  it('survives a failed request without losing the itinerary it belongs to', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(geocodeBatch(['A'])).resolves.toBeInstanceOf(Map);
  });
});

describe('unresolvedLocations', () => {
  it('skips activities that already have coordinates', () => {
    // Most of the saving on a replan: nearly every place is one being kept.
    const out = unresolvedLocations([
      { location_name: 'Kept', latitude: 13, longitude: 75 },
      { location_name: 'New' },
      { location_name: 'Half', latitude: 13, longitude: null },
    ]);
    expect(out).toEqual(['New', 'Half']);
  });

  it('skips activities with no place name to look up', () => {
    expect(unresolvedLocations([{ title: 'Free time' }, { location_name: '' }])).toEqual([]);
  });

  it('tolerates junk in the list', () => {
    expect(unresolvedLocations([null, undefined])).toEqual([]);
    expect(unresolvedLocations()).toEqual([]);
  });
});
