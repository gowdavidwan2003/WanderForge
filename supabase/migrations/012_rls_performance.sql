-- =====================================================
-- WanderForge — RLS performance and index realignment
-- Run this in Supabase SQL Editor after 011
-- =====================================================
--
-- The policies from 003 are correct and slow. Two problems, both invisible at
-- demo scale and both quadratic-ish as the tables fill:
--
-- 1. UNCORRELATED SUBQUERIES. `trip_day_id IN (SELECT td.id FROM trip_days td
--    JOIN trips t ...)` asks Postgres to build the set of every day id this user
--    can see, then test membership. That set is computed from a full scan of
--    trip_days joined to trips — it does not narrow to the row being checked, so
--    the work is the same whether you are reading one activity or all of them.
--    Rewritten as a correlated EXISTS, the same question becomes a primary-key
--    lookup: this activity's day, that day's trip, is it yours.
--
-- 2. auth.uid() PER ROW. auth.uid() is STABLE, not IMMUTABLE, and written bare
--    in a policy it is re-evaluated for every row scanned. Wrapped as
--    `(SELECT auth.uid())` it becomes an InitPlan: evaluated once for the whole
--    query and reused. This is Supabase's own documented recommendation and it
--    is worth more than it looks — it is one parse of a JWT claim per row.
--
-- The behaviour of every policy below is unchanged. Same people can see and
-- change exactly the same rows, including the itinerary lock from 006, which is
-- preserved verbatim in the activities write policies.
--
-- Benchmark before and after with supabase/verify/012_rls_benchmark.sql.

-- ============================================
-- 1. ACTIVITIES — the hot path
-- ============================================
-- Read on every trip load, every realtime merge and every conflict check.

DROP POLICY IF EXISTS "activities_select" ON public.activities;
CREATE POLICY "activities_select" ON public.activities FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.trip_days td
    JOIN public.trips t ON t.id = td.trip_id
    WHERE td.id = activities.trip_day_id
      AND (
        t.user_id = (SELECT auth.uid())
        OR t.visibility = 'public'
        -- Last, and deliberately so: it is the only branch that costs a function
        -- call, and the two above answer for almost every row in practice.
        -- SECURITY DEFINER is still required here — reading trip_collaborators
        -- directly from a policy would re-enter that table's own RLS, which is
        -- the recursion 003 was written to escape.
        OR public.is_trip_collaborator(td.trip_id, (SELECT auth.uid()))
      )
  )
);

-- The write policies keep the lock check from 006 exactly as it was: a locked
-- itinerary must stay unwritable, and that is enforced here rather than by a
-- disabled button.
DROP POLICY IF EXISTS "activities_insert" ON public.activities;
CREATE POLICY "activities_insert" ON public.activities FOR INSERT WITH CHECK (
  NOT public.is_day_locked(trip_day_id)
  AND EXISTS (
    SELECT 1
    FROM public.trip_days td
    JOIN public.trips t ON t.id = td.trip_id
    WHERE td.id = activities.trip_day_id
      AND (
        t.user_id = (SELECT auth.uid())
        OR public.is_trip_editor(td.trip_id, (SELECT auth.uid()))
      )
  )
);

DROP POLICY IF EXISTS "activities_update" ON public.activities;
CREATE POLICY "activities_update" ON public.activities FOR UPDATE USING (
  NOT public.is_day_locked(trip_day_id)
  AND EXISTS (
    SELECT 1
    FROM public.trip_days td
    JOIN public.trips t ON t.id = td.trip_id
    WHERE td.id = activities.trip_day_id
      AND (
        t.user_id = (SELECT auth.uid())
        OR public.is_trip_editor(td.trip_id, (SELECT auth.uid()))
      )
  )
);

DROP POLICY IF EXISTS "activities_delete" ON public.activities;
CREATE POLICY "activities_delete" ON public.activities FOR DELETE USING (
  NOT public.is_day_locked(trip_day_id)
  AND EXISTS (
    SELECT 1
    FROM public.trip_days td
    JOIN public.trips t ON t.id = td.trip_id
    WHERE td.id = activities.trip_day_id
      AND (
        t.user_id = (SELECT auth.uid())
        OR public.is_trip_editor(td.trip_id, (SELECT auth.uid()))
      )
  )
);

-- ============================================
-- 2. TRIP DAYS
-- ============================================
-- `trip_id IN (SELECT id FROM trips WHERE visibility = 'public')` was the worst
-- of these: it materialised every public trip in the database to answer a
-- question about one row.

DROP POLICY IF EXISTS "days_select" ON public.trip_days;
CREATE POLICY "days_select" ON public.trip_days FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_days.trip_id
      AND (t.user_id = (SELECT auth.uid()) OR t.visibility = 'public')
  )
  OR public.is_trip_collaborator(trip_days.trip_id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "days_insert" ON public.trip_days;
CREATE POLICY "days_insert" ON public.trip_days FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_days.trip_id AND t.user_id = (SELECT auth.uid())
  )
  OR public.is_trip_editor(trip_days.trip_id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "days_update" ON public.trip_days;
CREATE POLICY "days_update" ON public.trip_days FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_days.trip_id AND t.user_id = (SELECT auth.uid())
  )
  OR public.is_trip_editor(trip_days.trip_id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "days_delete" ON public.trip_days;
CREATE POLICY "days_delete" ON public.trip_days FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_days.trip_id AND t.user_id = (SELECT auth.uid())
  )
);

-- ============================================
-- 3. TRIPS AND COLLABORATORS
-- ============================================
DROP POLICY IF EXISTS "trips_select" ON public.trips;
CREATE POLICY "trips_select" ON public.trips FOR SELECT USING (
  user_id = (SELECT auth.uid())
  OR visibility = 'public'
  OR public.is_trip_collaborator(id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "trips_insert" ON public.trips;
CREATE POLICY "trips_insert" ON public.trips FOR INSERT WITH CHECK (
  user_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "trips_update" ON public.trips;
CREATE POLICY "trips_update" ON public.trips FOR UPDATE USING (
  user_id = (SELECT auth.uid())
  OR public.is_trip_editor(id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "trips_delete" ON public.trips;
CREATE POLICY "trips_delete" ON public.trips FOR DELETE USING (
  user_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "collab_select" ON public.trip_collaborators;
CREATE POLICY "collab_select" ON public.trip_collaborators FOR SELECT USING (
  user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_collaborators.trip_id AND t.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "collab_insert" ON public.trip_collaborators;
CREATE POLICY "collab_insert" ON public.trip_collaborators FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_collaborators.trip_id AND t.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "collab_update" ON public.trip_collaborators;
CREATE POLICY "collab_update" ON public.trip_collaborators FOR UPDATE USING (
  user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_collaborators.trip_id AND t.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "collab_delete" ON public.trip_collaborators;
CREATE POLICY "collab_delete" ON public.trip_collaborators FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_collaborators.trip_id AND t.user_id = (SELECT auth.uid())
  )
);

-- ============================================
-- 4. INDEXES
-- ============================================
-- Every index costs write throughput and planning time forever, so one that
-- answers no query is not free. The set from 001 has three problems.

-- (a) FOUR THAT DUPLICATE THE LEADING COLUMN OF ANOTHER INDEX.
--     A btree on (a, b) already answers every query a btree on (a) answers, at
--     the same cost. These four are pure overhead — three of them shadowed by an
--     index Postgres created itself for a UNIQUE constraint.
DROP INDEX IF EXISTS public.idx_activities_day;      -- ⊂ idx_activities_order(trip_day_id, order_index)
DROP INDEX IF EXISTS public.idx_trip_days_trip;      -- ⊂ UNIQUE(trip_id, day_number)
DROP INDEX IF EXISTS public.idx_collaborators_trip;  -- ⊂ UNIQUE(trip_id, user_id)
DROP INDEX IF EXISTS public.idx_api_keys_user;       -- ⊂ UNIQUE(user_id, provider)

-- (b) FIVE ON TABLES NOTHING READS OR WRITES.
--     trip_templates, reviews and activity_photos have no reader and no writer
--     anywhere in src/ — Explore builds its list from lib/templates.js, and
--     nothing in the app has ever created a review or an activity photo. The
--     tables are left in place (dropping them is a separate decision, and they
--     may be where those features land) but their indexes are removed. To be
--     honest about the gain: these tables are empty, so this buys tidiness and a
--     slightly cheaper autovacuum, not speed.
DROP INDEX IF EXISTS public.idx_templates_destination;
DROP INDEX IF EXISTS public.idx_templates_official;
DROP INDEX IF EXISTS public.idx_reviews_user;
DROP INDEX IF EXISTS public.idx_reviews_trip;
DROP INDEX IF EXISTS public.idx_photos_activity;

-- (c) HOT LOOKUPS WITH NOTHING BEHIND THEM.

-- get_my_invitations filters collaborators by user AND accepted. The old
-- idx_collaborators_user stopped at user_id, so every trip a heavy collaborator
-- is on was read to find the pending ones.
DROP INDEX IF EXISTS public.idx_collaborators_user;
CREATE INDEX IF NOT EXISTS idx_collaborators_user_accepted
  ON public.trip_collaborators(user_id, accepted);

-- trips_select and days_select both ask "is this trip public". A full index on a
-- column that is 'private' for virtually every row is mostly dead weight; a
-- partial index is the size of the answer set.
DROP INDEX IF EXISTS public.idx_trips_visibility;
CREATE INDEX IF NOT EXISTS idx_trips_public
  ON public.trips(id) WHERE visibility = 'public';

-- Nothing filters or orders trips by status: the dashboard reads by user_id and
-- sorts in the browser.
DROP INDEX IF EXISTS public.idx_trips_status;

-- The planner cannot choose any of this well against statistics gathered when
-- these tables were empty.
ANALYZE public.trips;
ANALYZE public.trip_days;
ANALYZE public.activities;
ANALYZE public.trip_collaborators;

NOTIFY pgrst, 'reload schema';
