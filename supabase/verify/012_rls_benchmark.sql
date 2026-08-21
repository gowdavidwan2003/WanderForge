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
-- A NOTE ON ROLES, which the first version of this script got wrong.
-- Everything from section 2 onward runs as `authenticated`, and that role cannot
-- read a temp table created by the role that started the transaction:
--
--   ERROR: 42501: permission denied for table bench_actor
--
-- So the actor's id is stashed in a session GUC *before* the role switch and
-- read back with current_setting() afterwards. GUCs are role-independent; temp
-- tables are not. Nothing after SET LOCAL ROLE touches bench_actor.

BEGIN;

-- ---------------------------------------------------------------
-- 0. A user to be. Impersonation is what makes the policies apply;
--    running as the table owner or service role bypasses RLS
--    entirely and would time the wrong thing.
-- ---------------------------------------------------------------
CREATE TEMP TABLE bench_actor AS
SELECT id FROM auth.users ORDER BY created_at LIMIT 1;

DO $$
DECLARE
  actor UUID;
BEGIN
  SELECT id INTO actor FROM bench_actor;

  IF actor IS NULL THEN
    RAISE EXCEPTION 'No users exist — sign up once before benchmarking.';
  END IF;

  -- Carried across the role switch below. A custom GUC is readable by any role,
  -- which is exactly what the temp table is not.
  PERFORM set_config('wf.bench_actor', actor::text, true);
  RAISE NOTICE 'Benchmarking as user %', actor;
END;
$$;

-- ---------------------------------------------------------------
-- 1. Seed: 5,000 trips / 25,000 days / 200,000 activities.
--
--    Every trip belongs to the same real user, because trips_insert
--    requires user_id = auth.uid() for normal roles. If you are
--    running this as the service role and have a second user id to
--    hand, give most of the trips to them instead: the policies then
--    have rows they must EXCLUDE, which is the more honest test and
--    the shape a real deployment has.
-- ---------------------------------------------------------------
INSERT INTO public.trips (id, user_id, title, destination, status, visibility)
SELECT
  gen_random_uuid(),
  current_setting('wf.bench_actor')::UUID,
  'bench trip ' || i,
  'Benchmarkia',
  'planned',
  CASE WHEN i % 97 = 0 THEN 'public' ELSE 'private' END
FROM generate_series(1, 5000) i;

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

-- The one trip the timed queries below read, resolved now while we still have
-- the privileges to look it up cheaply.
SELECT set_config(
  'wf.bench_trip',
  (SELECT id::text FROM public.trips WHERE title = 'bench trip 50' LIMIT 1),
  true
);

-- ---------------------------------------------------------------
-- 1b. Snapshot the index counters.
--
--     pg_stat_user_indexes is cumulative for the whole database and is NOT
--     transactional — it survives the ROLLBACK at the bottom of this file. Read
--     raw, it reports every request the app has ever served mixed in with this
--     benchmark, which makes it impossible to tell what this run actually did.
--     Section 6 diffs against this snapshot instead.
-- ---------------------------------------------------------------
CREATE TEMP TABLE bench_index_before AS
SELECT indexrelid, idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public';

-- ---------------------------------------------------------------
-- 2. Become that user, so RLS is actually in force.
--    request.jwt.claims is what auth.uid() reads.
-- ---------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('wf.bench_actor'),
    'role', 'authenticated'
  )::text,
  true
);

SET LOCAL ROLE authenticated;

-- Sanity check: if this does not return the seeded user, everything below is
-- timing the wrong thing and the numbers mean nothing.
SELECT auth.uid() AS acting_as, current_setting('wf.bench_actor')::UUID AS expected;

-- ---------------------------------------------------------------
-- 3. The query the trip editor actually issues: one trip's
--    activities, through the embed from S3-3.
-- ---------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT a.*
FROM public.activities a
WHERE a.trip_day_id IN (
  SELECT id FROM public.trip_days
  WHERE trip_id = current_setting('wf.bench_trip')::UUID
)
ORDER BY a.order_index;

-- ---------------------------------------------------------------
-- 4. The unfiltered read — the policy cost with nothing else to
--    hide behind.
-- ---------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*) FROM public.activities;

-- ---------------------------------------------------------------
-- 5. The dashboard's invitation lookup — the index added in 012.
--    auth.uid() rather than the temp table, for the reason at the
--    top of this file.
-- ---------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT trip_id FROM public.trip_collaborators
WHERE user_id = (SELECT auth.uid()) AND accepted = false;

-- ---------------------------------------------------------------
-- 6. Index usage, as a delta against the snapshot from 1b.
-- ---------------------------------------------------------------
RESET ROLE;

-- `scans_this_run` is what the queries above actually did. `scans_total` is the
-- lifetime figure, and a 0 there on an index created by 012 means only that it
-- is new — not that it is useless.
--
-- What to expect after 012, on the 200,000 seeded activities:
--   trip_days_pkey    ~one scan per activity row — the correlated EXISTS
--                     resolving through the primary key. This is the win; before
--                     012 the same work is a Seq Scan and does not appear here.
--   trips_pkey        ~one per distinct trip touched.
--   trip_collaborators_trip_id_user_id_key
--                     is_trip_collaborator. It should be LOW: it is the last
--                     branch of each OR and the owner check answers first. A
--                     count near the activity count means Postgres is not
--                     short-circuiting, and the function is worth folding into
--                     the EXISTS as a LEFT JOIN instead.
SELECT
  i.relname       AS table_name,
  i.indexrelname  AS index_name,
  i.idx_scan - COALESCE(b.idx_scan, 0) AS scans_this_run,
  i.idx_scan      AS scans_total,
  pg_size_pretty(pg_relation_size(i.indexrelid)) AS size
FROM pg_stat_user_indexes i
LEFT JOIN bench_index_before b ON b.indexrelid = i.indexrelid
WHERE i.schemaname = 'public'
ORDER BY scans_this_run DESC, pg_relation_size(i.indexrelid) DESC;

-- ---------------------------------------------------------------
-- Everything above is discarded.
-- ---------------------------------------------------------------
ROLLBACK;
