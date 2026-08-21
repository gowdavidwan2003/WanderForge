-- =====================================================
-- WanderForge — Road-leg cache
-- Run this in Supabase SQL Editor after 013
-- =====================================================
--
-- conflictChecker has always had a correction for winding roads: when it knows
-- the real road distance, a ratio of more than twice the straight-line distance
-- means switchbacks, and no flat-road average speed applies. Chikmagaluru town
-- to Mullayanagiri is 10.1 km straight, 21.8 km by road, and takes about 90
-- minutes; the flat model puts it at 35.
--
-- That correction has never run. It needs `roadKm`, and no caller ever supplied
-- it — so every check in the app used great-circle distance times 1.3 at a fixed
-- speed, and was optimistic by two to three times on exactly the mountain routes
-- the feature was built for.
--
-- Wiring it up means calling Google Routes, which is billed per leg. A five-day
-- itinerary is around thirty-five legs, and it would be re-billed on every
-- regeneration, every replan and every time somebody opened the trip. That is
-- the same mistake the geocode cache exists to prevent, so this is the same
-- solution: cache the leg, share it across users, expire it at thirty days.
--
-- A road between two points is public geography. It does not change between
-- users and it does not change often at all.

CREATE TABLE IF NOT EXISTS public.route_cache (
  -- from/to coordinates rounded to ~110 m, plus the travel mode.
  -- See legCacheKey() in src/lib/routeCache.js.
  cache_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  from_lat DOUBLE PRECISION NOT NULL,
  from_lng DOUBLE PRECISION NOT NULL,
  to_lat DOUBLE PRECISION NOT NULL,
  to_lng DOUBLE PRECISION NOT NULL,
  -- Road distance in km and duration in minutes, as the provider reported them.
  -- NULL km with NULL minutes records a confirmed no-route (an island, a border)
  -- so it is not re-asked on every check.
  km DOUBLE PRECISION,
  minutes DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'google',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_route_cache_expires ON public.route_cache(expires_at);

COMMENT ON TABLE public.route_cache IS
  'Shared road legs from Google Routes / OpenRouteService. Entries expire after 30 days per the Google Maps Platform terms; readers must filter on expires_at rather than trusting the purge job.';

-- ============================================
-- ACCESS
-- ============================================
-- Same shape as geocode_cache, for the same reasons: readable by any signed-in
-- user because it holds public geography and sharing it is the entire point;
-- writable only by the service role, because a user able to write travel times
-- that every other user's itinerary is then validated against could make an
-- impossible day look fine.
ALTER TABLE public.route_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "route_cache_select" ON public.route_cache;
CREATE POLICY "route_cache_select" ON public.route_cache FOR SELECT TO authenticated
  USING (expires_at > NOW());

-- ============================================
-- EXPIRY
-- ============================================
-- Schedule alongside the geocode purge:
--   SELECT cron.schedule('purge-route-cache', '15 3 * * *',
--                        'SELECT public.purge_expired_route_cache()');
-- Correctness does not depend on it: expired rows are already invisible to
-- readers because of the policy above.
CREATE OR REPLACE FUNCTION public.purge_expired_route_cache()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM public.route_cache WHERE expires_at <= NOW();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

NOTIFY pgrst, 'reload schema';
