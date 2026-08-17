-- =====================================================
-- Structural coverage check for migration 007. Read-only; safe to run anytime.
--
-- 007_verify_update_policies.sql proves the behaviour, but only on the four
-- tables it builds fixtures for (trips, trip_collaborators, profiles,
-- trip_templates). This covers the rest by asserting the invariant the migration
-- establishes across every UPDATE-capable policy in public:
--
--   1. with_check IS NOT NULL — the absence of this clause is the whole bug.
--      Postgres reuses USING for the new row when it is missing, which is how a
--      read predicate became a write predicate.
--
--   2. with_check = qual — 007 mirrors each USING into WITH CHECK, so a row
--      cannot be edited into a state its own policy would not have let the
--      caller read. If these ever diverge it should be a deliberate, commented
--      decision, not a drift.
--
-- Column immutability (trips.user_id, trip_collaborators.role,
-- trip_templates.is_official, profiles.email) is NOT visible here — RLS cannot
-- express it, so it lives in BEFORE UPDATE triggers, checked separately below.
-- =====================================================

-- ---------- 1. Per-policy report ----------
SELECT
  tablename,
  policyname,
  cmd,
  CASE
    WHEN with_check IS NULL              THEN 'FAIL - no WITH CHECK'
    WHEN with_check = qual               THEN 'ok - mirrors USING'
    WHEN qual IS NULL                    THEN 'ok - insert-only policy'
    ELSE                                      'REVIEW - differs from USING'
  END AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('UPDATE', 'ALL')
ORDER BY
  CASE WHEN with_check IS NULL THEN 0 WHEN with_check <> qual THEN 1 ELSE 2 END,
  tablename, policyname;

-- ---------- 2. Hard assertions ----------
DO $$
DECLARE
  missing   TEXT;
  divergent TEXT;
  absent    TEXT;
  n_pol     INT;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', '), count(*)
  INTO missing, n_pol
  FROM pg_policies
  WHERE schemaname = 'public' AND cmd IN ('UPDATE', 'ALL') AND with_check IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Policies still missing WITH CHECK: %', missing;
  END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ')
  INTO divergent
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd IN ('UPDATE', 'ALL')
    AND qual IS NOT NULL
    AND with_check <> qual;

  IF divergent IS NOT NULL THEN
    RAISE WARNING 'WITH CHECK differs from USING (review each): %', divergent;
  END IF;

  -- The four immutability guards that RLS cannot express.
  SELECT string_agg(t.name, ', ')
  INTO absent
  FROM (VALUES
    ('trips_guard_owner'),
    ('collab_guard_role'),
    ('profiles_guard_immutable'),
    ('templates_guard_official')
  ) AS t(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = t.name AND NOT tgisinternal
  );

  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'Immutability triggers missing: %', absent;
  END IF;

  -- The S0-7 column privilege must not have been granted back.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'email'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type = 'SELECT'
  ) THEN
    RAISE WARNING 'profiles.email is readable by a client role — the stopgap GRANT is still in place.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'profiles_email_unique'
  ) THEN
    RAISE EXCEPTION 'profiles_email_unique index is missing.';
  END IF;

  RAISE NOTICE 'Coverage OK: % UPDATE/ALL policies all carry WITH CHECK; 4 immutability triggers present; profiles.email locked.',
    (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND cmd IN ('UPDATE','ALL'));
END $$;
