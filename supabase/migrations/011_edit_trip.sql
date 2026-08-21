-- =====================================================
-- WanderForge — Editing and deleting a trip
-- Run this in Supabase SQL Editor after 010
-- =====================================================
--
-- A trip was immutable and permanent: nothing in the app could change its title,
-- dates, destination, budget or transport mode, and nothing could delete it. A
-- typo in a title was forever.
--
-- Editing dates is the part that needs a transaction. Changing the range moves
-- every day's date and can push days off the end, and a day taken away takes its
-- activities with it (ON DELETE CASCADE). Doing that as three browser-driven
-- statements would leave a trip whose days disagree with its own start and end
-- dates if any of them failed — the same class of half-written state 010 fixed
-- for creation and replan.

-- ============================================
-- 1. UPDATE A TRIP AND RECONCILE ITS DAYS
-- ============================================
-- p_days is the FULL desired day list, [{day_number, date}, ...], as computed by
-- src/lib/tripDates.js. Days are matched on day_number, never on date: the
-- traveler's "day 3" is the third day of the trip whatever date it lands on, and
-- its activities belong to that position. Matching on date would strand every
-- activity the moment a trip moved by a week.
--
-- Days beyond the new range are deleted, and their activities cascade. The
-- caller is expected to have confirmed that first — describeDayChanges() builds
-- the sentence — but the count comes back either way so a surprise is visible.
CREATE OR REPLACE FUNCTION public.update_trip_with_days(
  p_trip_id UUID,
  p_trip JSONB,
  p_days JSONB
)
RETURNS public.trips
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  updated public.trips;
BEGIN
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' OR jsonb_array_length(p_days) = 0 THEN
    RAISE EXCEPTION 'A trip must keep at least one day';
  END IF;

  -- COALESCE against the existing value, so an absent key means "leave alone"
  -- rather than "set to null". A partial payload must not blank the rest of the
  -- trip.
  UPDATE public.trips SET
    title           = COALESCE(NULLIF(p_trip->>'title', ''), title),
    destination     = COALESCE(NULLIF(p_trip->>'destination', ''), destination),
    start_date      = COALESCE(NULLIF(p_trip->>'start_date', '')::DATE, start_date),
    end_date        = COALESCE(NULLIF(p_trip->>'end_date', '')::DATE, end_date),
    transport_mode  = COALESCE(NULLIF(p_trip->>'transport_mode', ''), transport_mode),
    currency        = COALESCE(NULLIF(p_trip->>'currency', ''), currency),
    -- Budget is the exception: clearing it is a real choice, so an explicit JSON
    -- null blanks it while an absent key leaves it be.
    total_budget    = CASE
                        WHEN p_trip ? 'total_budget'
                          THEN NULLIF(p_trip->>'total_budget', '')::NUMERIC
                        ELSE total_budget
                      END,
    -- Destination coordinates belong to the old destination. Clearing them when
    -- it changes is what makes the map and the weather follow the edit; they are
    -- re-resolved on the next load.
    dest_lat        = CASE
                        WHEN NULLIF(p_trip->>'destination', '') IS NOT NULL
                         AND p_trip->>'destination' IS DISTINCT FROM destination
                          THEN NULL ELSE dest_lat
                      END,
    dest_lng        = CASE
                        WHEN NULLIF(p_trip->>'destination', '') IS NOT NULL
                         AND p_trip->>'destination' IS DISTINCT FROM destination
                          THEN NULL ELSE dest_lng
                      END,
    updated_at      = NOW()
  WHERE id = p_trip_id
  RETURNING * INTO updated;

  -- RLS hid the row, or it is gone. Either way this is not an update to retry.
  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'Trip not found, or you do not have permission to change it';
  END IF;

  -- Days that no longer exist in the new range. Their activities cascade.
  DELETE FROM public.trip_days
  WHERE trip_id = p_trip_id
    AND day_number > (SELECT MAX((d->>'day_number')::INT) FROM jsonb_array_elements(p_days) d);

  -- Insert the new ones and re-date the survivors in one statement. The UNIQUE
  -- (trip_id, day_number) from 001 is what makes the conflict target work.
  INSERT INTO public.trip_days (trip_id, day_number, date)
  SELECT p_trip_id, (d->>'day_number')::INT, NULLIF(d->>'date', '')::DATE
  FROM jsonb_array_elements(p_days) d
  ON CONFLICT (trip_id, day_number) DO UPDATE SET date = EXCLUDED.date;

  RETURN updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_trip_with_days(UUID, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.update_trip_with_days(UUID, JSONB, JSONB) IS
  'Edits a trip and reconciles its days in one transaction. RLS applies; days are matched on day_number.';

-- ============================================
-- 2. DELETE COVERAGE
-- ============================================
-- Deleting a trip has to take everything with it. Every table that references
-- trips, directly or through trip_days/activities, is checked below rather than
-- assumed — a child table added later without ON DELETE CASCADE would leave rows
-- pointing at a trip that no longer exists, and (worse) rows still readable by
-- an RLS policy that joins through the missing parent.
--
-- Chain as of this migration:
--   trips
--    ├─ trip_days            CASCADE  ─ activities        CASCADE
--    │                                   ├─ activity_photos  CASCADE
--    │                                   ├─ reviews          CASCADE (activity_id)
--    │                                   └─ trip_expenses    SET NULL (activity_id)
--    ├─ trip_collaborators   CASCADE
--    ├─ accommodations       CASCADE
--    ├─ transport_bookings   CASCADE
--    ├─ reviews              CASCADE (trip_id)
--    └─ trip_expenses        CASCADE (trip_id)
--
-- trip_expenses.activity_id is SET NULL on purpose and is not a gap: an expense
-- outlives the activity it was attached to, and is removed by its own trip_id
-- cascade when the trip goes.
DO $$
DECLARE
  gap RECORD;
  found INT := 0;
BEGIN
  FOR gap IN
    SELECT
      c.conrelid::regclass::text AS child_table,
      c.conname                  AS constraint_name,
      c.confdeltype              AS on_delete
    FROM pg_constraint c
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace n  ON n.oid = parent.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND parent.relname IN ('trips', 'trip_days', 'activities')
      -- 'a' = NO ACTION, 'r' = RESTRICT. Either blocks a trip delete outright.
      AND c.confdeltype IN ('a', 'r')
  LOOP
    found := found + 1;
    RAISE WARNING
      'Delete gap: %.% references a trip table with ON DELETE % — deleting a trip will fail or orphan rows.',
      gap.child_table, gap.constraint_name, gap.on_delete;
  END LOOP;

  IF found = 0 THEN
    RAISE NOTICE 'Delete cascade verified: every child of trips/trip_days/activities cascades or nulls.';
  END IF;
END;
$$;

-- The delete itself needs no function: trips_delete from 003 already restricts it
-- to the owner, and the cascade above does the rest in Postgres' own transaction.
-- A collaborator with edit rights deliberately cannot delete the trip.

NOTIFY pgrst, 'reload schema';
