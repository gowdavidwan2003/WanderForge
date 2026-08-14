-- =====================================================
-- WanderForge — Expense splitting + per-trip settings
-- Run this in Supabase SQL Editor after 004
-- =====================================================

-- Whether the settlement view collapses debts into the fewest transfers.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS simplify_balances BOOLEAN DEFAULT true;

-- Currency should follow the destination, not a USD default left in a dropdown.
ALTER TABLE public.trips ALTER COLUMN currency SET DEFAULT NULL;

-- ============================================
-- EXPENSES
-- ============================================
CREATE TABLE IF NOT EXISTS public.trip_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT,
  -- Who fronted the money.
  paid_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who the cost is split between: array of user ids.
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- How the cost is divided: 'equal', 'exact' (per-person amounts) or
  -- 'percent' (per-person percentages).
  split_mode TEXT NOT NULL DEFAULT 'equal'
    CHECK (split_mode IN ('equal', 'exact', 'percent')),
  -- Explicit per-person owed amounts, { "<user_id>": 250.00, ... }. Empty for an
  -- equal split, where shares are derived from `participants` at read time.
  shares JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safe to re-run if an earlier version of this file was already applied.
-- CREATE TABLE IF NOT EXISTS above is a no-op once the table exists, so the
-- unequal-split columns have to be added explicitly for existing installs.
ALTER TABLE public.trip_expenses
  ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS shares JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The CHECK lives on the CREATE TABLE, which the ALTER path skips — add it here
-- so both paths end up with the same constraints.
ALTER TABLE public.trip_expenses
  DROP CONSTRAINT IF EXISTS trip_expenses_split_mode_check;
ALTER TABLE public.trip_expenses
  ADD CONSTRAINT trip_expenses_split_mode_check
  CHECK (split_mode IN ('equal', 'exact', 'percent'));

CREATE INDEX IF NOT EXISTS idx_expenses_trip ON public.trip_expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON public.trip_expenses(paid_by);

ALTER TABLE public.trip_expenses ENABLE ROW LEVEL SECURITY;

-- Anyone on the trip (owner or accepted collaborator) can see and manage expenses.
DROP POLICY IF EXISTS "expenses_select" ON public.trip_expenses;
CREATE POLICY "expenses_select" ON public.trip_expenses FOR SELECT USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR public.is_trip_collaborator(trip_id, auth.uid())
);

DROP POLICY IF EXISTS "expenses_insert" ON public.trip_expenses;
CREATE POLICY "expenses_insert" ON public.trip_expenses FOR INSERT WITH CHECK (
  (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR public.is_trip_collaborator(trip_id, auth.uid())
  )
  AND created_by = auth.uid()
);

DROP POLICY IF EXISTS "expenses_update" ON public.trip_expenses;
CREATE POLICY "expenses_update" ON public.trip_expenses FOR UPDATE USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR public.is_trip_editor(trip_id, auth.uid())
);

DROP POLICY IF EXISTS "expenses_delete" ON public.trip_expenses;
CREATE POLICY "expenses_delete" ON public.trip_expenses FOR DELETE USING (
  trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
  OR created_by = auth.uid()
);

-- ============================================
-- TRIP MEMBERS
-- ============================================
-- The owner plus every accepted collaborator, with display names attached.
-- trip_collaborators.user_id references auth.users rather than profiles, so
-- PostgREST cannot embed profiles directly — this returns the joined shape the
-- expense UI needs in one call.
CREATE OR REPLACE FUNCTION public.get_trip_members(p_trip_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  email TEXT,
  role TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT t.user_id, p.display_name, p.email, 'owner'::TEXT
  FROM trips t
  LEFT JOIN profiles p ON p.id = t.user_id
  WHERE t.id = p_trip_id
    AND (
      t.user_id = auth.uid()
      OR public.is_trip_collaborator(p_trip_id, auth.uid())
    )

  UNION ALL

  SELECT tc.user_id, p.display_name, p.email, tc.role
  FROM trip_collaborators tc
  LEFT JOIN profiles p ON p.id = tc.user_id
  WHERE tc.trip_id = p_trip_id
    AND tc.accepted = true
    AND (
      p_trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())
      OR public.is_trip_collaborator(p_trip_id, auth.uid())
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_trip_members(UUID) TO authenticated;

-- Realtime so expenses appear live for everyone on the trip.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE trip_expenses;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PostgREST caches the schema; without this, new columns 404 until it refreshes.
NOTIFY pgrst, 'reload schema';
