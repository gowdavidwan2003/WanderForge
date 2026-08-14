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
 * @returns {{ok: true, data: object, keyIndex: number}
 *          |{ok: false, status: number, error: string, exhausted?: boolean}}
 */
export async function groqChatCompletion(body, { userApiKey } = {}) {
  const keys = groqKeys(userApiKey);

  if (keys.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No API key available. Add your own Groq key in Settings.',
    };
  }

  let lastRateLimitError = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let res;

    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network failure: worth trying the next key rather than giving up.
      lastRateLimitError = err.message;
      continue;
    }

    if (res.ok) {
      if (i > 0) {
        console.info(`[WanderForge] Groq key ${maskKey(key)} used after ${i} rate-limited key(s).`);
      }
      return { ok: true, data: await res.json(), keyIndex: i };
    }

    const payload = await res.json().catch(() => ({}));

    if (isRateLimited(res.status, payload)) {
      console.warn(
        `[WanderForge] Groq key ${maskKey(key)} rate-limited (${i + 1}/${keys.length}), trying next.`
      );
      lastRateLimitError = payload?.error?.message || 'Rate limit reached';
      continue;
    }

    return {
      ok: false,
      status: res.status,
      error: payload?.error?.message || `Groq API error: ${res.status}`,
    };
  }

  return {
    ok: false,
    status: 429,
    exhausted: true,
    error: `All ${keys.length} Groq keys have hit their rate limit. ${lastRateLimitError || ''}`.trim(),
  };
}
