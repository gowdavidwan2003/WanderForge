import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Reject an API request that has no signed-in user.
 *
 * Every route under src/app/api was reachable anonymously. The proxy in
 * src/proxy.js only guards page paths (/dashboard, /trip, /profile/settings),
 * so it never covered /api at all. That mattered because these routes spend
 * money on the operator's behalf, not the caller's:
 *
 *   /api/geocode      one billed Google Places Text Search per call, and the
 *                     trip editor fans out one call per activity
 *   /api/places       Google Places fallback when Overpass is empty
 *   /api/route-matrix one billed Google Routes call per leg, up to 24
 *   /api/ai/*         Groq tokens against a shared daily quota
 *
 * A shell loop against any of them billed the account with no user to attribute
 * it to, no counter to alarm on, and nothing to rate-limit against. Requiring a
 * session does not by itself cap spend — it makes spend attributable, which is
 * the precondition for capping it.
 *
 * Usage:
 *   const auth = await requireUser();
 *   if (auth.error) return auth.error;
 *   // auth.user is available from here
 *
 * @returns {Promise<{user: object} | {error: NextResponse}>}
 */
export async function requireUser() {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return {
        error: NextResponse.json(
          { error: 'You must be signed in to use this feature.' },
          { status: 401 }
        ),
      };
    }

    return { user: data.user };
  } catch (err) {
    // A failure to even reach Supabase Auth must not read as "authorised".
    console.error('[WanderForge] Auth check failed:', err?.message || err);
    return {
      error: NextResponse.json(
        { error: 'Could not verify your session. Please sign in again.' },
        { status: 401 }
      ),
    };
  }
}
