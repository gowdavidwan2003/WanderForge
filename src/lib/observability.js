import * as Sentry from '@sentry/nextjs';

/**
 * Error reporting, and the rules about what may leave the building.
 *
 * The problem this solves: when a generation failed for a real user, the whole
 * record of it was `console.error` on a serverless function nobody reads. The
 * user saw a toast and left, and we never found out. Several of the most
 * important failure paths in this app are deliberately silent — the geocode
 * cache falling back, a road leg timing out, a user's API key failing to decrypt
 * — because none of them should break a generation. Silent to the user is
 * correct. Silent to us is how a broken deploy runs for a week.
 *
 * Everything here is a no-op when SENTRY_DSN is unset, so a fork or a local
 * checkout needs no account and no configuration.
 */

/** Enabled only when a DSN is configured. */
export const observabilityEnabled = () =>
  Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);

/**
 * Fields that must never leave this application.
 *
 * Prompts carry the traveler's own words — their notes to the planner, their
 * destination, the places they are going. An error report is not a reason to
 * copy any of that to a third party, and the privacy policy does not list an
 * error tracker as a processor of it. Titles and messages are enough to debug
 * with; the payload is not.
 */
const REDACT = [
  'userApiKey', 'encrypted_key', 'key', 'password', 'token', 'authorization',
  'notes', 'messages', 'content', 'prompt', 'itinerary', 'activities',
  'email', 'display_name',
];

/** Recursively strip anything named above, whatever the shape. */
export function scrub(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT.includes(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

/**
 * Report a failure that the user was deliberately shielded from.
 *
 * `where` is a short stable string — 'ai/generate', 'geocode-cache-read' — so
 * the same failure groups across deploys rather than fragmenting by message.
 *
 * Never throws. An error reporter that can fail a request is worse than no error
 * reporter, and every call site here is already inside a catch.
 */
export function reportError(error, where, context = {}) {
  // Keeps the local signal even without a DSN, which is how this behaved before.
  console.error(`[WanderForge] ${where}:`, error?.message || error);

  if (!observabilityEnabled()) return;

  try {
    Sentry.captureException(error, {
      tags: { where },
      extra: scrub(context),
    });
  } catch {
    // Reporting the failure to report the failure is not a road worth going down.
  }
}

/**
 * Note something that is not an error but is worth knowing.
 *
 * The degraded paths, mostly: a cache that could not be read, a leg that could
 * not be measured, a key that would not decrypt. Each is handled correctly and
 * each means the product is quietly working less well than it should.
 */
export function reportWarning(message, where, context = {}) {
  console.warn(`[WanderForge] ${where}: ${message}`);

  if (!observabilityEnabled()) return;

  try {
    Sentry.captureMessage(message, {
      level: 'warning',
      tags: { where },
      extra: scrub(context),
    });
  } catch { /* as above */ }
}
