import * as Sentry from '@sentry/nextjs';

/**
 * Browser-side error reporting.
 *
 * The DSN is public by design — it identifies the project to send to and grants
 * nothing. It is still gated so a checkout without one sends nothing at all.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,

  // Noise that is not ours: a browser extension throwing inside our page, or a
  // network blip on a fetch we already handle.
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
    'AbortError',            // a cancelled generation is a choice, not a fault
    'Failed to fetch',
    'NetworkError',
  ],
});
