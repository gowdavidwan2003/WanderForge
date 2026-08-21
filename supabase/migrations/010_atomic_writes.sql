-- =====================================================
-- WanderForge — Atomic replan and atomic trip creation
-- Run this in Supabase SQL Editor after 009
-- =====================================================
--
-- Two multi-statement writes were being driven from the browser, so a failure
-- part-way through left the database in a state the app cannot work with:
--
--   replanDay      DELETE the whole day, then INSERT the new one row at a time.
--                  A Groq timeout or a dropped connection between those two
--                  steps destroyed the day with nothing to put back.
--   trip creation  INSERT the trip, then INSERT its days. A failure on the
--                  second left a trip whose editor cannot function — no days
--                  means no timeline, no activities, nothing to select.
--
-- Neither can be fixed client-side. PostgREST wraps each request in its own
-- transaction, so two requests are two transactions however carefully they are
-- sequenced. Moving each pair into a function makes it one.
--
-- Both are SECURITY INVOKER (the default) on purpose: RLS applies to the tables
-- they touch, so the itinerary lock from 006 and the editor checks from 003 are
-- still enforced. A SECURITY DEFINER function here would quietly become a way to
-- write to any trip.

-- ============================================
-- 1. REPLACE A DAY'S ACTIVITIES, ATOMICALLY
-- ============================================
-- Deletes everything on the day and inserts the replacement in one transaction.
-- If any insert fails — a CHECK violation, a lock, a lost connection — the
-- delete goes with it and the original day is still there.
--
-- p_activities is the full replacement, as a JSON array. An `id` may be supplied
-- per element (undo passes the original ids back so a restored day is the same
-- day, not a copy of it); omit it and one is generated.
--
-- Returns the rows as written, so the caller can put them straight into local
-- state instead of re-reading them.
CREATE OR REPLACE FUNCTION public.replace_day_activities(
  p_trip_day_id UUID,
  p_activities JSONB
)
RETURNS SETOF public.activities
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_activities IS NULL OR jsonb_typeof(p_activities) <> 'array' THEN
    RAISE EXCEPTION 'p_activities must be a JSON array';
  END IF;

  -- Refusing an empty replacement is deliberate. Every caller is replacing a day
  -- with a new plan; an empty array means the plan failed to arrive, and wiping
  -- the day on the strength of that is the exact loss this function exists to
  -- prevent.
  IF jsonb_array_length(p_activities) = 0 THEN
    RAISE EXCEPTION 'Refusing to replace a day with an empty plan';
  END IF;

  DELETE FROM public.activities WHERE trip_day_id = p_trip_day_id;

  RETURN QUERY
  INSERT INTO public.activities (
    id, trip_day_id, title, description, location_name, category,
    start_time, end_time, cost, currency, notes, booking_link,
    order_index, latitude, longitude
  )
  SELECT
    COALESCE((a->>'id')::UUID, gen_random_uuid()),
    p_trip_day_id,
    a->>'title',
    COALESCE(a->>'description', ''),
    COALESCE(a->>'location_name', ''),
    COALESCE(a->>'category', 'other'),
    NULLIF(a->>'start_time', '')::TIME,
    NULLIF(a->>'end_time', '')::TIME,
    COALESCE((a->>'cost')::NUMERIC, 0),
    COALESCE(NULLIF(a->>'currency', ''), 'USD'),
    COALESCE(a->>'notes', ''),
    COALESCE(a->>'booking_link', ''),
    COALESCE((a->>'order_index')::INT, (ord - 1)::INT),
    NULLIF(a->>'latitude', '')::DOUBLE PRECISION,
    NULLIF(a->>'longitude', '')::DOUBLE PRECISION
  FROM jsonb_array_elements(p_activities) WITH ORDINALITY AS t(a, ord)
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_day_activities(UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.replace_day_activities(UUID, JSONB) IS
  'Replaces one day''s activities in a single transaction. RLS applies, so the itinerary lock still blocks it.';

-- ============================================
-- 2. CREATE A TRIP WITH ITS DAYS, ATOMICALLY
-- ============================================
-- A trip without days is not a lesser trip, it is a broken one: the editor has
-- no timeline to render and no day to select. Creating both together means that
-- state can no longer be reached.
CREATE OR REPLACE FUNCTION public.create_trip_with_days(
  p_trip JSONB,
  p_days JSONB
)
RETURNS public.trips
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_trip public.trips;
BEGIN
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' OR jsonb_array_length(p_days) = 0 THEN
    RAISE EXCEPTION 'A trip must be created with at least one day';
  END IF;

  INSERT INTO public.trips (
    user_id, title, destination, start_date, end_date,
    transport_mode, total_budget, currency, status, ai_preferences
  )
  VALUES (
    -- Not taken from the payload: the caller does not get to choose whose trip
    -- this is. trips_insert would reject a mismatch anyway; this makes it moot.
    auth.uid(),
    COALESCE(NULLIF(p_trip->>'title', ''), 'Untitled Trip'),
    p_trip->>'destination',
    NULLIF(p_trip->>'start_date', '')::DATE,
    NULLIF(p_trip->>'end_date', '')::DATE,
    COALESCE(NULLIF(p_trip->>'transport_mode', ''), 'mixed'),
    NULLIF(p_trip->>'total_budget', '')::NUMERIC,
    COALESCE(NULLIF(p_trip->>'currency', ''), 'USD'),
    COALESCE(NULLIF(p_trip->>'status', ''), 'planned'),
    COALESCE(p_trip->'ai_preferences', '{}'::jsonb)
  )
  RETURNING * INTO new_trip;

  INSERT INTO public.trip_days (trip_id, day_number, date)
  SELECT
    new_trip.id,
    COALESCE((d->>'day_number')::INT, ord::INT),
    NULLIF(d->>'date', '')::DATE
  FROM jsonb_array_elements(p_days) WITH ORDINALITY AS t(d, ord);

  RETURN new_trip;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_trip_with_days(JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.create_trip_with_days(JSONB, JSONB) IS
  'Creates a trip and its days in a single transaction, so no trip can exist without days.';

-- ============================================
-- 3. CLEAN UP THE ORPHANS ALREADY OUT THERE
-- ============================================
-- THIS DELETES DATA. A trip with no rows in trip_days is one the editor cannot
-- open: there is no timeline, no day to select, and no way to add an activity,
-- so there is nothing in it to lose. These are the residue of the failed
-- two-step creation above.
--
-- The one-hour guard is what keeps this safe to run at any time: a trip being
-- created right now, by the old client, is briefly in exactly this state.
-- Deleting it mid-flight would cause the very failure this cleans up after.
DO $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM public.trips t
  WHERE NOT EXISTS (SELECT 1 FROM public.trip_days d WHERE d.trip_id = t.id)
    AND t.created_at < NOW() - INTERVAL '1 hour';

  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'Removed % orphaned trip(s) with no days.', removed;
END;
$$;

NOTIFY pgrst, 'reload schema';
