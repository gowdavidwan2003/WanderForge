import { describe, expect, it } from 'vitest';

// Deliberately imported through the alias rather than a relative path. Vitest
// knows nothing about jsconfig.json, so before vitest.config.mjs existed this
// line failed to resolve and tests had to use relative paths while the code they
// tested used '@/'. If the alias regresses, this file stops collecting and the
// failure is obvious rather than mysterious.
import { MAX_TRIP_DAYS } from '@/lib/tripLimits';
import { sharesFor } from '@/lib/settlement';

describe('test harness', () => {
  it('runs assertions', () => {
    expect(1 + 1).toBe(2);
  });

  it('resolves the @/ alias to src/', () => {
    expect(MAX_TRIP_DAYS).toBe(30);
    expect(typeof sharesFor).toBe('function');
  });

  it('supports async tests', async () => {
    await expect(Promise.resolve('ok')).resolves.toBe('ok');
  });

  it('reports a rejected promise rather than passing silently', async () => {
    await expect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');
  });
});
