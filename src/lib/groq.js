/**
 * Groq client with automatic key rotation.
 *
 * A single free-tier key is capped at 100,000 tokens per day and 12,000 per
 * minute, and whole-trip replanning burns through that quickly. Several keys are
 * tried in order so hitting a limit on one falls through to the next instead of
 * failing the user's request.
 *
 * Server-side only — these are secret keys and must never reach the browser.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Time budget, in milliseconds.
 *
 * The routes declare `maxDuration = 60`, so everything here has to finish inside
 * that or the platform kills the invocation and the caller gets an opaque 504
 * with no error body. Rotation made that worse rather than better: four keys
 * each waiting indefinitely on a bare fetch could sit far past any ceiling, and
 * because the catch blocks never logged, a timeout was indistinguishable from a
 * Groq outage or a bad prompt.
 *
 * TOTAL leaves headroom under 60s for the caller's own work — replan-trip issues
 * a second corrective completion, and the trip editor geocodes afterwards.
 * PER_ATTEMPT bounds one key so a single stall cannot consume the whole budget.
 */
export const TOTAL_BUDGET_MS = 45_000;
export const PER_ATTEMPT_MS = 20_000;

/**
 * How long the next key may take, given how long has already elapsed.
 *
 * Exported so the guarantee can be tested directly: however many keys rotation
 * has to try, their timeouts must sum to no more than TOTAL_BUDGET_MS, because
 * overshooting it means the platform kills the invocation and the caller gets a
 * 504 with no body instead of an error we chose.
 *
 * @returns milliseconds, or <= 0 when the budget is spent
 */
export function attemptBudgetMs(elapsedMs, total = TOTAL_BUDGET_MS, perAttempt = PER_ATTEMPT_MS) {
  return Math.min(perAttempt, total - elapsedMs);
}

/** Keys to try, in order. A user's own BYOK key always goes first. */
export function groqKeys(userApiKey) {
  return [
    userApiKey,
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ].filter(Boolean);
}

/** Never log a whole key — enough to identify which one, nothing more. */
const maskKey = (key) => (key ? `…${String(key).slice(-4)}` : 'none');

function isRateLimited(status, payload) {
  if (status === 429) return true;
  const code = payload?.error?.code || '';
  const message = payload?.error?.message || '';
  return code === 'rate_limit_exceeded' || /rate limit/i.test(message);
}

/**
 * POST a chat-completion request, rotating keys on rate-limit responses.
 *
 * Only rate limits trigger rotation. A malformed request or auth failure is
 * returned immediately, because retrying it on another key would fail identically
 * while burning quota.
 *
 * @param userApiKey the caller's own BYOK key, tried first
 * @param budgetMs   total wall clock for this call including rotation. Defaults
 *                   to TOTAL_BUDGET_MS, which assumes the route makes one
 *                   completion. The generate route makes up to three — a
 *                   validation retry and a conflict re-prompt — so it passes a
 *                   shrinking slice of its own budget and each call stays inside
 *                   the route's maxDuration rather than each assuming it owns it.
 * @returns {{ok: true, data: object, keyIndex: number}
 *          |{ok: false, status: number, error: string, exhausted?: boolean}}
 */
export async function groqChatCompletion(body, { userApiKey, budgetMs = TOTAL_BUDGET_MS } = {}) {
  const keys = groqKeys(userApiKey);

  if (keys.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No API key available. Add your own Groq key in Settings.',
    };
  }

  // Tracked apart so the final message can say which actually happened. Folding
  // both into one variable meant a DNS failure or a dropped connection was
  // reported as "all keys have hit their rate limit", sending the user off to
  // find another API key for a problem that had nothing to do with quota.
  let lastRateLimitError = null;
  let lastTransportError = null;
  const startedAt = Date.now();

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    // Budget across rotation, not per attempt: without this, four keys each
    // allowed their own timeout could outlast the route's maxDuration and the
    // platform would kill the invocation mid-flight.
    const slice = attemptBudgetMs(Date.now() - startedAt, budgetMs);
    if (slice <= 0) {
      console.warn(
        `[WanderForge] Groq budget of ${budgetMs}ms exhausted after ${i} attempt(s); not trying the remaining ${keys.length - i} key(s).`
      );
      return {
        ok: false,
        status: 504,
        timedOut: true,
        error: 'The AI provider did not respond in time. Please try again.',
      };
    }

    let res;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), slice);

    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // An abort is a stall, not a transport fault, and is worth saying so: a
      // hung connection used to pin the invocation until the platform killed it,
      // producing a 504 with no body and nothing in the logs.
      const stalled = err?.name === 'AbortError';
      console.warn(
        `[WanderForge] Groq key ${maskKey(key)} ${stalled ? `stalled after ${slice}ms` : `failed: ${err?.message}`} (${i + 1}/${keys.length}).`
      );
      lastTransportError = stalled
        ? `No response within ${Math.round(slice / 1000)}s`
        : err?.message || 'Network error';
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      if (i > 0) {
        console.info(`[WanderForge] Groq key ${maskKey(key)} used after ${i} rate-limited key(s).`);
      }
      return { ok: true, data: await res.json(), keyIndex: i };
    }

    const payload = await res.json().catch(() => ({}));

    // Checked before isRateLimited, which also matches this message and would
    // otherwise rotate through every key and report generic exhaustion.
    //
    // 413 is a reservation rejection, not a malformed request: Groq counts
    // prompt + max_completion_tokens against the organisation's tokens-per-minute
    // allowance and refuses up front. Rotating does not help — the limit is per
    // organisation, not per key — and Groq's own wording ("Request too large...
    // please reduce your message size") points at the prompt, when the cause is
    // the requested completion budget.
    if (res.status === 413) {
      console.warn(
        `[WanderForge] Groq refused the token reservation on key ${maskKey(key)}: ${payload?.error?.message || '413'}`
      );
      return {
        ok: false,
        status: 429,
        throttled: true,
        error: 'The AI provider is at its per-minute token limit. Wait a moment and try again, or plan fewer days at once.',
      };
    }

    if (isRateLimited(res.status, payload)) {
      console.warn(
        `[WanderForge] Groq key ${maskKey(key)} rate-limited (${i + 1}/${keys.length}), trying next.`
      );
      lastRateLimitError = payload?.error?.message || 'Rate limit reached';
      continue;
    }

    // Not a rate limit, so rotation will not help. Log before returning: these
    // are the failures that used to vanish, leaving a timeout, an outage and a
    // malformed request indistinguishable from one another.
    console.error(
      `[WanderForge] Groq request failed with ${res.status} on key ${maskKey(key)}: ${payload?.error?.message || 'no message'}`
    );

    return {
      ok: false,
      status: res.status,
      error: payload?.error?.message || `Groq API error: ${res.status}`,
    };
  }

  // Report what actually went wrong. Quota exhaustion means wait or add a key;
  // a transport failure means try again. Saying "rate limit" for both sent people
  // looking for the wrong fix.
  if (lastRateLimitError && !lastTransportError) {
    console.error(`[WanderForge] All ${keys.length} Groq key(s) rate-limited. ${lastRateLimitError}`);
    return {
      ok: false,
      status: 429,
      exhausted: true,
      error: `All ${keys.length} Groq key${keys.length === 1 ? '' : 's'} have hit their rate limit. ${lastRateLimitError}`.trim(),
    };
  }

  if (lastTransportError && !lastRateLimitError) {
    console.error(`[WanderForge] Could not reach Groq on any key. ${lastTransportError}`);
    return {
      ok: false,
      status: 503,
      unreachable: true,
      error: `Could not reach the AI provider: ${lastTransportError}. Please try again.`,
    };
  }

  console.error(
    `[WanderForge] All ${keys.length} Groq key(s) failed. Rate limit: ${lastRateLimitError || 'none'}; transport: ${lastTransportError || 'none'}`
  );
  return {
    ok: false,
    status: 503,
    exhausted: Boolean(lastRateLimitError),
    unreachable: Boolean(lastTransportError),
    error: `The AI provider could not be used. ${[lastRateLimitError, lastTransportError].filter(Boolean).join('; ')}`.trim(),
  };
}

/**
 * The same request, streamed.
 *
 * Returns the raw response body so the caller can read deltas as they arrive.
 * Generation takes 15-40 seconds and used to show nothing until it was over;
 * streaming is the one thing Groq is genuinely fastest at, and the first day of
 * an itinerary lands in a couple of seconds.
 *
 * Key rotation works the same way, with one difference that matters: a stream
 * can fail *after* the response headers say 200 — the connection drops
 * mid-itinerary. Rotation cannot help there, because the caller has already
 * begun rendering, so this only rotates on failures visible before the first
 * byte of the body.
 *
 * @param signal aborts the upstream request when the browser goes away, so a
 *               cancelled generation stops being billed rather than running to
 *               completion into a socket nobody is reading.
 * @returns {{ok: true, body: ReadableStream, keyIndex: number}
 *          |{ok: false, status: number, error: string}}
 */
export async function groqChatCompletionStream(
  body,
  { userApiKey, budgetMs = TOTAL_BUDGET_MS, signal } = {}
) {
  const keys = groqKeys(userApiKey);

  if (keys.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No API key available. Add your own Groq key in Settings.',
    };
  }

  let lastRateLimitError = null;
  let lastTransportError = null;
  const startedAt = Date.now();

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    const slice = attemptBudgetMs(Date.now() - startedAt, budgetMs);
    if (slice <= 0) {
      return {
        ok: false,
        status: 504,
        timedOut: true,
        error: 'The AI provider did not respond in time. Please try again.',
      };
    }

    let res;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...body, stream: true }),
        // No AbortController timeout on the whole request: that ceiling belongs
        // to the *first byte*, and a stream legitimately stays open for far
        // longer than any single completion would. The caller's signal is what
        // ends it early.
        signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { ok: false, status: 499, aborted: true, error: 'Generation cancelled.' };
      }
      console.warn(
        `[WanderForge] Groq stream key ${maskKey(key)} failed: ${err?.message} (${i + 1}/${keys.length}).`
      );
      lastTransportError = err?.message || 'Network error';
      continue;
    }

    if (res.ok && res.body) {
      if (i > 0) {
        console.info(`[WanderForge] Groq stream key ${maskKey(key)} used after ${i} rate-limited key(s).`);
      }
      return { ok: true, body: res.body, keyIndex: i };
    }

    const payload = await res.json().catch(() => ({}));

    if (isRateLimited(res.status, payload)) {
      console.warn(
        `[WanderForge] Groq stream key ${maskKey(key)} rate-limited (${i + 1}/${keys.length}), trying next.`
      );
      lastRateLimitError = payload?.error?.message || 'Rate limit reached';
      continue;
    }

    console.error(
      `[WanderForge] Groq stream failed with ${res.status} on key ${maskKey(key)}: ${payload?.error?.message || 'no message'}`
    );
    return {
      ok: false,
      status: res.status,
      error: payload?.error?.message || `Groq API error: ${res.status}`,
    };
  }

  return {
    ok: false,
    status: lastRateLimitError ? 429 : 503,
    exhausted: Boolean(lastRateLimitError),
    error: lastRateLimitError
      ? `All ${keys.length} Groq key${keys.length === 1 ? '' : 's'} have hit their rate limit. ${lastRateLimitError}`.trim()
      : `Could not reach the AI provider: ${lastTransportError}. Please try again.`,
  };
}
