-- =====================================================
-- WanderForge — Fix RLS Infinite Recursion
-- Run this in Supabase SQL Editor
-- =====================================================

-- Create a SECURITY DEFINER function to check collaborator status
-- This bypasses RLS to prevent circular dependency
CREATE OR REPLACE FUNCTION public.is_trip_collaborator(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_collaborators
    WHERE trip_id = p_trip_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_editor(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_collaborators
    WHERE trip_id = p_trip_id AND user_id = p_user_id AND role = 'editor'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_trip_ids(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT trip_id FROM trip_collaborators WHERE user_id = p_user_id;
$$;

-- =====================================================
-- Drop ALL existing policies that cause recursion
-- =====================================================

-- TRIPS policies
DROP POLICY IF EXISTS "Users can view own trips" ON public.trips;
DROP POLICY IF EXISTS "Users can insert own trips" ON public.trips;
DROP POLICY IF EXISTS "Users can update own trips" ON public.trips;
DROP POLICY IF EXISTS "Users can delete own trips" ON public.trips;
DROP POLICY IF EXISTS "Collaborators can view trip" ON public.trips;

-- TRIP COLLABORATORS policies
DROP POLICY IF EXISTS "Collaborators visible to trip members" ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owner can manage collaborators" ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owner can update collaborators" ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owner can delete collaborators" ON public.trip_collaborators;
DROP POLICY IF EXISTS "Trip owner manages collaborators" ON public.trip_collaborators;

-- TRIP DAYS policies
DROP POLICY IF EXISTS "Trip days visible to trip members" ON public.trip_days;
DROP POLICY IF EXISTS "Trip days editable by trip members" ON public.trip_days;
DROP POLICY IF EXISTS "Trip days updatable by trip members" ON public.trip_days;
DROP POLICY IF EXISTS "Trip days deletable by owner" ON public.trip_days;

-- ACTIVITIES policies
DROP POLICY IF EXISTS "Activities visible to trip members" ON public.activities;
DROP POLICY IF EXISTS "Activities editable by trip members" ON public.activities;
DROP POLICY IF EXISTS "Activities updatable by trip members" ON public.activities;
DROP POLICY IF EXISTS "Activities deletable by trip members" ON public.activities;
DROP POLICY IF EXISTS "Collaborators can add activities" ON public.activities;
DROP POLICY IF EXISTS "Collaborators can edit activities" ON public.activities;
DROP POLICY IF EXISTS "Collaborators can delete activities" ON public.activities;

-- ACCOMMODATIONS policies
DROP POLICY IF EXISTS "Accommodations visible to trip members" ON public.accommodations;
DROP POLICY IF EXISTS "Accommodations editable by trip owner/editors" ON public.accommodations;

-- TRANSPORT policies
DROP POLICY IF EXISTS "Transport visible to trip members" ON public.transport_bookings;
DROP POLICY IF EXISTS "Transport editable by trip owner/editors" ON public.transport_bookings;

-- =====================================================
-- Recreate ALL policies using SECURITY DEFINER functions
-- (No cross-table RLS queries = no recursion)
-- =====================================================

-- TRIPS: Use function to avoid querying trip_collaborators with RLS
CREATE POLICY "trips_select" ON public.trips FOR SELECT USING (
  user_id = auth.uid()
  OR visibility = 'public'
  OR public.is_trip_collaborator(id, auth.uid())
);
CREATE POLICY "trips_insert" ON public.trips FOR INSERT WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY "trips_update" ON public.trips FOR UPDATE USING (
  user_id = auth.uid()
  OR public.is_trip_editor(id, auth.uid())
);
CREATE POLICY "trips_delete" ON public.trips FOR DELETE USING (
  user_id = auth.uid()
);

-- TRIP COLLABORATORS: Use direct auth.uid() checks, no trip table query
CREATE POLICY "collab_select" ON public.trip_collaborators FOR SELECT USING (
  user_id = auth.uid()
  OR trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
);
CREATE POLICY "collab_insert" ON public.trip_collaborators FOR INSERT WITH CHECK (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
);
CREATE POLICY "collab_update" ON public.trip_collaborators FOR UPDATE USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR user_id = auth.uid()
);
CREATE POLICY "collab_delete" ON public.trip_collaborators FOR DELETE USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
);

-- TRIP DAYS: Use function for collaborator check
CREATE POLICY "days_select" ON public.trip_days FOR SELECT USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR public.is_trip_collaborator(trip_id, auth.uid())
  OR trip_id IN (SELECT id FROM public.trips WHERE visibility = 'public')
);
CREATE POLICY "days_insert" ON public.trip_days FOR INSERT WITH CHECK (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR public.is_trip_editor(trip_id, auth.uid())
);
CREATE POLICY "days_update" ON public.trip_days FOR UPDATE USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR public.is_trip_editor(trip_id, auth.uid())
);
CREATE POLICY "days_delete" ON public.trip_days FOR DELETE USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
);

-- ACTIVITIES: Join through trip_days to trips using function
CREATE POLICY "activities_select" ON public.activities FOR SELECT USING (
  trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    JOIN public.trips t ON td.trip_id = t.id
    WHERE t.user_id = auth.uid() OR t.visibility = 'public'
  )
  OR trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    WHERE public.is_trip_collaborator(td.trip_id, auth.uid())
  )
);
CREATE POLICY "activities_insert" ON public.activities FOR INSERT WITH CHECK (
  trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    JOIN public.trips t ON td.trip_id = t.id
    WHERE t.user_id = auth.uid()
  )
  OR trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    WHERE public.is_trip_editor(td.trip_id, auth.uid())
  )
);
CREATE POLICY "activities_update" ON public.activities FOR UPDATE USING (
  trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    JOIN public.trips t ON td.trip_id = t.id
    WHERE t.user_id = auth.uid()
  )
  OR trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    WHERE public.is_trip_editor(td.trip_id, auth.uid())
  )
);
CREATE POLICY "activities_delete" ON public.activities FOR DELETE USING (
  trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    JOIN public.trips t ON td.trip_id = t.id
    WHERE t.user_id = auth.uid()
  )
  OR trip_day_id IN (
    SELECT td.id FROM public.trip_days td
    WHERE public.is_trip_editor(td.trip_id, auth.uid())
  )
);

-- ACCOMMODATIONS
CREATE POLICY "accommodations_select" ON public.accommodations FOR SELECT USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid() OR visibility = 'public')
  OR public.is_trip_collaborator(trip_id, auth.uid())
);
CREATE POLICY "accommodations_all" ON public.accommodations FOR ALL USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR public.is_trip_editor(trip_id, auth.uid())
);

-- TRANSPORT BOOKINGS
CREATE POLICY "transport_select" ON public.transport_bookings FOR SELECT USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid() OR visibility = 'public')
  OR public.is_trip_collaborator(trip_id, auth.uid())
);
CREATE POLICY "transport_all" ON public.transport_bookings FOR ALL USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR public.is_trip_editor(trip_id, auth.uid())
);
