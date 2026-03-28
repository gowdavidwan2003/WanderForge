-- WanderForge Database Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. PROFILES TABLE (extends auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  bio TEXT,
  countries_visited JSONB DEFAULT '[]'::jsonb,
  trips_count INT DEFAULT 0,
  badges JSONB DEFAULT '[]'::jsonb,
  theme_preference TEXT DEFAULT 'dark',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 2. TRIPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Trip',
  description TEXT,
  destination TEXT,
  dest_lat DOUBLE PRECISION,
  dest_lng DOUBLE PRECISION,
  start_date DATE,
  end_date DATE,
  cover_image_url TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'in_progress', 'completed')),
  visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'shared')),
  transport_mode TEXT DEFAULT 'mixed' CHECK (transport_mode IN ('car', 'public_transit', 'bike', 'walking', 'flight', 'mixed')),
  total_budget DECIMAL(12, 2),
  currency TEXT DEFAULT 'USD',
  ai_preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trips_user_id ON public.trips(user_id);
CREATE INDEX idx_trips_status ON public.trips(status);
CREATE INDEX idx_trips_visibility ON public.trips(visibility);

-- ============================================
-- 3. TRIP COLLABORATORS
-- ============================================
CREATE TABLE IF NOT EXISTS public.trip_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted BOOLEAN DEFAULT FALSE,
  UNIQUE(trip_id, user_id)
);

CREATE INDEX idx_collaborators_trip ON public.trip_collaborators(trip_id);
CREATE INDEX idx_collaborators_user ON public.trip_collaborators(user_id);

-- ============================================
-- 4. TRIP DAYS
-- ============================================
CREATE TABLE IF NOT EXISTS public.trip_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  date DATE,
  notes TEXT,
  weather_data JSONB,
  journal_entry TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, day_number)
);

CREATE INDEX idx_trip_days_trip ON public.trip_days(trip_id);

-- ============================================
-- 5. ACTIVITIES
-- ============================================
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_day_id UUID NOT NULL REFERENCES public.trip_days(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  location_name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  start_time TIME,
  end_time TIME,
  category TEXT DEFAULT 'sightseeing' CHECK (category IN ('sightseeing', 'food', 'transport', 'accommodation', 'adventure', 'shopping', 'nightlife', 'culture', 'nature', 'relaxation', 'other')),
  cost DECIMAL(10, 2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  order_index INT DEFAULT 0,
  post_trip_rating INT CHECK (post_trip_rating BETWEEN 1 AND 5),
  post_trip_review TEXT,
  booking_link TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_day ON public.activities(trip_day_id);
CREATE INDEX idx_activities_order ON public.activities(trip_day_id, order_index);

-- ============================================
-- 6. ACTIVITY PHOTOS
-- ============================================
CREATE TABLE IF NOT EXISTS public.activity_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_photos_activity ON public.activity_photos(activity_id);

-- ============================================
-- 7. ACCOMMODATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.accommodations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  check_in DATE,
  check_out DATE,
  cost_per_night DECIMAL(10, 2),
  currency TEXT DEFAULT 'USD',
  booking_link TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accommodations_trip ON public.accommodations(trip_id);

-- ============================================
-- 8. TRANSPORT BOOKINGS
-- ============================================
CREATE TABLE IF NOT EXISTS public.transport_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('flight', 'train', 'bus', 'car_rental', 'bike_rental', 'ferry', 'taxi', 'other')),
  from_location TEXT,
  to_location TEXT,
  from_lat DOUBLE PRECISION,
  from_lng DOUBLE PRECISION,
  to_lat DOUBLE PRECISION,
  to_lng DOUBLE PRECISION,
  departure_time TIMESTAMPTZ,
  arrival_time TIMESTAMPTZ,
  cost DECIMAL(10, 2),
  currency TEXT DEFAULT 'USD',
  booking_link TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transport_trip ON public.transport_bookings(trip_id);

-- ============================================
-- 9. TRIP TEMPLATES
-- ============================================
CREATE TABLE IF NOT EXISTS public.trip_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  duration_days INT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  itinerary_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_official BOOLEAN DEFAULT FALSE,
  usage_count INT DEFAULT 0,
  avg_rating DECIMAL(3, 2) DEFAULT 0,
  tags JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_destination ON public.trip_templates(destination);
CREATE INDEX idx_templates_official ON public.trip_templates(is_official);

-- ============================================
-- 10. REVIEWS
-- ============================================
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES public.activities(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_user ON public.reviews(user_id);
CREATE INDEX idx_reviews_trip ON public.reviews(trip_id);

-- ============================================
-- 11. USER API KEYS (encrypted)
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'mistral', 'groq')),
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_api_keys_user ON public.user_api_keys(user_id);

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "Users can view any profile" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- TRIPS
CREATE POLICY "Users can view own trips" ON public.trips 
  FOR SELECT USING (
    user_id = auth.uid() 
    OR visibility = 'public' 
    OR id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND accepted = true)
  );
CREATE POLICY "Users can insert own trips" ON public.trips 
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own trips" ON public.trips 
  FOR UPDATE USING (
    user_id = auth.uid() 
    OR id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
  );
CREATE POLICY "Users can delete own trips" ON public.trips 
  FOR DELETE USING (user_id = auth.uid());

-- TRIP COLLABORATORS
CREATE POLICY "Collaborators visible to trip members" ON public.trip_collaborators
  FOR SELECT USING (
    user_id = auth.uid()
    OR trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid())
  );
CREATE POLICY "Trip owner can manage collaborators" ON public.trip_collaborators
  FOR INSERT WITH CHECK (trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid()));
CREATE POLICY "Trip owner can update collaborators" ON public.trip_collaborators
  FOR UPDATE USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR user_id = auth.uid()
  );
CREATE POLICY "Trip owner can delete collaborators" ON public.trip_collaborators
  FOR DELETE USING (trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid()));

-- TRIP DAYS
CREATE POLICY "Trip days visible to trip members" ON public.trip_days
  FOR SELECT USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND accepted = true)
    OR trip_id IN (SELECT id FROM public.trips WHERE visibility = 'public')
  );
CREATE POLICY "Trip days editable by trip members" ON public.trip_days
  FOR INSERT WITH CHECK (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
  );
CREATE POLICY "Trip days updatable by trip members" ON public.trip_days
  FOR UPDATE USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
  );
CREATE POLICY "Trip days deletable by owner" ON public.trip_days
  FOR DELETE USING (trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid()));

-- ACTIVITIES
CREATE POLICY "Activities visible to trip members" ON public.activities
  FOR SELECT USING (
    trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      JOIN public.trips t ON td.trip_id = t.id
      WHERE t.user_id = auth.uid() OR t.visibility = 'public'
      OR t.id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND accepted = true)
    )
  );
CREATE POLICY "Activities editable by trip members" ON public.activities
  FOR INSERT WITH CHECK (
    trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      JOIN public.trips t ON td.trip_id = t.id
      WHERE t.user_id = auth.uid()
      OR t.id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
    )
  );
CREATE POLICY "Activities updatable by trip members" ON public.activities
  FOR UPDATE USING (
    trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      JOIN public.trips t ON td.trip_id = t.id
      WHERE t.user_id = auth.uid()
      OR t.id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
    )
  );
CREATE POLICY "Activities deletable by trip members" ON public.activities
  FOR DELETE USING (
    trip_day_id IN (
      SELECT td.id FROM public.trip_days td
      JOIN public.trips t ON td.trip_id = t.id
      WHERE t.user_id = auth.uid()
      OR t.id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
    )
  );

-- ACTIVITY PHOTOS
CREATE POLICY "Photos visible to trip members" ON public.activity_photos FOR SELECT USING (true);
CREATE POLICY "Users can upload own photos" ON public.activity_photos FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own photos" ON public.activity_photos FOR DELETE USING (user_id = auth.uid());

-- ACCOMMODATIONS
CREATE POLICY "Accommodations visible to trip members" ON public.accommodations
  FOR SELECT USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid() OR visibility = 'public')
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND accepted = true)
  );
CREATE POLICY "Accommodations editable by trip owner/editors" ON public.accommodations
  FOR ALL USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
  );

-- TRANSPORT BOOKINGS
CREATE POLICY "Transport visible to trip members" ON public.transport_bookings
  FOR SELECT USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid() OR visibility = 'public')
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND accepted = true)
  );
CREATE POLICY "Transport editable by trip owner/editors" ON public.transport_bookings
  FOR ALL USING (
    trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid())
    OR trip_id IN (SELECT trip_id FROM public.trip_collaborators WHERE user_id = auth.uid() AND role = 'editor' AND accepted = true)
  );

-- TRIP TEMPLATES
CREATE POLICY "Templates are public" ON public.trip_templates FOR SELECT USING (true);
CREATE POLICY "Users can create templates" ON public.trip_templates FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Creators can update templates" ON public.trip_templates FOR UPDATE USING (created_by = auth.uid());

-- REVIEWS
CREATE POLICY "Reviews are public" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Users can write reviews" ON public.reviews FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own reviews" ON public.reviews FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own reviews" ON public.reviews FOR DELETE USING (user_id = auth.uid());

-- USER API KEYS
CREATE POLICY "Users can manage own API keys" ON public.user_api_keys 
  FOR ALL USING (user_id = auth.uid());

-- ============================================
-- REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_days;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_collaborators;

-- ============================================
-- STORAGE BUCKET (for photos)
-- ============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('trip-photos', 'trip-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload" ON storage.objects 
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND bucket_id = 'trip-photos');
CREATE POLICY "Anyone can view trip photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'trip-photos');
CREATE POLICY "Users can delete own photos" ON storage.objects
  FOR DELETE USING (auth.uid()::text = (storage.foldername(name))[1] AND bucket_id = 'trip-photos');

-- ============================================  
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_trips_updated_at BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
