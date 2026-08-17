-- =====================================================
-- Verification for migration 007. Run in the Supabase SQL editor AFTER 007.
--
-- Replaces "manually verify with a second account" with something repeatable:
-- it impersonates two real users, attempts each escalation 007 is meant to
-- block, and raises if any of them succeeds.
--
-- HOW TO RUN
--   1. Get two user ids:  SELECT id, email FROM auth.users LIMIT 5;
--   2. Paste them into v_owner / v_editor below.
--   3. Run the whole file.
--
-- Everything runs inside a transaction that ROLLS BACK, so no fixture rows and
-- no role change survive. Nothing here touches your real trips.
--
-- NOTE: this script has not been executed — there is no local Postgres in the
-- environment it was written in. If a statement errors, the error is in the
-- script, not necessarily in migration 007; the DO block below is ordinary
-- PL/pgSQL and safe to adjust.
-- =====================================================

BEGIN;

DO $$
DECLARE
  -- >>> EDIT THESE TWO <<<
  v_owner  UUID := '00d06b02-2a47-4447-a6fb-931ac387d2d6';
  v_editor UUID := 'ecc505b3-eae8-4640-b98b-6a39adba3bcd';

  v_trip     UUID;
  v_collab   UUID;
  v_template UUID;
  v_failures TEXT[] := '{}';
BEGIN
  IF v_owner = '00000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Set v_owner and v_editor to real auth.users ids first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_editor) THEN
    RAISE EXCEPTION 'One or both ids are not in auth.users.';
  END IF;

  -- Fixture: owner's trip, with the other user invited as a VIEWER.
  INSERT INTO public.trips (user_id, title, destination)
  VALUES (v_owner, '007 verify trip', 'Nowhere')
  RETURNING id INTO v_trip;

  INSERT INTO public.trip_collaborators (trip_id, user_id, role, accepted)
  VALUES (v_trip, v_editor, 'viewer', true)
  RETURNING id INTO v_collab;

  INSERT INTO public.trip_templates (title, destination, duration_days, created_by, is_official)
  VALUES ('007 verify template', 'Nowhere', 1, v_editor, false)
  RETURNING id INTO v_template;

  -- Become the invited user, the way PostgREST presents a logged-in caller.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_editor::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- 1. A viewer promoting itself to editor. This was the live hole.
  BEGIN
    UPDATE public.trip_collaborators SET role = 'editor' WHERE id = v_collab;
    IF EXISTS (SELECT 1 FROM public.trip_collaborators WHERE id = v_collab AND role = 'editor') THEN
      v_failures := v_failures || 'FAIL: viewer promoted itself to editor';
    ELSE
      RAISE NOTICE 'PASS: viewer could not promote itself';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: viewer role change rejected — %', SQLERRM;
  END;

  -- 2. Seizing ownership of someone else's trip.
  BEGIN
    UPDATE public.trips SET user_id = v_editor WHERE id = v_trip;
    IF EXISTS (SELECT 1 FROM public.trips WHERE id = v_trip AND user_id = v_editor) THEN
      v_failures := v_failures || 'FAIL: collaborator seized trip ownership';
    ELSE
      RAISE NOTICE 'PASS: trips.user_id unchanged';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: ownership transfer rejected — %', SQLERRM;
  END;

  -- 3. Rewriting your own profiles.email (the invite-hijack vector).
  BEGIN
    UPDATE public.profiles SET email = 'attacker@example.com' WHERE id = v_editor;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_editor AND email = 'attacker@example.com') THEN
      v_failures := v_failures || 'FAIL: user rewrote profiles.email';
    ELSE
      RAISE NOTICE 'PASS: profiles.email unchanged';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: profiles.email write rejected — %', SQLERRM;
  END;

  -- 4. Reading the email column at all.
  BEGIN
    PERFORM (SELECT email FROM public.profiles WHERE id = v_owner);
    v_failures := v_failures || 'FAIL: authenticated can still SELECT profiles.email';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: profiles.email not readable by authenticated';
  WHEN OTHERS THEN
    RAISE NOTICE 'PASS (check message): profiles.email read rejected — %', SQLERRM;
  END;

  -- 5. Self-assigning the is_official trust marker.
  BEGIN
    UPDATE public.trip_templates SET is_official = true WHERE id = v_template;
    IF EXISTS (SELECT 1 FROM public.trip_templates WHERE id = v_template AND is_official) THEN
      v_failures := v_failures || 'FAIL: creator marked own template official';
    ELSE
      RAISE NOTICE 'PASS: is_official unchanged';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: is_official write rejected — %', SQLERRM;
  END;

  -- 6. Not over-blocked: a viewer must still be refused ordinary edits, and the
  --    owner must still be able to make them.
  BEGIN
    UPDATE public.trips SET title = 'viewer edit attempt' WHERE id = v_trip;
    IF EXISTS (SELECT 1 FROM public.trips WHERE id = v_trip AND title = 'viewer edit attempt') THEN
      v_failures := v_failures || 'FAIL: viewer edited a trip title';
    ELSE
      RAISE NOTICE 'PASS: viewer cannot edit trip fields';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS: viewer edit rejected — %', SQLERRM;
  END;

  RESET ROLE;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE public.trips SET title = 'owner edit' WHERE id = v_trip;
    IF EXISTS (SELECT 1 FROM public.trips WHERE id = v_trip AND title = 'owner edit') THEN
      RAISE NOTICE 'PASS: owner can still edit their own trip';
    ELSE
      v_failures := v_failures || 'REGRESSION: owner can no longer edit their own trip';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_failures := v_failures || ('REGRESSION: owner edit now fails — ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.trip_collaborators SET role = 'editor' WHERE id = v_collab;
    IF EXISTS (SELECT 1 FROM public.trip_collaborators WHERE id = v_collab AND role = 'editor') THEN
      RAISE NOTICE 'PASS: owner can still change a collaborator role';
    ELSE
      v_failures := v_failures || 'REGRESSION: owner can no longer set a collaborator role';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_failures := v_failures || ('REGRESSION: owner role change now fails — ' || SQLERRM);
  END;

  RESET ROLE;

  IF array_length(v_failures, 1) > 0 THEN
    RAISE EXCEPTION E'007 verification FAILED:\n%', array_to_string(v_failures, E'\n');
  END IF;

  RAISE NOTICE '=== 007 verification passed: every escalation blocked, owner unaffected ===';
END $$;

ROLLBACK;
