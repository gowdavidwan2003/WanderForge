-- =====================================================
-- WanderForge — Itinerary lock
-- Run this in Supabase SQL Editor after 005
-- =====================================================
--
-- The trip owner can freeze the itinerary once the group has agreed on it. While
-- locked nobody may add, edit, remove or replan activities — including the owner,
-- who must unlock first. That makes the lock a deliberate state rather than a
-- soft suggestion.
--
-- Expenses are deliberately NOT affected: people keep spending money after the
-- plan is settled, so bill splitting must keep working on a locked trip.

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS itinerary_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Locked state for the trip that owns a given day. SECURITY DEFINER so the
-- policies below can read trips without recursing through trips' own RLS.
CREATE OR REPLACE FUNCTION public.is_itinerary_locked(p_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT itinerary_locked FROM trips WHERE id = p_trip_id), false);
$$;

CREATE OR REPLACE FUNCTION public.is_day_locked(p_trip_day_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((
    SELECT t.itinerary_locked
    FROM trip_days td
    JOIN trips t ON t.id = td.trip_id
    WHERE td.id = p_trip_day_id
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_itinerary_locked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_day_locked(UUID) TO authenticated;

-- ============================================
-- ACTIVITY WRITES BLOCKED WHILE LOCKED
-- ============================================
-- Enforced in the database so a locked itinerary cannot be edited by anything
-- that talks to PostgREST, not merely by a disabled button.

DROP POLICY IF EXISTS "activities_insert" ON public.activities;
CREATE POLICY "activities_insert" ON public.activities FOR INSERT WITH CHECK (
  NOT public.is_day_locked(trip_day_id)
  AND (
    trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      JOIN public.trips t ON td.trip_id = t.id
      WHERE t.user_id = auth.uid()
    )
    OR trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      WHERE public.is_trip_editor(td.trip_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "activities_update" ON public.activities;
CREATE POLICY "activities_update" ON public.activities FOR UPDATE USING (
  NOT public.is_day_locked(trip_day_id)
  AND (
    trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      JOIN public.trips t ON td.trip_id = t.id
      WHERE t.user_id = auth.uid()
    )
    OR trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      WHERE public.is_trip_editor(td.trip_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "activities_delete" ON public.activities;
CREATE POLICY "activities_delete" ON public.activities FOR DELETE USING (
  NOT public.is_day_locked(trip_day_id)
  AND (
    trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      JOIN public.trips t ON td.trip_id = t.id
      WHERE t.user_id = auth.uid()
    )
    OR trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      WHERE public.is_trip_editor(td.trip_id, auth.uid())
    )
  )
);

-- ============================================
-- ONLY THE OWNER MAY LOCK OR UNLOCK
-- ============================================
-- trips_update lets editors change trip fields, which would let a collaborator
-- unlock the trip themselves. Reject any change to the lock columns unless the
-- caller owns the trip.
CREATE OR REPLACE FUNCTION public.guard_itinerary_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.itinerary_locked IS DISTINCT FROM OLD.itinerary_locked THEN
    IF auth.uid() IS NULL OR auth.uid() <> OLD.user_id THEN
      RAISE EXCEPTION 'Only the trip owner can lock or unlock the itinerary';
    END IF;
    NEW.locked_at := CASE WHEN NEW.itinerary_locked THEN NOW() ELSE NULL END;
    NEW.locked_by := CASE WHEN NEW.itinerary_locked THEN auth.uid() ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_lock_guard ON public.trips;
CREATE TRIGGER trips_lock_guard
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.guard_itinerary_lock();

-- Expense policies are untouched on purpose — splitting bills continues to work
-- while the itinerary is locked.

NOTIFY pgrst, 'reload schema';
