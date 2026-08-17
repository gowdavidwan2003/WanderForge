-- =====================================================
-- WanderForge — Close the UPDATE escalation holes (S0-6) and lock down
-- profiles.email (S0-7). Run in the Supabase SQL editor after 006.
--
-- Every UPDATE policy in migrations 001-006 was written with USING and no
-- WITH CHECK. Postgres then applies the USING expression to the *new* row as
-- well, so each read predicate was silently doubling as the write predicate.
-- Where a predicate can be satisfied by more than one identity, that let a row
-- be edited into a state the caller was never entitled to:
--
--   trips_update   USING (user_id = auth.uid() OR is_trip_editor(id, auth.uid()))
--                  An accepted editor PATCHes user_id to their own id. The old
--                  row passes via is_trip_editor, the new row passes via
--                  user_id = auth.uid(). The editor is now the owner, and the
--                  original owner — not being in trip_collaborators — fails
--                  trips_select and loses access to their own trip.
--
--   collab_update  USING (user_id = auth.uid() OR <owns the trip>)
--                  An invitee PATCHes their own row to role = 'editor' and
--                  accepted = true. Both old and new rows pass via
--                  user_id = auth.uid(). A viewer promotes itself to editor.
--
-- Two mechanisms are needed, because they answer different questions.
--
--   WITH CHECK  — "may the row look like this afterwards?" It cannot see OLD,
--                 so it cannot express "this column must not change". What it
--                 does do is stop a row being moved outside the caller's reach:
--                 without it, an editor on trip A could repoint a day, activity
--                 or expense at trip B.
--
--   BEFORE UPDATE trigger — sees OLD and NEW, so this is where column
--                 immutability belongs: trips.user_id, trip_collaborators.role,
--                 trip_templates.is_official, profiles.email.
--
-- The triggers skip enforcement when auth.uid() IS NULL, which is the
-- service-role path. That is safe because every policy here already requires a
-- matching auth.uid(), so an anonymous caller cannot reach the UPDATE at all.
-- =====================================================

-- -----------------------------------------------------
-- 0. Helpers
-- -----------------------------------------------------

-- Owner test that does not re-enter trips RLS (the recursion migration 003 was
-- written to fix).
CREATE OR REPLACE FUNCTION public.is_trip_owner(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = p_user_id);
$$;

-- -----------------------------------------------------
-- 1. PROFILES — own row only, and email is not user-writable (S0-7)
-- -----------------------------------------------------

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.profiles_guard_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / trigger-driven writes
  END IF;

  -- profiles.email is a denormalised copy of auth.users.email, written once by
  -- handle_new_user on signup. Leaving it user-writable meant an attacker could
  -- set it to a victim's address; the collaborator invite lookup resolves an
  -- invitee by this column, so the next invitation meant for that victim would
  -- have granted the attacker access to the trip instead.
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'profiles.email cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles.id cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_immutable ON public.profiles;
CREATE TRIGGER profiles_guard_immutable
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_immutable();

-- Emails must be unique for the invite lookup to be unambiguous. The lookup in
-- collaborators/route.js does .eq('email', ...).limit(1) with no ordering, so
-- duplicates made it return an arbitrary row.
--
-- Dedupe first. profiles.email is a copy of auth.users.email, so clearing a
-- duplicate loses nothing that cannot be re-synced from auth.users; the oldest
-- row for each address keeps its value.
DO $$
DECLARE
  cleared INT;
BEGIN
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY created_at, id) AS rn
    FROM public.profiles
    WHERE email IS NOT NULL
  )
  UPDATE public.profiles p
  SET email = NULL
  FROM ranked r
  WHERE p.id = r.id AND r.rn > 1;

  GET DIAGNOSTICS cleared = ROW_COUNT;
  IF cleared > 0 THEN
    RAISE NOTICE 'Cleared % duplicate profiles.email value(s); re-sync from auth.users if needed.', cleared;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

-- Row-level policies cannot protect a single column, so the "emails are
-- world-readable" half of S0-7 is a privilege problem, not a policy one. Rows
-- stay readable — the collaborator list and expense split need display_name for
-- other users — but the email column is withdrawn from client roles entirely.
-- The invite lookup already runs through the service role.
REVOKE SELECT (email) ON public.profiles FROM anon;
REVOKE SELECT (email) ON public.profiles FROM authenticated;
GRANT SELECT (email) ON public.profiles TO service_role;

-- -----------------------------------------------------
-- 2. TRIPS — ownership cannot be seized by an editor
-- -----------------------------------------------------

DROP POLICY IF EXISTS "trips_update" ON public.trips;
CREATE POLICY "trips_update" ON public.trips
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_trip_editor(id, auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_trip_editor(id, auth.uid())
  );

CREATE OR REPLACE FUNCTION public.trips_guard_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only the current owner may hand a trip over. Without this an editor could
  -- set user_id to themselves and lock the real owner out.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND OLD.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the trip owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_guard_owner ON public.trips;
CREATE TRIGGER trips_guard_owner
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.trips_guard_owner();

-- -----------------------------------------------------
-- 3. TRIP COLLABORATORS — an invitee may accept, not promote
-- -----------------------------------------------------

DROP POLICY IF EXISTS "collab_update" ON public.trip_collaborators;
CREATE POLICY "collab_update" ON public.trip_collaborators
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_trip_owner(trip_id, auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_trip_owner(trip_id, auth.uid())
  );

CREATE OR REPLACE FUNCTION public.collab_guard_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- The invitee's legitimate action is flipping `accepted` on their own row.
  -- Everything identifying — which trip, which user, what role — is the trip
  -- owner's to set.
  IF NOT public.is_trip_owner(OLD.trip_id, auth.uid()) THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only the trip owner can change a collaborator role'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.trip_id IS DISTINCT FROM OLD.trip_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'An invitation cannot be reassigned'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collab_guard_role ON public.trip_collaborators;
CREATE TRIGGER collab_guard_role
  BEFORE UPDATE ON public.trip_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.collab_guard_role();

-- -----------------------------------------------------
-- 4. Remaining UPDATE policies: mirror each USING into WITH CHECK so a row
--    cannot be edited out of the caller's own scope.
-- -----------------------------------------------------

-- TRIP DAYS. Without WITH CHECK an editor on one trip could repoint a day at
-- another trip they also edit.
DROP POLICY IF EXISTS "days_update" ON public.trip_days;
CREATE POLICY "days_update" ON public.trip_days
  FOR UPDATE
  USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  )
  WITH CHECK (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  );

-- ACTIVITIES. Mirrors 006, including the itinerary lock: the new row must also
-- land on an unlocked day, otherwise an activity could be moved onto a frozen
-- day the caller cannot otherwise touch.
DROP POLICY IF EXISTS "activities_update" ON public.activities;
CREATE POLICY "activities_update" ON public.activities
  FOR UPDATE
  USING (
    NOT public.is_day_locked(trip_day_id)
    AND (
      trip_day_id IN (
        SELECT td.id FROM public.trip_days td
        JOIN public.trips t ON td.trip_id = t.id
        WHERE t.user_id = auth.uid()
      )
      OR trip_day_id IN (
        SELECT td.id FROM public.trip_days td
        WHERE public.is_trip_editor(td.trip_id, auth.uid())
      )
    )
  )
  WITH CHECK (
    NOT public.is_day_locked(trip_day_id)
    AND (
      trip_day_id IN (
        SELECT td.id FROM public.trip_days td
        JOIN public.trips t ON td.trip_id = t.id
        WHERE t.user_id = auth.uid()
      )
      OR trip_day_id IN (
        SELECT td.id FROM public.trip_days td
        WHERE public.is_trip_editor(td.trip_id, auth.uid())
      )
    )
  );

-- EXPENSES. Also the table behind the partial-share overcharge: `amount` was
-- PATCHable over REST with no UI involved, which is how a stale split became
-- reachable at all.
DROP POLICY IF EXISTS "expenses_update" ON public.trip_expenses;
CREATE POLICY "expenses_update" ON public.trip_expenses
  FOR UPDATE
  USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  )
  WITH CHECK (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  );

-- ACCOMMODATIONS and TRANSPORT are FOR ALL, so the missing WITH CHECK covered
-- INSERT as well as UPDATE.
DROP POLICY IF EXISTS "accommodations_all" ON public.accommodations;
CREATE POLICY "accommodations_all" ON public.accommodations
  FOR ALL
  USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  )
  WITH CHECK (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  );

DROP POLICY IF EXISTS "transport_all" ON public.transport_bookings;
CREATE POLICY "transport_all" ON public.transport_bookings
  FOR ALL
  USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  )
  WITH CHECK (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_editor(trip_id, auth.uid())
  );

-- REVIEWS. Without WITH CHECK a review could be reassigned to another user.
DROP POLICY IF EXISTS "Users can update own reviews" ON public.reviews;
CREATE POLICY "reviews_update" ON public.reviews
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- USER API KEYS. FOR ALL, so this also constrains INSERT: a key row cannot be
-- written or moved under another user's id.
DROP POLICY IF EXISTS "Users can manage own API keys" ON public.user_api_keys;
CREATE POLICY "user_api_keys_all" ON public.user_api_keys
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- TRIP TEMPLATES. `is_official` is a trust marker, so it must not be
-- self-assignable by the template's creator.
DROP POLICY IF EXISTS "Creators can update templates" ON public.trip_templates;
CREATE POLICY "trip_templates_update" ON public.trip_templates
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE OR REPLACE FUNCTION public.templates_guard_official()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_official IS DISTINCT FROM OLD.is_official THEN
    RAISE EXCEPTION 'trip_templates.is_official cannot be set by users'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS templates_guard_official ON public.trip_templates;
CREATE TRIGGER templates_guard_official
  BEFORE UPDATE ON public.trip_templates
  FOR EACH ROW EXECUTE FUNCTION public.templates_guard_official();

-- -----------------------------------------------------
-- 5. Fail loudly if any UPDATE-capable policy still lacks a WITH CHECK.
--    pg_policies.with_check is NULL when the clause is absent, which is exactly
--    the state that made all of the above exploitable.
-- -----------------------------------------------------
DO $$
DECLARE
  gap TEXT;
BEGIN
  SELECT string_agg(schemaname || '.' || tablename || '.' || policyname, ', ')
  INTO gap
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd IN ('UPDATE', 'ALL')
    AND with_check IS NULL;

  IF gap IS NOT NULL THEN
    RAISE EXCEPTION 'UPDATE/ALL policies still missing WITH CHECK: %', gap;
  END IF;

  RAISE NOTICE 'All UPDATE/ALL policies in public now carry a WITH CHECK clause.';
END $$;
