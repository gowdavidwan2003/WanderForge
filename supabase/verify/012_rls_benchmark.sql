-- =====================================================
-- WanderForge — RLS benchmark for migration 012
-- =====================================================
--
-- Seeds enough volume to make the policy cost visible, times an activities read
-- the way the app issues it, and rolls the whole thing back. Nothing here
-- survives the transaction, so it is safe to run against a live database — but
-- it does hold locks and burn CPU for a minute or two, so prefer a branch or a
-- staging project if you have one.
--
-- HOW TO USE IT
--   1. Run this file BEFORE applying 012 and keep the timings.
--   2. Apply 012.
--   3. Run it again and compare.
--
-- The target from the ticket is a single-digit millisecond activities read at
-- 25,000 trip_days rows.
--
-- WHAT TO LOOK AT in the EXPLAIN output:
--   BEFORE  a Seq Scan on trip_days or trips inside the policy, and an
--           uncorrelated SubPlan / hashed SubPlan whose row estimate is the
--           whole table. auth.uid() appears in the filter rather than as an
--           InitPlan.
--   AFTER   Index Scan / Index Only Scan on trip_days_pkey and trips_pkey, and
--           `InitPlan 1 (returns $0)` containing auth.uid(), referenced as $0.
--
-- Volume is deliberately lopsided: one user owning a slice of a database that is
-- mostly other people's trips is exactly the shape the uncorrelated subqueries
-- handle worst, and exactly the shape a real deployment has.

BEGIN;

-- ---------------------------------------------------------------
-- 0. A user to be. Impersonation is what makes the policies apply;
--    running as the table owner or service role bypasses RLS entirely
--    and would time the wrong thing.
-- ---------------------------------------------------------------
CREATE TEMP TABLE bench_actor AS
SELECT id FROM auth.users ORDER BY created_at LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bench_actor) THEN
    RAISE EXCEPTION 'No users exist — sign up once before benchmarking.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 1. Seed: 5,000 trips / 25,000 days / 200,000 activities.
--    ~2% belong to our actor, the rest to a synthetic owner.
-- ---------------------------------------------------------------
INSERT INTO public.trips (id, user_id, title, destination, status, visibility)
SELECT
  gen_random_uuid(),
  CASE WHEN i % 50 = 0 THEN (SELECT id FROM bench_actor) ELSE (SELECT id FROM bench_actor) END,
  'bench trip ' || i,
  'Benchmarkia',
  'planned',
  CASE WHEN i % 97 = 0 THEN 'public' ELSE 'private' END
FROM generate_series(1, 5000) i;

-- Note on the CASE above: every trip is owned by the same real user because
-- trips_insert requires user_id = auth.uid() for normal roles, and inserting as
-- another user needs the service role. If you are running this as the service
-- role, replace the second branch with a second real user id — the numbers get
-- more honest, because the policy then has rows it must exclude.

INSERT INTO public.trip_days (id, trip_id, day_number, date)
SELECT
  gen_random_uuid(), t.id, d, CURRENT_DATE + d
FROM public.trips t
CROSS JOIN generate_series(1, 5) d
WHERE t.title LIKE 'bench trip %';

INSERT INTO public.activities (trip_day_id, title, category, start_time, end_time, order_index)
SELECT
  td.id, 'bench activity ' || a, 'sightseeing', '09:00', '10:00', a
FROM public.trip_days td
JOIN public.trips t ON t.id = td.trip_id
CROSS JOIN generate_series(1, 8) a
WHERE t.title LIKE 'bench trip %';

ANALYZE public.trips;
ANALYZE public.trip_days;
ANALYZE public.activities;

SELECT
  (SELECT count(*) FROM public.trips)      AS trips,
  (SELECT count(*) FROM public.trip_days)  AS trip_days,
  (SELECT count(*) FROM public.activities) AS activities;

-- ---------------------------------------------------------------
-- 2. Become that user, so RLS is actually in force.
-- ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', (SELECT id::text FROM bench_actor), 'role', 'authenticated')::text,
  true
);

-- ---------------------------------------------------------------
-- 3. The query the trip editor actually issues.
--    Reading one trip's activities through the embed from S3-3.
-- ---------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT a.*
FROM public.activities a
WHERE a.trip_day_id IN (
  SELECT id FROM public.trip_days
  WHERE trip_id = (SELECT id FROM public.trips WHERE title = 'bench trip 50' LIMIT 1)
)
ORDER BY a.order_index;

-- ---------------------------------------------------------------
-- 4. The unfiltered read, which is what the policy cost looks like
--    with nothing else to hide behind.
-- ---------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*) FROM public.activities;

-- ---------------------------------------------------------------
-- 5. The dashboard's invitation lookup — the index added in 012.
-- ---------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT trip_id FROM public.trip_collaborators
WHERE user_id = (SELECT id FROM bench_actor) AND accepted = false;

-- ---------------------------------------------------------------
-- 6. Index inventory: what exists, how big, and how often it has
--    been used since statistics were last reset. An index with
--    idx_scan = 0 on a table with real traffic is a candidate for
--    the next round of (b) above.
-- ---------------------------------------------------------------
RESET ROLE;

SELECT
  relname       AS table_name,
  indexrelname  AS index_name,
  idx_scan      AS scans,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;

-- ---------------------------------------------------------------
-- Everything above is discarded.
-- ---------------------------------------------------------------
ROLLBACK;
