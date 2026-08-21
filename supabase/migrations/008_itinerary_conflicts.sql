-- =====================================================
-- WanderForge — Persisted itinerary conflicts
-- Run this in Supabase SQL Editor after 007
-- =====================================================
--
-- The generate route now runs conflictChecker server-side, against real road
-- distances, before a single activity is written. Most conflicts are fixed by
-- re-prompting the model; the ones that survive have to go somewhere, or the
-- traveler ends up with a plan that was known to be unachievable and no record
-- that anyone noticed.
--
-- Stored on the trip rather than per activity: a conflict is a statement about a
-- pair of activities and the gap between them, so it belongs to neither of them.
-- The checker is deterministic and cheap, so this is a record of what was true at
-- generation time — not a cache anything is required to trust. Re-running the
-- check against the saved rows is always allowed to disagree with it.
--
-- Shape (see conflictPayload in src/lib/conflictReport.js):
--   {
--     "issues":   [{ severity, type, day, activityId, title, message }, ...],
--     "summary":  { errors, warnings, info, checkedDays, checkedActivities },
--     "attempts": 2,
--     "geocoded": { "located": 41, "total": 46 },
--     "achievable": false
--   }

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS conflicts JSONB,
  ADD COLUMN IF NOT EXISTS conflicts_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.trips.conflicts IS
  'Result of conflictChecker at generation time. NULL means never checked, which is not the same as no conflicts.';

-- Finding the trips whose plans are known not to work. A partial index, because
-- the flagged ones are the minority and the unflagged ones are never queried
-- this way.
CREATE INDEX IF NOT EXISTS idx_trips_unachievable
  ON public.trips(user_id)
  WHERE conflicts IS NOT NULL AND (conflicts->>'achievable') = 'false';

-- No new RLS policies: both columns live on `trips` and are covered by the
-- existing trips_select / trips_update policies, so a collaborator who may edit
-- the trip may also record a fresh check, and nobody else can read either.

NOTIFY pgrst, 'reload schema';
