import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Landing point for the confirmation link in Supabase's signup email.
 *
 * Supabase verifies the emailed token on its own domain, then bounces the user
 * here with a `code` to exchange for a session. The PKCE verifier lives in a
 * cookie set in the browser that started the signup, so the exchange only
 * succeeds in that same browser.
 */

/**
 * Only same-site paths may be redirected to. `next` arrives from the query
 * string, so without this an attacker could craft a confirmation URL that
 * forwards to their own site. A leading `//` is rejected because the browser
 * reads it as a protocol-relative absolute URL.
 */
function safeNextPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  // Behind Vercel's load balancer `origin` can carry the internal deployment
  // host rather than the domain the user is actually on, which would bounce
  // them onto a URL their session cookie was not set for.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const isLocal = process.env.NODE_ENV === 'development';
  const base = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin;

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }

    console.error('[WanderForge] Auth callback exchange failed:', error.message);
  }

  return NextResponse.redirect(`${base}/auth/login?error=auth_callback_error`);
}
