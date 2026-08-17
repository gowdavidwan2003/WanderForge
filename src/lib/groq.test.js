import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PER_ATTEMPT_MS,
  TOTAL_BUDGET_MS,
  attemptBudgetMs,
  groqChatCompletion,
  groqKeys,
} from './groq.js';

describe('attemptBudgetMs', () => {
  it('allows a full slice at the start', () => {
    expect(attemptBudgetMs(0)).toBe(PER_ATTEMPT_MS);
  });

  it('shrinks the last attempt to whatever budget is left', () => {
    expect(attemptBudgetMs(TOTAL_BUDGET_MS - 5_000)).toBe(5_000);
  });

  it('goes non-positive once the budget is spent', () => {
    expect(attemptBudgetMs(TOTAL_BUDGET_MS)).toBe(0);
    expect(attemptBudgetMs(TOTAL_BUDGET_MS + 1_000)).toBeLessThan(0);
  });

  // The guarantee the routes' maxDuration depends on: rotation across any number
  // of keys cannot outlast the total, so the platform never kills us mid-flight.
  it('never lets four sequential attempts exceed the total budget', () => {
    let elapsed = 0;
    let attempts = 0;
    while (attemptBudgetMs(elapsed) > 0 && attempts < 100) {
      elapsed += attemptBudgetMs(elapsed);
      attempts++;
    }
    expect(elapsed).toBeLessThanOrEqual(TOTAL_BUDGET_MS);
    expect(attempts).toBeLessThan(100); // terminates
  });

  it('stays under the ceiling for an arbitrary key count', () => {
    for (const perAttempt of [1_000, 7_500, 20_000, 60_000]) {
      let elapsed = 0;
      while (attemptBudgetMs(elapsed, TOTAL_BUDGET_MS, perAttempt) > 0) {
        elapsed += attemptBudgetMs(elapsed, TOTAL_BUDGET_MS, perAttempt);
      }
      expect(elapsed).toBeLessThanOrEqual(TOTAL_BUDGET_MS);
    }
  });
});

describe('groqKeys', () => {
  it("puts the user's own key first so their quota is spent before ours", () => {
    const keys = groqKeys('user-key');
    expect(keys[0]).toBe('user-key');
  });

  it('drops absent keys rather than sending empty Authorization headers', () => {
    expect(groqKeys(undefined).every(Boolean)).toBe(true);
    expect(groqKeys(null).includes(null)).toBe(false);
  });
});

describe('groqChatCompletion', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key-1';
    delete process.env.GROQ_API_KEY_2;
    delete process.env.GROQ_API_KEY_3;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('reports a real message when there is no key at all', async () => {
    delete process.env.GROQ_API_KEY;
    const res = await groqChatCompletion({ model: 'x', messages: [] });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/No API key/i);
  });

  // The done-when for S0-9: a stall must surface a real error, not a bare 504
  // with no body. The stub aborts as soon as the signal fires, which is what a
  // hung connection looks like once AbortController is wired in.
  it('turns a stalled request into an explanatory error', async () => {
    global.fetch = vi.fn((url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
      // Never resolves otherwise — exactly the case that used to pin the
      // invocation until the platform killed it.
    }));

    const res = await groqChatCompletion(
      { model: 'x', messages: [] },
      { userApiKey: undefined }
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/^\s*$/);
    // Rotation ran out of keys, so it reports exhaustion with the stall reason.
    expect(res.error).toMatch(/no response within|rate limit/i);
  }, 60_000);

  it('passes an abort signal on every attempt', async () => {
    global.fetch = vi.fn(async (url, opts) => {
      expect(opts.signal).toBeDefined();
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
    });

    const res = await groqChatCompletion({ model: 'x', messages: [] });
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not rotate on a non-rate-limit error, and still explains itself', async () => {
    process.env.GROQ_API_KEY_2 = 'test-key-2';
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'bad request shape' } }),
    }));

    const res = await groqChatCompletion({ model: 'x', messages: [] });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toBe('bad request shape');
    // Retrying a malformed request on another key would only burn quota.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rotates to the next key on a rate limit', async () => {
    process.env.GROQ_API_KEY_2 = 'test-key-2';
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      if (call === 1) {
        return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limit' } }) };
      }
      return { ok: true, json: async () => ({ choices: [] }) };
    });

    const res = await groqChatCompletion({ model: 'x', messages: [] });
    expect(res.ok).toBe(true);
    expect(res.keyIndex).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
