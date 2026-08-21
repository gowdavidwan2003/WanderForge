import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The two clients the geocode cache needs.
 *
 * Reads go through the request-scoped client, so they obey the table's RLS
 * policy (any signed-in user may read; entries are public place data and sharing
 * them across users is the whole point).
 *
 * Writes need the service role, because the table deliberately has no insert
 * policy: a user able to write coordinates that every other user then trusts is
 * a worse outcome than paying Google for a lookup. Without SUPABASE_SERVICE_ROLE_KEY
 * the cache is read-only — still useful, just never populated by this deployment.
 */
export async function getGeocodeCacheClients() {
  const supabase = await getSupabaseServerClient();
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? await getSupabaseAdminClient() : null;

  if (!admin) {
    console.warn(
      '[WanderForge] SUPABASE_SERVICE_ROLE_KEY is not set, so geocode results cannot be cached. Every lookup will be billed.'
    );
  }

  return { supabase, admin };
}
