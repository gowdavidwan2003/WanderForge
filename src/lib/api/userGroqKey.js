import { getSupabaseServerClient } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/serverCrypto';

/**
 * The signed-in user's own Groq key, if they have saved one.
 *
 * Two problems solved at once.
 *
 * SECURITY. Every AI route accepted `userApiKey` from the request body — so the
 * browser would have had to hold the raw key to send it, and any client could
 * send any string and have the server bill it. No client ever did send it, which
 * meant the whole BYOK feature was decorative: keys were collected, stored in
 * plaintext, and never used for anything. The key is now looked up and decrypted
 * server-side from the session, and the request body is not consulted at all.
 *
 * CAPACITY. Groq meters tokens per ORGANISATION, not per key — the 429 says so
 * explicitly: "Rate limit reached ... in organization org_...". On the free tier
 * that is 8,000 tokens a minute, and a five-day generation reserves most of it,
 * so the operator's account supports roughly one generation at a time however
 * many keys are rotated into it. A user's own key belongs to a different
 * organisation with its own allowance, so every user who brings one stops
 * competing for the shared pool. It is the only way to add capacity that does
 * not involve buying it.
 *
 * Never throws: a missing, unreadable or undecryptable key means "fall back to
 * the operator's keys", which is what groqKeys() already does with undefined.
 */
export async function getUserGroqKey() {
  try {
    const supabase = await getSupabaseServerClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return undefined;

    const { data, error } = await supabase
      .from('user_api_keys')
      .select('encrypted_key')
      .eq('user_id', user.id)
      .eq('provider', 'groq')
      .maybeSingle();

    if (error || !data?.encrypted_key) return undefined;

    // Null when the row predates encryption, or was written under a different
    // ENCRYPTION_SECRET. Both mean the user must save the key again; neither is
    // worth failing a generation over.
    return decryptSecret(data.encrypted_key) ?? undefined;
  } catch (err) {
    console.warn('[WanderForge] Could not read the user API key:', err.message);
    return undefined;
  }
}
