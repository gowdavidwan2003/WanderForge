-- =====================================================
-- WanderForge — Geocode cache
-- Run this in Supabase SQL Editor after 008
-- =====================================================
--
-- Google Places Text Search is by far the most expensive thing this app does.
-- A 5-day generation resolves ~41 places at ~$0.032 each — around $1.30 a run,
-- roughly 300x what the Groq completion behind it costs. And unlike Groq, which
-- rate-limits and fails closed, Google keeps answering and keeps billing.
--
-- Almost all of that spend is repeat work. Destinations repeat heavily across
-- users, a regenerate re-resolves every place it resolved a minute earlier, and
-- a replan re-resolves places it is explicitly keeping. The lookups are the same
-- string every time, so they are cached here across all users rather than per
-- trip: "Mullayanagiri" is the same mountain whoever asks.
--
-- Key is the normalised query plus a coarse bias cell (see src/lib/geocodeCache.js).
-- The bias is part of the key because it changes the answer — "District Museum"
-- near Chikmagaluru is not "District Museum" near Delhi — but it is rounded to
-- ~0.1 degree so two users planning the same town share a cache entry.
--
-- L-1 / Google Maps Platform terms: cached content expires after 30 days.
-- expires_at enforces it on read, and purge_expired_geocode_cache() removes the
-- rows. Nothing is allowed to read past an expiry, so a missed purge delays
-- cleanup rather than breaching the terms.

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  cache_key TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  bias_key TEXT NOT NULL DEFAULT '',
  -- NULL coordinates record a confirmed miss. Worth storing: an unfindable
  -- place name is re-asked on every regenerate, and each of those is billed.
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  display_name TEXT,
  source TEXT NOT NULL DEFAULT 'google',
  hits INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_expires ON public.geocode_cache(expires_at);

COMMENT ON TABLE public.geocode_cache IS
  'Shared Places lookups. Entries expire after 30 days per the Google Maps Platform terms; readers must filter on expires_at rather than trusting the purge job.';

-- ============================================
-- ACCESS
-- ============================================
-- Readable by any signed-in user — the cache holds public place names and
-- coordinates, nothing about who searched for them, and sharing it across users
-- is the entire point.
--
-- Writes are service-role only, which bypasses RLS and so needs no policy. A
-- policy letting users insert would let one poison every other user's
-- coordinates, which is a worse failure than paying for a lookup.

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "geocode_cache_select" ON public.geocode_cache;
CREATE POLICY "geocode_cache_select" ON public.geocode_cache FOR SELECT TO authenticated
  USING (expires_at > NOW());

-- ============================================
-- EXPIRY
-- ============================================
-- Call from a scheduled job (pg_cron: SELECT cron.schedule('purge-geocode-cache',
-- '0 3 * * *', 'SELECT public.purge_expired_geocode_cache()')). Correctness does
-- not depend on it running: expired rows are already invisible to readers.
CREATE OR REPLACE FUNCTION public.purge_expired_geocode_cache()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM public.geocode_cache WHERE expires_at <= NOW();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

NOTIFY pgrst, 'reload schema';
