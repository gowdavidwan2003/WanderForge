-- =====================================================
-- WanderForge — Collaboration invitations (request → accept)
-- Run this in Supabase SQL Editor after 003
-- =====================================================

-- Previously these ignored `accepted`, so a merely-invited user already had full
-- access and "accepting" meant nothing. Gate both on an accepted invitation.
CREATE OR REPLACE FUNCTION public.is_trip_collaborator(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_collaborators
    WHERE trip_id = p_trip_id AND user_id = p_user_id AND accepted = true
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
    WHERE trip_id = p_trip_id
      AND user_id = p_user_id
      AND role = 'editor'
      AND accepted = true
  );
$$;

-- New invitations must be accepted explicitly.
ALTER TABLE public.trip_collaborators ALTER COLUMN accepted SET DEFAULT false;

-- A pending invitee has no access to the trip itself (the functions above now
-- exclude them), so they cannot read the trip title to decide on the invite.
-- This SECURITY DEFINER function exposes only the invitation metadata they need.
CREATE OR REPLACE FUNCTION public.get_my_invitations()
RETURNS TABLE (
  id UUID,
  trip_id UUID,
  role TEXT,
  invited_at TIMESTAMPTZ,
  trip_title TEXT,
  trip_destination TEXT,
  trip_start_date DATE,
  trip_end_date DATE,
  owner_name TEXT,
  owner_email TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    tc.id,
    tc.trip_id,
    tc.role,
    tc.invited_at,
    t.title,
    t.destination,
    t.start_date,
    t.end_date,
    p.display_name,
    p.email
  FROM trip_collaborators tc
  JOIN trips t ON t.id = tc.trip_id
  LEFT JOIN profiles p ON p.id = t.user_id
  WHERE tc.user_id = auth.uid()
    AND tc.accepted = false
  ORDER BY tc.invited_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_invitations() TO authenticated;

-- Trips the current user has accepted an invitation to. Used by the dashboard,
-- which previously only ever queried trips the user owned.
CREATE OR REPLACE FUNCTION public.get_shared_trip_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT trip_id FROM trip_collaborators
  WHERE user_id = auth.uid() AND accepted = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_trip_ids() TO authenticated;

-- An invitee must be able to accept/decline their own invitation, and the owner
-- must still be able to manage rows on trips they own.
DROP POLICY IF EXISTS "collab_update" ON public.trip_collaborators;
CREATE POLICY "collab_update" ON public.trip_collaborators FOR UPDATE USING (
  user_id = auth.uid()
  OR trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "collab_delete" ON public.trip_collaborators;
CREATE POLICY "collab_delete" ON public.trip_collaborators FOR DELETE USING (
  user_id = auth.uid()
  OR trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
);
