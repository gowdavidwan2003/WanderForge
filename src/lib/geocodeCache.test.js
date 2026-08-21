import { describe, expect, it, vi } from 'vitest';

import {
  CACHE_TTL_DAYS,
  CACHE_TTL_MS,
  biasKey,
  cacheKey,
  isFresh,
  normaliseQuery,
  readCache,
  toHit,
  toRow,
  writeCache,
} from '@/lib/geocodeCache';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('normaliseQuery', () => {
  it('folds the differences a model produces at random', () => {
    expect(normaliseQuery('  Mullayanagiri  Peak ')).toBe('mullayanagiri peak');
    expect(normaliseQuery('MULLAYANAGIRI PEAK')).toBe('mullayanagiri peak');
    expect(normaliseQuery('Mullayanagiri Peak.')).toBe('mullayanagiri peak');
    expect(normaliseQuery('Mullayanagiri\tPeak')).toBe('mullayanagiri peak');
  });

  it('does not merge places that are genuinely different', () => {
    expect(normaliseQuery('Coffee Museum')).not.toBe(normaliseQuery('Coffee Museum Cafe'));
  });

  it('survives absent input', () => {
    expect(normaliseQuery(null)).toBe('');
    expect(normaliseQuery(undefined)).toBe('');
  });
});

describe('biasKey', () => {
  it('rounds to a cell two users planning one town will share', () => {
    expect(biasKey({ lat: 13.3161, lng: 75.772 })).toBe('13.3,75.8');
    expect(biasKey({ lat: 13.3402, lng: 75.7511 })).toBe('13.3,75.8');
  });

  it('keeps genuinely distant biases apart', () => {
    expect(biasKey({ lat: 13.3, lng: 75.8 })).not.toBe(biasKey({ lat: 28.6, lng: 77.2 }));
  });

  it('is empty when there is no bias', () => {
    expect(biasKey(null)).toBe('');
    expect(biasKey({})).toBe('');
    expect(biasKey({ lat: 'x', lng: 'y' })).toBe('');
  });
});

describe('cacheKey', () => {
  it('is stable across spelling noise but not across bias', () => {
    const near = { lat: 13.3161, lng: 75.772 };
    expect(cacheKey(' Hirekolale Lake ', near)).toBe(cacheKey('hirekolale lake', near));
    expect(cacheKey('District Museum', near)).not.toBe(
      cacheKey('District Museum', { lat: 28.6, lng: 77.2 })
    );
  });

  it('separates a biased lookup from an unbiased one', () => {
    expect(cacheKey('x', null)).not.toBe(cacheKey('x', { lat: 1, lng: 1 }));
  });
});

describe('isFresh', () => {
  const now = 1_700_000_000_000;

  it('honours the 30-day limit Google’s terms impose', () => {
    expect(CACHE_TTL_DAYS).toBe(30);
    expect(CACHE_TTL_MS).toBe(30 * DAY_MS);
  });

  it('accepts an entry inside its window and rejects one past it', () => {
    expect(isFresh({ expires_at: new Date(now + DAY_MS).toISOString() }, now)).toBe(true);
    expect(isFresh({ expires_at: new Date(now - 1).toISOString() }, now)).toBe(false);
  });

  it('rejects a row with no or unusable expiry rather than assuming it is good', () => {
    expect(isFresh({}, now)).toBe(false);
    expect(isFresh({ expires_at: 'not a date' }, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
  });
});

describe('toRow / toHit', () => {
  const now = 1_700_000_000_000;

  it('round-trips a resolved place', () => {
    const row = toRow('  Mullayanagiri ', { lat: 13.3, lng: 75.8 }, {
      name: 'Mullayanagiri, Karnataka', lat: 13.39, lng: 75.72, source: 'google',
    }, now);

    expect(row.query).toBe('mullayanagiri');
    expect(row.bias_key).toBe('13.3,75.8');
    expect(new Date(row.expires_at).getTime()).toBe(now + CACHE_TTL_MS);
    expect(toHit(row)).toMatchObject({ lat: 13.39, lng: 75.72, cached: true });
  });

  it('stores a confirmed miss as a row with no coordinates', () => {
    // Worth caching: an unfindable name is re-asked on every regenerate, and
    // Google bills for "no results" the same as for a hit.
    const row = toRow('Nowhere At All', null, null, now);
    expect(row.lat).toBeNull();
    expect(toHit(row)).toBeNull();
  });
});

describe('readCache', () => {
  const now = 1_700_000_000_000;

  const clientReturning = (data, error = null) => ({
    from: () => ({ select: () => ({ in: async () => ({ data, error }) }) }),
  });

  it('returns only entries that are still inside their window', async () => {
    const found = await readCache(
      clientReturning([
        { cache_key: 'fresh@', lat: 1, lng: 2, expires_at: new Date(now + DAY_MS).toISOString() },
        { cache_key: 'stale@', lat: 3, lng: 4, expires_at: new Date(now - DAY_MS).toISOString() },
      ]),
      ['fresh@', 'stale@'],
      now
    );

    expect(found.has('fresh@')).toBe(true);
    expect(found.has('stale@')).toBe(false);
  });

  it('degrades to a miss when the table is unreadable', async () => {
    // Most likely the migration has not been run. A cache that cannot be read is
    // a cost problem and must never become a correctness one.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const found = await readCache(clientReturning(null, { message: 'relation does not exist' }), ['a']);
    expect(found.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does no work at all for an empty batch or no client', async () => {
    expect((await readCache(null, ['a'])).size).toBe(0);
    const client = { from: vi.fn() };
    expect((await readCache(client, [])).size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('writeCache', () => {
  it('upserts on the cache key so a repeat refreshes rather than duplicating', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const written = await writeCache({ from: () => ({ upsert }) }, [toRow('x', null, null)]);

    expect(written).toBe(1);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'cache_key' });
  });

  it('is a no-op without a service-role client', async () => {
    // The table has no insert policy on purpose: a user able to write
    // coordinates everyone else then trusts is worse than paying for a lookup.
    expect(await writeCache(null, [toRow('x', null, null)])).toBe(0);
  });

  it('never lets a write failure surface to the caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = { from: () => ({ upsert: async () => ({ error: { message: 'nope' } }) }) };
    expect(await writeCache(client, [toRow('x', null, null)])).toBe(0);
    warn.mockRestore();
  });
});
