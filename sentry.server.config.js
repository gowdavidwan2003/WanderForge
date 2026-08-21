import * as Sentry from '@sentry/nextjs';

/**
 * Server-side error reporting.
 *
 * Inert without SENTRY_DSN: a fork or a local checkout needs no account, and
 * `enabled: false` means the SDK installs no hooks rather than collecting events
 * and dropping them.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),

  // 10% of transactions. Errors are always sent; this is only performance
  // sampling, and the free tier is easy to exhaust with it at 100%.
  tracesSampleRate: 0.1,

  // Never record the request body. The AI routes carry the traveler's own words
  // — their notes, their destination — and an error report is not a reason to
  // copy that to a third party. See scrub() in src/lib/observability.js.
  sendDefaultPii: false,

  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      if (event.request.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
    }
    return event;
  },
});
