import * as Sentry from '@sentry/nextjs';

// The proxy in src/proxy.js runs on the edge runtime, which is a separate
// environment from the server config above and needs its own init.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
