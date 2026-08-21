-- =====================================================
-- WanderForge — the two questions worth asking today
-- =====================================================
--
-- Read-only. Nothing here writes, and both run in under a second.
--
-- These need no instrumentation, no analytics vendor and no new tables: the
-- data is already there because the generate route persists its conflict check
-- to trips.conflicts, and Supabase Auth already tracks sign-ins. Run them now
-- and you will know two things you currently do not.
--
-- They are a floor, not a substitute for real product analytics. In particular
-- trips.conflicts is OVERWRITTEN on every regeneration, so query 1 counts trips
-- that have ever been generated, not generations. For per-generation numbers
-- you need an events table or PostHog.

-- =====================================================
-- 1. IS THE CHECKER ACTUALLY FIRING?
-- =====================================================
-- The product's entire claim is that it catches journeys that do not fit. If
-- avg_issues comes back near zero, the claim is theoretical — either the plans
-- are genuinely clean, or the checker is not seeing what it needs to.
--
-- WHAT TO LOOK FOR
--   avg_issues              0.0 means the differentiator never fires. Anything
--                           from ~1 upward means it is doing its job.
--   unachievable_pct        How often a generated plan could not be walked even
--                           after the model got its one chance to fix it.
--   avg_legs_measured       Journeys measured against real roads (migration 014).
--                           0 means road data is not reaching the checker and
--                           every estimate is straight-line — check the logs for
--                           'route-cache-read'.
--   avg_legs_billed         New Routes calls per trip. This is the cost line.
--                           It should fall as the shared cache warms up; if it
--                           stays level, the cache is not working.
--   avg_places_billed       Same for Places lookups (migration 009).
SELECT
  count(*)                                                              AS trips_generated,
  round(avg(jsonb_array_length(conflicts -> 'issues')), 2)              AS avg_issues,
  round(avg((conflicts -> 'summary' ->> 'errors')::numeric), 2)         AS avg_hard_errors,
  round(
    100.0 * count(*) FILTER (WHERE (conflicts ->> 'achievable') = 'false')
    / nullif(count(*), 0), 1
  )                                                                     AS unachievable_pct,
  round(avg((conflicts -> 'roads' ->> 'fromCache')::numeric), 1)        AS avg_legs_from_cache,
  round(avg((conflicts -> 'roads' ->> 'fromProvider')::numeric), 1)     AS avg_legs_billed,
  round(avg((conflicts -> 'geocoded' ->> 'fromProvider')::numeric), 1)  AS avg_places_billed,
  -- More than 1 means the model needed a second completion — the validation
  -- retry or the conflict re-prompt. Consistently 2 is worth investigating.
  round(avg((conflicts ->> 'attempts')::numeric), 2)                    AS avg_completions
FROM public.trips
WHERE conflicts_checked_at > now() - interval '30 days';

-- =====================================================
-- 2. DOES ANYBODY COME BACK?
-- =====================================================
-- The only number an investor genuinely cares about, and the one you cannot
-- reason your way to. Crude — last_sign_in_at is a single timestamp, so this
-- shows "came back at least once", not a true retention curve. It is enough to
-- tell the difference between people using this and people trying it once.
--
-- WHAT TO LOOK FOR
--   returned_after_7d       The headline. Under ~10% means nobody is coming back
--                           and the next thing to build is whatever makes them.
--   made_a_trip             Signup-to-activation. A big gap between signed_up and
--                           made_a_trip means people bounce off the wizard.
SELECT
  date_trunc('week', u.created_at)::date                            AS cohort_week,
  count(*)                                                          AS signed_up,
  count(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM public.trips t WHERE t.user_id = u.id)
  )                                                                 AS made_a_trip,
  count(*) FILTER (
    WHERE u.last_sign_in_at > u.created_at + interval '1 day'
  )                                                                 AS returned_after_1d,
  count(*) FILTER (
    WHERE u.last_sign_in_at > u.created_at + interval '7 days'
  )                                                                 AS returned_after_7d
FROM auth.users u
GROUP BY 1
ORDER BY 1 DESC;

-- =====================================================
-- Bonus: what the caches are saving you
-- =====================================================
-- Not one of the two, but it is one line and it answers "is the cost work
-- actually working". Both tables are shared across all users, so hit rate should
-- climb as popular destinations repeat.
SELECT
  'geocode' AS cache, count(*) AS entries,
  count(*) FILTER (WHERE lat IS NULL) AS confirmed_misses,
  min(created_at)::date AS oldest
FROM public.geocode_cache
UNION ALL
SELECT
  'route', count(*),
  count(*) FILTER (WHERE km IS NULL),
  min(created_at)::date
FROM public.route_cache;
