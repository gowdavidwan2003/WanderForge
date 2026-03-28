-- =====================================================
-- WanderForge — Enable Supabase Realtime
-- Run this in Supabase SQL Editor after initial schema
-- =====================================================

-- Enable Realtime on tables (skip if already added)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE activities;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE trip_days;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE trips;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE trip_collaborators;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add dest_lat and dest_lng columns to trips if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trips' AND column_name = 'dest_lat') THEN
    ALTER TABLE trips ADD COLUMN dest_lat DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trips' AND column_name = 'dest_lng') THEN
    ALTER TABLE trips ADD COLUMN dest_lng DOUBLE PRECISION;
  END IF;
END $$;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Collaborators can view trip" ON trips;
CREATE POLICY "Collaborators can view trip" 
  ON trips FOR SELECT
  USING (
    id IN (SELECT trip_id FROM trip_collaborators WHERE user_id = auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Collaborators can add activities" ON activities;
CREATE POLICY "Collaborators can add activities"
  ON activities FOR INSERT
  WITH CHECK (
    trip_day_id IN (
      SELECT td.id FROM trip_days td 
      JOIN trips t ON t.id = td.trip_id 
      WHERE t.user_id = auth.uid()
      OR t.id IN (SELECT trip_id FROM trip_collaborators WHERE user_id = auth.uid() AND role = 'editor')
    )
  );

DROP POLICY IF EXISTS "Collaborators can edit activities" ON activities;
CREATE POLICY "Collaborators can edit activities"
  ON activities FOR UPDATE
  USING (
    trip_day_id IN (
      SELECT td.id FROM trip_days td 
      JOIN trips t ON t.id = td.trip_id 
      WHERE t.user_id = auth.uid()
      OR t.id IN (SELECT trip_id FROM trip_collaborators WHERE user_id = auth.uid() AND role = 'editor')
    )
  );

DROP POLICY IF EXISTS "Collaborators can delete activities" ON activities;
CREATE POLICY "Collaborators can delete activities"
  ON activities FOR DELETE
  USING (
    trip_day_id IN (
      SELECT td.id FROM trip_days td 
      JOIN trips t ON t.id = td.trip_id 
      WHERE t.user_id = auth.uid()
      OR t.id IN (SELECT trip_id FROM trip_collaborators WHERE user_id = auth.uid() AND role = 'editor')
    )
  );

DROP POLICY IF EXISTS "Trip owner manages collaborators" ON trip_collaborators;
CREATE POLICY "Trip owner manages collaborators"
  ON trip_collaborators FOR ALL
  USING (
    trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())
  );
