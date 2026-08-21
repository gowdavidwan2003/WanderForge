import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWeather,
  readCachedWeather,
  weatherKey,
  writeCachedWeather,
} from '@/lib/weatherCache';

const FORECAST = [{ date: '2026-09-01', icon: '☀️', tempMax: 28, tempMin: 18 }];

/** Node has no sessionStorage; this is the smallest thing that behaves like one. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}

describe('weatherKey', () => {
  it('rounds to a cell finer than the forecast’s own resolution', () => {
    expect(weatherKey(13.3161, 75.7720)).toBe(weatherKey(13.3159, 75.7724));
    expect(weatherKey(13.31, 75.77)).not.toBe(weatherKey(28.61, 77.21));
  });
});

describe('cache read/write', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a forecast', () => {
    expect(writeCachedWeather(13.3, 75.8, FORECAST)).toBe(true);
    expect(readCachedWeather(13.3, 75.8)).toEqual(FORECAST);
  });

  it('expires after an hour, because forecasts do move', () => {
    const now = 1_700_000_000_000;
    writeCachedWeather(13.3, 75.8, FORECAST, now);

    expect(readCachedWeather(13.3, 75.8, now + 59 * 60_000)).toEqual(FORECAST);
    expect(readCachedWeather(13.3, 75.8, now + 61 * 60_000)).toBeNull();
  });

  it('is a miss for a place never cached', () => {
    expect(readCachedWeather(1, 2)).toBeNull();
  });

  it('treats corrupt data as a miss rather than throwing', () => {
    globalThis.sessionStorage.setItem(weatherKey(13.3, 75.8), 'not json');
    expect(readCachedWeather(13.3, 75.8)).toBeNull();
  });

  it('ignores coordinates that are not numbers', () => {
    expect(writeCachedWeather(undefined, undefined, FORECAST)).toBe(false);
    expect(readCachedWeather(undefined, undefined)).toBeNull();
  });

  it('survives storage being unavailable', () => {
    // A partitioned or cookie-blocked context can throw on access itself.
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    });
    expect(readCachedWeather(13.3, 75.8)).toBeNull();
    expect(writeCachedWeather(13.3, 75.8, FORECAST)).toBe(false);
  });
});

describe('fetchWeather', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('goes to the network once and serves the rest from cache', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ forecast: FORECAST }) }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchWeather(13.3, 75.8)).toEqual(FORECAST);
    expect(await fetchWeather(13.3, 75.8)).toEqual(FORECAST);

    // The point of the ticket: this used to run on every realtime event, for
    // coordinates that had not moved.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call the network without coordinates', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Number(null) is 0 — a real place in the Gulf of Guinea. A trip with no
    // destination coordinates must not fetch a forecast for it.
    expect(await fetchWeather(null, null)).toBeNull();
    expect(await fetchWeather(undefined, undefined)).toBeNull();
    expect(await fetchWeather("", "")).toBeNull();
    expect(await fetchWeather("abc", 75)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchWeather(13.3, 75.8)).toBeNull();
  });

  it('does not cache a response with no forecast', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ error: 'upstream down' }) }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchWeather(13.3, 75.8)).toBeNull();
    expect(await fetchWeather(13.3, 75.8)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
