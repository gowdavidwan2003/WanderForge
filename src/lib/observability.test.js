import { afterEach, describe, expect, it, vi } from 'vitest';

import { observabilityEnabled, reportError, reportWarning, scrub } from '@/lib/observability';

describe('scrub', () => {
  /**
   * The rule: an error report is not a reason to copy the traveler's own words
   * to a third party. The privacy policy does not list an error tracker as a
   * processor of trip content, and it should not have to.
   */
  it('redacts credentials', () => {
    const out = scrub({ userApiKey: 'gsk_real', encrypted_key: 'v1.a.b.c', token: 't' });
    expect(out.userApiKey).toBe('[redacted]');
    expect(out.encrypted_key).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
  });

  it('redacts the traveler’s own content', () => {
    const out = scrub({
      notes: 'traveling with my kids, avoid crowds',
      itinerary: [{ title: 'Mullayanagiri' }],
      messages: [{ role: 'user', content: 'plan me a trip' }],
      email: 'someone@example.com',
    });
    for (const k of ['notes', 'itinerary', 'messages', 'email']) {
      expect(out[k], k).toBe('[redacted]');
    }
  });

  it('keeps what is actually useful for debugging', () => {
    const out = scrub({ days: 5, where: 'ai/generate', status: 502, attempts: 2 });
    expect(out).toEqual({ days: 5, where: 'ai/generate', status: 502, attempts: 2 });
  });

  it('reaches into nested objects and arrays', () => {
    const out = scrub({ request: { body: { notes: 'secret' } }, list: [{ token: 'x' }] });
    expect(out.request.body.notes).toBe('[redacted]');
    expect(out.list[0].token).toBe('[redacted]');
  });

  it('does not recurse forever on a cyclic object', () => {
    // An error's `cause` chain can loop, and a reporter that hangs on one is
    // worse than no reporter.
    const cyclic = { name: 'a' };
    cyclic.self = cyclic;
    expect(() => scrub(cyclic)).not.toThrow();
  });

  it('passes primitives and absent values through', () => {
    expect(scrub(null)).toBeNull();
    expect(scrub(undefined)).toBeUndefined();
    expect(scrub('plain')).toBe('plain');
    expect(scrub(42)).toBe(42);
  });
});

describe('reporting', () => {
  const original = process.env.SENTRY_DSN;
  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original;
    vi.restoreAllMocks();
  });

  it('is off without a DSN, so a fork needs no account', () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(observabilityEnabled()).toBe(false);
  });

  it('still logs locally when it is off', () => {
    // The console signal is what existed before Sentry and must not regress.
    delete process.env.SENTRY_DSN;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError(new Error('boom'), 'ai/generate');
    expect(spy).toHaveBeenCalled();
  });

  it('never throws, whatever it is handed', () => {
    // Every call site is already inside a catch. A reporter that can fail a
    // request is worse than no reporter.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => reportError(null, 'x')).not.toThrow();
    expect(() => reportError('a string, not an Error', 'x')).not.toThrow();
    expect(() => reportWarning(undefined, 'x')).not.toThrow();
    err.mockRestore();
    warn.mockRestore();
  });
});
