/**
 * Canonical origin for links Supabase emails back to the user.
 *
 * `window.location.origin` is the wrong source for a confirmation link: whatever
 * host the signup form happened to be served from gets baked into the email, so
 * a signup started against a dev server mails out a localhost link that is dead
 * for everyone but that machine. Prefer an explicitly configured origin, fall
 * back to the per-deployment URL Vercel injects, and only then to the current
 * page.
 *
 * Whatever this returns must also be present in the Supabase dashboard under
 * Authentication → URL Configuration → Redirect URLs. GoTrue silently replaces a
 * non-allowlisted `redirect_to` with the project's Site URL instead of erroring.
 */

const stripTrailingSlash = (url) => url.replace(/\/+$/, '');

export function getSiteOrigin() {
  // Set this in Vercel to the production domain.
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return stripTrailingSlash(configured);

  // Provided automatically on Vercel when system environment variables are
  // exposed (the default for Next.js projects). Carries no protocol, and is
  // unique per deployment, so preview builds confirm against themselves rather
  // than bouncing users into production.
  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;

  if (typeof window !== 'undefined') return window.location.origin;

  return 'http://localhost:3000';
}

/** Absolute URL Supabase should send a freshly confirmed user back to. */
export function getAuthCallbackUrl() {
  return `${getSiteOrigin()}/auth/callback`;
}
