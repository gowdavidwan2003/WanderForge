-- =====================================================
-- WanderForge — Encrypt stored API keys
-- Run this in Supabase SQL Editor after 012
-- =====================================================
--
-- `user_api_keys.encrypted_key` has never held an encrypted key. The column was
-- named for an intention nobody implemented:
--
--     encrypted_key: key, // In production, encrypt before storing
--
-- So every user who saved a Groq key handed this application a credential to
-- somebody else's paid account, in plaintext, readable by anyone with a database
-- backup or the service-role key. The privacy policy states these are stored
-- encrypted, which until this migration was untrue.
--
-- Encryption now happens in /api/keys before the row is written (see
-- src/lib/serverCrypto.js). Two things have to change in the database.

-- ============================================
-- 1. DESTROY THE PLAINTEXT
-- ============================================
-- These cannot be migrated. There is no safe way to encrypt them in place —
-- doing it here would require the secret inside a SQL statement, which lands it
-- in the query log and the migration history, and the values have already been
-- stored insecurely for their whole life. They are treated as compromised.
--
-- Rows are deleted rather than blanked, so the app shows "no key saved" and asks
-- for it again, rather than showing a key that will not work.
--
-- TELL AFFECTED USERS. A key that has sat in plaintext should be rotated at the
-- provider, not merely re-entered here. The count is reported below so you know
-- how many people that is.
DO $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM public.user_api_keys
  -- Anything not in the v1 envelope written by encryptSecret(). Runs safely more
  -- than once: after the first pass every surviving row is encrypted.
  WHERE encrypted_key IS NULL
     OR encrypted_key NOT LIKE 'v1.%.%.%';

  GET DIAGNOSTICS removed = ROW_COUNT;

  IF removed > 0 THEN
    RAISE WARNING
      'Deleted % plaintext API key(s). Those users must save their key again — and should rotate it at the provider, because it was stored unencrypted.',
      removed;
  ELSE
    RAISE NOTICE 'No plaintext API keys found.';
  END IF;
END;
$$;

-- ============================================
-- 2. A HINT THE CLIENT MAY SEE
-- ============================================
-- The profile page has to show *something*, or a user cannot tell whether a key
-- is saved. It previously round-tripped the key itself to do that. Last four
-- characters only: enough to recognise, useless to an interceptor.
ALTER TABLE public.user_api_keys
  ADD COLUMN IF NOT EXISTS key_hint TEXT;

COMMENT ON COLUMN public.user_api_keys.encrypted_key IS
  'AES-256-GCM, v1.<iv>.<tag>.<ciphertext> base64url. Written only by /api/keys. Never send this to a client.';
COMMENT ON COLUMN public.user_api_keys.key_hint IS
  'Last four characters, for display. The only part of the key a browser may receive.';

-- ============================================
-- 3. KEEP THE CIPHERTEXT AWAY FROM CLIENTS
-- ============================================
-- Defence in depth. The ciphertext is useless without ENCRYPTION_SECRET, but
-- there is no reason for a browser to hold it, and revoking the column stops a
-- future `select('*')` from quietly shipping it. The server routes use the
-- service role or a server client, which is unaffected by these grants.
REVOKE ALL ON public.user_api_keys FROM anon, authenticated;
GRANT SELECT (id, user_id, provider, key_hint, created_at) ON public.user_api_keys TO authenticated;

-- Writes go through /api/keys, which is where encryption happens. A client that
-- could INSERT directly could store a plaintext key again and recreate exactly
-- the problem this migration exists to end.
DROP POLICY IF EXISTS "Users manage own API keys" ON public.user_api_keys;
DROP POLICY IF EXISTS "api_keys_select" ON public.user_api_keys;
CREATE POLICY "api_keys_select" ON public.user_api_keys FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';
