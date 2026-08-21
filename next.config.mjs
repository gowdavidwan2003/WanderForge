import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
};

/**
 * Sentry wraps the build to upload source maps, so a stack trace points at
 * `conflictChecker.js:213` rather than at a minified bundle.
 *
 * The upload needs SENTRY_AUTH_TOKEN, which only the deploy environment has —
 * without it the wrapper is a no-op and the build behaves exactly as before.
 * That matters for CI, which builds with fake credentials and no Sentry account,
 * and for anyone who clones this repo.
 */
const sentryOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Nothing to say during a build that is not uploading anything.
  silent: !process.env.CI,

  // Source maps are uploaded to Sentry and then deleted from the bundle, so the
  // traces are readable to us and the source is not served to the public.
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Routes browser reports through our own domain, so an ad blocker does not
  // silently swallow exactly the errors we most want to see.
  tunnelRoute: '/monitoring',

  disableLogger: true,
};

export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, sentryOptions)
  : nextConfig;
