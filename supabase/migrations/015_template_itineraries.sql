-- =====================================================
-- WanderForge — Templates that actually contain a plan
-- Run this in Supabase SQL Editor after 014
-- =====================================================
--
-- trip_templates has existed since migration 001 and has never held a row.
-- Explore instead read a static JS array of thirty destinations, and "Use
-- Template" called create_trip_with_days — which creates a trip and its days
-- and nothing else. So a template produced an empty calendar. The word
-- "template" promised a plan; what arrived was a blank one, and the user still
-- had to run the AI planner to get anything at all.
--
-- Two changes fix that:
--
--   1. itinerary_data now holds a real day-by-day plan — every stop with a
--      time, a category, a cost and real coordinates.
--   2. create_trip_from_template() writes the trip, its days AND its activities
--      in one transaction, so using a template lands a finished itinerary.
--
-- The set shrinks from thirty destinations to ten, because thirty stubs that
-- say nothing are worth less than ten plans somebody can actually follow. Five
-- international, five Indian.
--
-- Templates are readable by anonymous visitors on purpose: a plan nobody can
-- see until they sign up cannot persuade anybody to sign up. Creating a trip
-- from one still needs an account, because a trip needs an owner.

-- ============================================
-- 1. DISPLAY AND CURRENCY COLUMNS
-- ============================================
-- cover_image_url was designed for a hosted image. Every official template uses
-- a CSS colour and an emoji, so they get their own columns rather than a URL
-- column quietly holding hex.
--
-- currency belongs on the row, not inside itinerary_data: it applies to the
-- trip as a whole and every activity cost is denominated in it.
ALTER TABLE public.trip_templates
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS cover TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT;

-- Migration 012 dropped the indexes on this table because nothing queried it.
-- It is queried now. This one is partial so it constrains only official rows —
-- a user may still create their own Paris template.
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_official_dest
  ON public.trip_templates(destination)
  WHERE is_official = true;

-- ============================================
-- 2. TAGS THE PLANNER UNDERSTANDS
-- ============================================
-- Template tags are written for a reader; interests are a fixed vocabulary the
-- generate route reads from ai_preferences.interests. 'romance', 'technology'
-- and 'luxury' are fair things to say about a city and are not interests the
-- planner knows, so they map to the nearest one that is.
--
-- Mirrors TAG_TO_INTEREST in src/lib/templates.js, which covers the path where
-- the browser builds a trip without this function.
CREATE OR REPLACE FUNCTION public.template_interests(p_tags JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT mapped), '[]'::jsonb)
  FROM (
    SELECT CASE tag
             WHEN 'romance'    THEN 'relaxation'
             WHEN 'technology' THEN 'sightseeing'
             WHEN 'luxury'     THEN 'shopping'
             WHEN 'spiritual'  THEN 'culture'
             WHEN 'beach'      THEN 'relaxation'
             WHEN 'heritage'   THEN 'history'
             ELSE tag
           END AS mapped
    FROM jsonb_array_elements_text(COALESCE(p_tags, '[]'::jsonb)) AS tag
  ) t;
$$;

-- ============================================
-- 3. ANONYMOUS READ
-- ============================================
-- The policy from 001 (USING true, no TO clause) already covers anon, but the
-- table-level grant is what actually decides whether PostgREST will answer an
-- unauthenticated request. Being explicit here rather than relying on Supabase
-- default privileges having survived fourteen migrations.
GRANT SELECT ON public.trip_templates TO anon, authenticated;

DROP POLICY IF EXISTS "Templates are public" ON public.trip_templates;
CREATE POLICY "trip_templates_select" ON public.trip_templates
  FOR SELECT TO anon, authenticated
  USING (true);

-- ============================================
-- 4. CLEAR OUT PLACEHOLDER ROWS
-- ============================================
-- SUPERSEDES A DRAFT THAT WAS ALREADY RUN. An earlier version of this file,
-- 015_seed_templates.sql, seeded thirty official rows with
-- itinerary_data = '{}' — destinations with no plan in them. It has been run
-- against at least one database and no longer exists in the repository.
--
-- This deletes exactly those rows: is_official, and no days in the plan. A
-- '{}' itinerary yields NULL from ->'days', so the COALESCE reads it as zero.
-- It matches nothing a user created, and nothing on a fresh database.
--
-- Deleting them does not touch trips already made from them. Nothing
-- references trip_templates by foreign key; ai_preferences.template_id is
-- JSONB, so an existing trip keeps working and simply points at an id that has
-- been replaced.
--
-- Running this file more than once is safe: the columns and index are
-- IF NOT EXISTS, the seed below is ON CONFLICT DO UPDATE, and this delete
-- cannot match the ten rows it is about to insert, because they all have days.
DELETE FROM public.trip_templates
WHERE is_official = true
  AND COALESCE(jsonb_array_length(itinerary_data->'days'), 0) = 0;

-- ============================================
-- 5. THE TEMPLATES
-- ============================================
-- itinerary_data shape:
--   { "days": [ { "day_number": 1, "title": "...", "activities": [ ... ] } ] }
-- Activity keys match public.activities column-for-column so the insert below
-- is a straight projection. Coordinates are the real ones for each landmark.
--
-- Costs are per person in the template's currency and are indicative entry and
-- meal prices, not bookings.
--
-- WATCH THE TWO VOCABULARIES. `category` here must satisfy the CHECK on
-- public.activities:
--
--   sightseeing, food, transport, accommodation, adventure,
--   shopping, nightlife, culture, nature, relaxation, other
--
-- That is NOT the interest vocabulary used in tags and ai_preferences, which
-- has 'history' and 'photography' and no 'transport' or 'accommodation'. There
-- is no 'history' category — forts, ruins and temples are 'culture'. Writing
-- one here fails the whole migration on the CHECK constraint.

-- ---------- PARIS ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Paris in Five Days',
  'Paris, France',
  5,
  'The City of Lights — iconic landmarks, world-class cuisine, and unforgettable strolls along the Seine.',
  '🗼', '#E8B87D', 'EUR',
  '["culture","food","romance"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"Île de la Cité and the Latin Quarter","activities":[
  {"title":"Notre-Dame and Île de la Cité","description":"Start on the island the city grew out of. Walk the exterior and the Square Jean XXIII behind the apse.","location_name":"Notre-Dame de Paris","category":"sightseeing","start_time":"10:00","end_time":"11:30","cost":0,"latitude":48.8530,"longitude":2.3499},
  {"title":"Sainte-Chapelle","description":"Fifteen metres of thirteenth-century stained glass. Go late morning when the south wall lights up.","location_name":"Sainte-Chapelle","category":"culture","start_time":"11:45","end_time":"12:45","cost":13,"latitude":48.8554,"longitude":2.3450},
  {"title":"Lunch on Rue de la Huchette","description":"Cheap, busy and central. Avoid the places with photographs of the food outside.","location_name":"Latin Quarter","category":"food","start_time":"13:00","end_time":"14:30","cost":22,"latitude":48.8529,"longitude":2.3457},
  {"title":"Shakespeare and Company","description":"The English-language bookshop opposite the cathedral. The upstairs reading room is free.","location_name":"Shakespeare and Company","category":"culture","start_time":"15:00","end_time":"16:00","cost":0,"latitude":48.8526,"longitude":2.3471},
  {"title":"Dinner in Saint-Germain","description":"Classic bistro cooking. Book ahead for anywhere with a reputation.","location_name":"Saint-Germain-des-Prés","category":"food","start_time":"19:30","end_time":"21:30","cost":45,"latitude":48.8540,"longitude":2.3335}
 ]},
 {"day_number":2,"title":"The Louvre and the Right Bank","activities":[
  {"title":"The Louvre","description":"Book the first slot and pick two wings. Trying to see it all is how people leave exhausted and remembering nothing.","location_name":"Musée du Louvre","category":"culture","start_time":"09:00","end_time":"13:00","cost":22,"latitude":48.8606,"longitude":2.3376},
  {"title":"Lunch at the Tuileries","description":"Kiosks in the garden, or Rue Saint-Honoré two minutes north for something better.","location_name":"Jardin des Tuileries","category":"food","start_time":"13:15","end_time":"14:15","cost":18,"latitude":48.8635,"longitude":2.3275},
  {"title":"Place de la Concorde and the Champs-Élysées","description":"Walk the axis west. It is long and mostly shops, but the perspective is the point.","location_name":"Place de la Concorde","category":"sightseeing","start_time":"14:30","end_time":"16:00","cost":0,"latitude":48.8656,"longitude":2.3212},
  {"title":"Arc de Triomphe rooftop","description":"Use the underpass, never cross the roundabout. Twelve avenues radiate from directly below you.","location_name":"Arc de Triomphe","category":"sightseeing","start_time":"16:15","end_time":"17:30","cost":16,"latitude":48.8738,"longitude":2.2950},
  {"title":"Seine dinner cruise","description":"Touristy and worth it once, at dusk, when the bridges light up.","location_name":"Port de la Bourdonnais","category":"food","start_time":"20:00","end_time":"22:00","cost":75,"latitude":48.8600,"longitude":2.2950}
 ]},
 {"day_number":3,"title":"Eiffel Tower and the Seventh","activities":[
  {"title":"Trocadéro viewpoint","description":"The photograph everyone wants is from here, and it is emptiest before nine.","location_name":"Place du Trocadéro","category":"sightseeing","start_time":"08:30","end_time":"09:15","cost":0,"latitude":48.8629,"longitude":2.2885},
  {"title":"Eiffel Tower summit","description":"Lifts to the top. Book weeks ahead; the on-the-day queue is two hours in season.","location_name":"Tour Eiffel","category":"sightseeing","start_time":"09:30","end_time":"11:30","cost":29,"latitude":48.8584,"longitude":2.2945},
  {"title":"Picnic on the Champ de Mars","description":"Buy bread, cheese and fruit on Rue Cler first. Cheaper and better than anything at the tower.","location_name":"Champ de Mars","category":"food","start_time":"12:00","end_time":"13:30","cost":15,"latitude":48.8556,"longitude":2.2986},
  {"title":"Musée Rodin","description":"Small, calm, and the garden holds The Thinker. A good antidote to the Louvre.","location_name":"Musée Rodin","category":"culture","start_time":"14:00","end_time":"16:00","cost":14,"latitude":48.8553,"longitude":2.3158},
  {"title":"Dinner on Rue Cler","description":"A market street that stays local despite the neighbourhood.","location_name":"Rue Cler","category":"food","start_time":"19:00","end_time":"21:00","cost":38,"latitude":48.8556,"longitude":2.3060}
 ]},
 {"day_number":4,"title":"Montmartre","activities":[
  {"title":"Sacré-Cœur and the steps","description":"Climb rather than take the funicular. The city opens up behind you as you go.","location_name":"Basilique du Sacré-Cœur","category":"sightseeing","start_time":"09:30","end_time":"11:00","cost":0,"latitude":48.8867,"longitude":2.3431},
  {"title":"Place du Tertre","description":"The painters square. Heavily touristed — the quiet streets one block off it are the reason to come.","location_name":"Place du Tertre","category":"culture","start_time":"11:00","end_time":"12:00","cost":0,"latitude":48.8865,"longitude":2.3406},
  {"title":"Lunch in Abbesses","description":"Below the hill, where people who live here eat.","location_name":"Rue des Abbesses","category":"food","start_time":"12:30","end_time":"14:00","cost":25,"latitude":48.8845,"longitude":2.3380},
  {"title":"Musée de Montmartre","description":"Renoir gardens and the story of the hill before it was a postcard.","location_name":"Musée de Montmartre","category":"culture","start_time":"14:30","end_time":"16:00","cost":15,"latitude":48.8884,"longitude":2.3403},
  {"title":"Pigalle in the evening","description":"Bars and small music venues. The Moulin Rouge is here if you want the show.","location_name":"Pigalle","category":"nightlife","start_time":"20:00","end_time":"23:00","cost":30,"latitude":48.8821,"longitude":2.3374}
 ]},
 {"day_number":5,"title":"Versailles","activities":[
  {"title":"RER C to Versailles","description":"Roughly forty minutes from central Paris. Buy the return before you board.","location_name":"Gare de Versailles Château Rive Gauche","category":"transport","start_time":"08:00","end_time":"08:50","cost":8,"latitude":48.7950,"longitude":2.1300},
  {"title":"Château de Versailles","description":"Be at the gate for opening. By eleven the Hall of Mirrors is shoulder to shoulder.","location_name":"Château de Versailles","category":"culture","start_time":"09:00","end_time":"12:00","cost":21,"latitude":48.8049,"longitude":2.1204},
  {"title":"The gardens and the Grand Canal","description":"Bigger than the palace and far less crowded. Rent a bike or a rowing boat.","location_name":"Gardens of Versailles","category":"nature","start_time":"12:30","end_time":"15:30","cost":12,"latitude":48.8060,"longitude":2.1100},
  {"title":"Return and a last dinner","description":"Back into the city for the evening. Le Marais is the easy choice.","location_name":"Le Marais","category":"food","start_time":"19:30","end_time":"21:30","cost":40,"latitude":48.8571,"longitude":2.3600}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- TOKYO ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Tokyo in Five Days',
  'Tokyo, Japan',
  5,
  'A mesmerizing blend of ancient temples, futuristic tech, and the best street food on Earth.',
  '🏯', '#C85A3A', 'JPY',
  '["culture","food","technology"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"Shinjuku","activities":[
  {"title":"Metropolitan Government Building observatory","description":"Two hundred metres up and free. On a clear winter morning you can see Fuji.","location_name":"Tokyo Metropolitan Government Building","category":"sightseeing","start_time":"10:00","end_time":"11:00","cost":0,"latitude":35.6896,"longitude":139.6917},
  {"title":"Shinjuku Gyoen","description":"Three garden styles in one park. The quietest place in the busiest ward.","location_name":"Shinjuku Gyoen National Garden","category":"nature","start_time":"11:30","end_time":"13:00","cost":500,"latitude":35.6852,"longitude":139.7100},
  {"title":"Lunch in Shinjuku","description":"Department store basements do excellent, cheap and fast food.","location_name":"Shinjuku","category":"food","start_time":"13:15","end_time":"14:15","cost":1200,"latitude":35.6909,"longitude":139.7003},
  {"title":"Omoide Yokocho","description":"A lane of six-seat yakitori bars under the tracks. Cash, smoke and no English menus.","location_name":"Omoide Yokocho","category":"food","start_time":"18:30","end_time":"20:30","cost":3500,"latitude":35.6938,"longitude":139.6994},
  {"title":"Golden Gai","description":"Two hundred tiny bars across six alleys. Many charge a cover; check before sitting.","location_name":"Golden Gai","category":"nightlife","start_time":"21:00","end_time":"23:00","cost":3000,"latitude":35.6938,"longitude":139.7048}
 ]},
 {"day_number":2,"title":"Asakusa and the old east","activities":[
  {"title":"Sensō-ji at opening","description":"Tokyo oldest temple. Arrive by eight and you will have Nakamise-dōri almost to yourself.","location_name":"Sensō-ji","category":"culture","start_time":"08:00","end_time":"09:30","cost":0,"latitude":35.7148,"longitude":139.7967},
  {"title":"Nakamise-dōri","description":"The approach street. Ningyo-yaki and senbei are made in front of you.","location_name":"Nakamise-dōri","category":"food","start_time":"09:30","end_time":"10:30","cost":800,"latitude":35.7118,"longitude":139.7966},
  {"title":"Tokyo Skytree","description":"The tallest tower in the world. Book the timed slot; walk-ups wait.","location_name":"Tokyo Skytree","category":"sightseeing","start_time":"11:00","end_time":"13:00","cost":3100,"latitude":35.7101,"longitude":139.8107},
  {"title":"Ueno Park and the National Museum","description":"Japan largest museum collection, and the park is the city cherry-blossom centre in spring.","location_name":"Ueno Park","category":"culture","start_time":"14:00","end_time":"17:00","cost":1000,"latitude":35.7148,"longitude":139.7737},
  {"title":"Ameyoko market","description":"A loud open-air market under the Yamanote line. Street food and haggling.","location_name":"Ameyoko","category":"food","start_time":"17:15","end_time":"19:00","cost":2000,"latitude":35.7089,"longitude":139.7745}
 ]},
 {"day_number":3,"title":"Shibuya and Harajuku","activities":[
  {"title":"Meiji Jingū","description":"A forest of a hundred thousand donated trees in the middle of the city. Enter at the Harajuku torii.","location_name":"Meiji Jingū","category":"culture","start_time":"09:00","end_time":"10:30","cost":0,"latitude":35.6764,"longitude":139.6993},
  {"title":"Takeshita Street","description":"Teen fashion at full volume. Ten minutes is usually enough.","location_name":"Takeshita Street","category":"shopping","start_time":"10:45","end_time":"12:00","cost":2000,"latitude":35.6716,"longitude":139.7031},
  {"title":"Lunch on Cat Street","description":"The quieter backstreet between Harajuku and Shibuya, and much better eating.","location_name":"Cat Street","category":"food","start_time":"12:15","end_time":"13:45","cost":1800,"latitude":35.6690,"longitude":139.7050},
  {"title":"Shibuya Crossing","description":"Watch it from the Starbucks window first, then cross it yourself.","location_name":"Shibuya Crossing","category":"sightseeing","start_time":"14:30","end_time":"15:30","cost":0,"latitude":35.6595,"longitude":139.7005},
  {"title":"Shibuya Sky at sunset","description":"Open-air rooftop, two hundred and thirty metres up. Book the slot forty minutes before sunset.","location_name":"Shibuya Sky","category":"sightseeing","start_time":"16:30","end_time":"18:00","cost":2500,"latitude":35.6580,"longitude":139.7016},
  {"title":"Izakaya dinner in Shibuya","description":"Order in rounds rather than courses. That is the whole idea.","location_name":"Shibuya","category":"food","start_time":"19:00","end_time":"21:30","cost":4000,"latitude":35.6600,"longitude":139.7000}
 ]},
 {"day_number":4,"title":"Tsukiji, Ginza and the bay","activities":[
  {"title":"Tsukiji Outer Market","description":"The inner wholesale market moved to Toyosu; the outer market and its food stalls stayed. Go hungry and early.","location_name":"Tsukiji Outer Market","category":"food","start_time":"08:00","end_time":"10:00","cost":2500,"latitude":35.6654,"longitude":139.7707},
  {"title":"Hamarikyū Gardens","description":"An Edo-period garden ringed by towers, with a tea house on the tidal pond.","location_name":"Hamarikyū Gardens","category":"nature","start_time":"10:15","end_time":"11:45","cost":300,"latitude":35.6597,"longitude":139.7634},
  {"title":"teamLab Planets","description":"Barefoot, waist-deep in water, inside the light. Book well ahead; slots sell out.","location_name":"teamLab Planets TOKYO","category":"culture","start_time":"13:00","end_time":"15:00","cost":3800,"latitude":35.6497,"longitude":139.7866},
  {"title":"Ginza","description":"Flagship stores and the best department store food halls in Japan.","location_name":"Ginza","category":"shopping","start_time":"16:00","end_time":"18:30","cost":3000,"latitude":35.6717,"longitude":139.7650},
  {"title":"Sushi dinner","description":"A counter, not a conveyor. Even a mid-range Ginza counter is a different thing entirely.","location_name":"Ginza","category":"food","start_time":"19:00","end_time":"21:00","cost":8000,"latitude":35.6720,"longitude":139.7660}
 ]},
 {"day_number":5,"title":"Akihabara and the Imperial Palace","activities":[
  {"title":"Imperial Palace East Gardens","description":"The old castle keep foundations, free and rarely busy. Closed Mondays and Fridays.","location_name":"Imperial Palace East Gardens","category":"culture","start_time":"09:30","end_time":"11:00","cost":0,"latitude":35.6852,"longitude":139.7528},
  {"title":"Akihabara","description":"Electronics, arcades and eight floors of retro games in Super Potato.","location_name":"Akihabara","category":"shopping","start_time":"11:30","end_time":"14:00","cost":3000,"latitude":35.7022,"longitude":139.7745},
  {"title":"Ramen in Kanda","description":"The district between Akihabara and Tokyo Station is thick with serious ramen.","location_name":"Kanda","category":"food","start_time":"14:00","end_time":"15:00","cost":1100,"latitude":35.6918,"longitude":139.7700},
  {"title":"Tokyo Station and Marunouchi","description":"The restored brick facade, and Character Street underneath for last souvenirs.","location_name":"Tokyo Station","category":"sightseeing","start_time":"15:30","end_time":"17:30","cost":2000,"latitude":35.6812,"longitude":139.7671}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- ROME ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Rome in Four Days',
  'Rome, Italy',
  4,
  'Ancient ruins, Renaissance art, gelato on every corner, and la dolce vita.',
  '🏛️', '#B88A4D', 'EUR',
  '["history","food","culture"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"Ancient Rome","activities":[
  {"title":"Colosseum","description":"Timed entry, booked online. The combined ticket covers the Forum and Palatine for twenty-four hours.","location_name":"Colosseum","category":"culture","start_time":"09:00","end_time":"11:00","cost":18,"latitude":41.8902,"longitude":12.4922},
  {"title":"Roman Forum","description":"Enter from Via dei Fori Imperiali and walk down the Via Sacra.","location_name":"Roman Forum","category":"culture","start_time":"11:15","end_time":"13:00","cost":0,"latitude":41.8925,"longitude":12.4853},
  {"title":"Lunch in Monti","description":"The neighbourhood just north of the Forum, and far better value than anything facing it.","location_name":"Monti","category":"food","start_time":"13:15","end_time":"14:45","cost":25,"latitude":41.8950,"longitude":12.4920},
  {"title":"Palatine Hill","description":"Where the emperors lived, and the best view down into the Forum.","location_name":"Palatine Hill","category":"culture","start_time":"15:00","end_time":"17:00","cost":0,"latitude":41.8892,"longitude":12.4875},
  {"title":"Dinner in Monti","description":"Cacio e pepe, carbonara, amatriciana. The Roman four are all pasta and all cheap.","location_name":"Monti","category":"food","start_time":"20:00","end_time":"22:00","cost":35,"latitude":41.8940,"longitude":12.4910}
 ]},
 {"day_number":2,"title":"Vatican City","activities":[
  {"title":"Vatican Museums and the Sistine Chapel","description":"Book the earliest slot. The route to the chapel is a fixed one-way kilometre and it does not thin out later.","location_name":"Vatican Museums","category":"culture","start_time":"08:00","end_time":"11:30","cost":20,"latitude":41.9065,"longitude":12.4536},
  {"title":"St Peter Basilica","description":"Free to enter, but the security queue wraps the square. Shoulders and knees must be covered.","location_name":"St Peter Basilica","category":"culture","start_time":"11:45","end_time":"13:15","cost":0,"latitude":41.9022,"longitude":12.4539},
  {"title":"Climb the dome","description":"Five hundred and fifty-one steps, and the last stretch leans with the curve of the dome.","location_name":"St Peter Dome","category":"sightseeing","start_time":"13:30","end_time":"14:30","cost":10,"latitude":41.9022,"longitude":12.4534},
  {"title":"Lunch in Prati","description":"North of the Vatican walls, where people who work there eat.","location_name":"Prati","category":"food","start_time":"14:45","end_time":"16:00","cost":22,"latitude":41.9090,"longitude":12.4650},
  {"title":"Castel Sant Angelo at dusk","description":"Hadrian tomb, then a papal fortress. The bridge in front is the photograph.","location_name":"Castel Sant Angelo","category":"culture","start_time":"17:00","end_time":"18:30","cost":15,"latitude":41.9031,"longitude":12.4663}
 ]},
 {"day_number":3,"title":"Baroque Rome on foot","activities":[
  {"title":"Trevi Fountain","description":"Before eight or after eleven at night. Any other hour it is four deep.","location_name":"Trevi Fountain","category":"sightseeing","start_time":"07:30","end_time":"08:15","cost":0,"latitude":41.9009,"longitude":12.4833},
  {"title":"Pantheon","description":"Nearly two thousand years old and still the largest unreinforced concrete dome on Earth.","location_name":"Pantheon","category":"culture","start_time":"09:00","end_time":"10:00","cost":5,"latitude":41.8986,"longitude":12.4769},
  {"title":"Piazza Navona","description":"Built on the shape of a stadium, with Bernini rivers fountain in the middle.","location_name":"Piazza Navona","category":"sightseeing","start_time":"10:15","end_time":"11:15","cost":0,"latitude":41.8992,"longitude":12.4731},
  {"title":"Campo de Fiori market","description":"A produce market by morning and a drinking square by night.","location_name":"Campo de Fiori","category":"food","start_time":"11:30","end_time":"13:00","cost":20,"latitude":41.8955,"longitude":12.4722},
  {"title":"Spanish Steps and Villa Borghese","description":"Climb the steps to the Pincio terrace for the view back over the rooftops.","location_name":"Spanish Steps","category":"sightseeing","start_time":"15:00","end_time":"17:30","cost":0,"latitude":41.9058,"longitude":12.4823}
 ]},
 {"day_number":4,"title":"Trastevere and the Borghese","activities":[
  {"title":"Galleria Borghese","description":"Two-hour timed slots, strictly enforced, and it must be booked. Bernini sculptures are the reason to go.","location_name":"Galleria Borghese","category":"culture","start_time":"09:00","end_time":"11:00","cost":15,"latitude":41.9142,"longitude":12.4922},
  {"title":"Villa Borghese gardens","description":"Walk south through the park to the Pincio and down into the city.","location_name":"Villa Borghese","category":"nature","start_time":"11:00","end_time":"12:30","cost":0,"latitude":41.9130,"longitude":12.4850},
  {"title":"Lunch and wander in Trastevere","description":"Cobbles, ivy and washing lines. The oldest continuously lived-in part of Rome.","location_name":"Trastevere","category":"food","start_time":"13:30","end_time":"15:30","cost":28,"latitude":41.8896,"longitude":12.4695},
  {"title":"Santa Maria in Trastevere","description":"Twelfth-century gold mosaics, and one of the first churches in Rome.","location_name":"Basilica di Santa Maria in Trastevere","category":"culture","start_time":"15:45","end_time":"16:30","cost":0,"latitude":41.8894,"longitude":12.4696},
  {"title":"Last dinner in Trastevere","description":"Eat late. Nine is normal and eight marks you as a visitor.","location_name":"Trastevere","category":"food","start_time":"21:00","end_time":"23:00","cost":40,"latitude":41.8890,"longitude":12.4700}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- BALI ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Bali in Five Days',
  'Bali, Indonesia',
  5,
  'Lush rice terraces, sacred temples, stunning beaches, and spiritual healing experiences.',
  '🌴', '#4A8C2A', 'IDR',
  '["nature","relaxation","adventure"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"Arrival and Seminyak","activities":[
  {"title":"Airport to Seminyak","description":"Roughly forty minutes without traffic and ninety with it. Use Grab or a hotel car.","location_name":"Ngurah Rai International Airport","category":"transport","start_time":"11:00","end_time":"12:00","cost":150000,"latitude":-8.7482,"longitude":115.1672},
  {"title":"Seminyak Beach","description":"Wide grey sand and a reliable sunset. Swim between the flags; the rip is real.","location_name":"Seminyak Beach","category":"relaxation","start_time":"14:00","end_time":"17:00","cost":0,"latitude":-8.6917,"longitude":115.1589},
  {"title":"Sunset at Petitenget Temple","description":"A sea temple at the north end of the beach, quieter than the bars either side.","location_name":"Pura Petitenget","category":"culture","start_time":"17:30","end_time":"18:30","cost":20000,"latitude":-8.6800,"longitude":115.1520},
  {"title":"Dinner on Jalan Kayu Aya","description":"Seminyak restaurant strip, from warungs to serious kitchens.","location_name":"Jalan Kayu Aya","category":"food","start_time":"19:30","end_time":"21:30","cost":250000,"latitude":-8.6850,"longitude":115.1550}
 ]},
 {"day_number":2,"title":"Ubud","activities":[
  {"title":"Drive to Ubud","description":"About ninety minutes north. Move base here rather than day-tripping twice.","location_name":"Ubud","category":"transport","start_time":"08:00","end_time":"09:30","cost":300000,"latitude":-8.5069,"longitude":115.2625},
  {"title":"Tegallalang Rice Terraces","description":"Go before ten. The terraces are working farmland and each landowner charges a small fee at their steps.","location_name":"Tegallalang Rice Terraces","category":"nature","start_time":"10:00","end_time":"12:00","cost":50000,"latitude":-8.4318,"longitude":115.2790},
  {"title":"Sacred Monkey Forest Sanctuary","description":"Long-tailed macaques and three temples in a banyan forest. Carry nothing loose or shiny.","location_name":"Sacred Monkey Forest Sanctuary","category":"nature","start_time":"14:00","end_time":"15:30","cost":80000,"latitude":-8.5192,"longitude":115.2586},
  {"title":"Campuhan Ridge Walk","description":"An easy two-kilometre spine between two river valleys. Best in the last hour of light.","location_name":"Campuhan Ridge Walk","category":"nature","start_time":"16:30","end_time":"18:00","cost":0,"latitude":-8.5052,"longitude":115.2545},
  {"title":"Dinner in central Ubud","description":"Try babi guling or bebek betutu at a proper warung rather than a tourist cafe.","location_name":"Ubud","category":"food","start_time":"19:00","end_time":"21:00","cost":180000,"latitude":-8.5069,"longitude":115.2625}
 ]},
 {"day_number":3,"title":"Temples and the volcano","activities":[
  {"title":"Tirta Empul","description":"A holy spring where Balinese Hindus bathe. You may join the purification with a sarong and a guide.","location_name":"Pura Tirta Empul","category":"culture","start_time":"08:30","end_time":"10:30","cost":75000,"latitude":-8.4156,"longitude":115.3153},
  {"title":"Kintamani and Mount Batur","description":"The caldera rim, with the volcano and its lake below. Lunch here is about the view.","location_name":"Kintamani","category":"nature","start_time":"11:30","end_time":"13:30","cost":150000,"latitude":-8.2422,"longitude":115.3753},
  {"title":"Tegenungan Waterfall","description":"On the way back to Ubud. Steep steps down and a swimmable pool at the bottom.","location_name":"Tegenungan Waterfall","category":"adventure","start_time":"15:00","end_time":"16:30","cost":20000,"latitude":-8.5754,"longitude":115.2887},
  {"title":"Balinese massage","description":"Two hours for what a hotel spa charges for twenty minutes. Book ahead in high season.","location_name":"Ubud","category":"relaxation","start_time":"17:30","end_time":"19:00","cost":200000,"latitude":-8.5069,"longitude":115.2625}
 ]},
 {"day_number":4,"title":"The east","activities":[
  {"title":"Lempuyang Gates of Heaven","description":"Two hours each way, and the mirror in the famous photograph is held by the photographer. Go for the temple, not the picture.","location_name":"Pura Lempuyang Luhur","category":"culture","start_time":"07:00","end_time":"11:00","cost":100000,"latitude":-8.3925,"longitude":115.6314},
  {"title":"Tirta Gangga water palace","description":"Stepping stones across carp ponds, built by the last raja of Karangasem.","location_name":"Tirta Gangga","category":"culture","start_time":"11:30","end_time":"13:00","cost":50000,"latitude":-8.4123,"longitude":115.5871},
  {"title":"Lunch in Amlapura","description":"Local warungs, no menus in English, and a fraction of Ubud prices.","location_name":"Amlapura","category":"food","start_time":"13:15","end_time":"14:15","cost":60000,"latitude":-8.4489,"longitude":115.6083},
  {"title":"Return to the south coast","description":"Long drive. Move base to Uluwatu for the last night.","location_name":"Uluwatu","category":"transport","start_time":"15:00","end_time":"18:00","cost":400000,"latitude":-8.8291,"longitude":115.0849}
 ]},
 {"day_number":5,"title":"Uluwatu","activities":[
  {"title":"Padang Padang Beach","description":"Down through a cleft in the rock. Small, sheltered and busy by noon.","location_name":"Padang Padang Beach","category":"relaxation","start_time":"09:00","end_time":"12:00","cost":15000,"latitude":-8.8106,"longitude":115.1027},
  {"title":"Lunch on the cliffs","description":"Warungs along the Uluwatu road with the Indian Ocean below them.","location_name":"Uluwatu","category":"food","start_time":"12:30","end_time":"14:00","cost":150000,"latitude":-8.8200,"longitude":115.0900},
  {"title":"Uluwatu Temple","description":"On a seventy-metre cliff. The resident monkeys take sunglasses and will trade them back for fruit.","location_name":"Pura Luhur Uluwatu","category":"culture","start_time":"16:30","end_time":"17:45","cost":50000,"latitude":-8.8291,"longitude":115.0849},
  {"title":"Kecak fire dance at sunset","description":"Performed in the cliff amphitheatre as the sun goes down. Buy the ticket on arrival at the temple.","location_name":"Uluwatu Temple Amphitheatre","category":"culture","start_time":"18:00","end_time":"19:00","cost":150000,"latitude":-8.8295,"longitude":115.0845},
  {"title":"Seafood at Jimbaran Bay","description":"Tables on the sand, fish picked from ice. Agree the price per kilo before they cook it.","location_name":"Jimbaran Bay","category":"food","start_time":"20:00","end_time":"22:00","cost":350000,"latitude":-8.7906,"longitude":115.1650}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- DUBAI ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Dubai in Four Days',
  'Dubai, UAE',
  4,
  'Futuristic skyline, desert safaris, world-class shopping, and over-the-top luxury.',
  '🏙️', '#DAA520', 'AED',
  '["luxury","shopping","adventure"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"Downtown","activities":[
  {"title":"Burj Khalifa At the Top","description":"Levels 124 and 125. Book a slot in the hour before sunset and pay less by booking online.","location_name":"Burj Khalifa","category":"sightseeing","start_time":"16:00","end_time":"17:30","cost":169,"latitude":25.1972,"longitude":55.2744},
  {"title":"Dubai Mall","description":"Twelve hundred shops, an aquarium and an ice rink. Treat it as a district, not a shop.","location_name":"The Dubai Mall","category":"shopping","start_time":"17:30","end_time":"19:30","cost":200,"latitude":25.1975,"longitude":55.2796},
  {"title":"Dubai Fountain","description":"Every thirty minutes after six. Free, and best from the waterfront promenade.","location_name":"The Dubai Fountain","category":"sightseeing","start_time":"19:30","end_time":"20:00","cost":0,"latitude":25.1955,"longitude":55.2748},
  {"title":"Dinner at Souk Al Bahar","description":"Across the bridge from the mall, with the fountain and the tower in the same view.","location_name":"Souk Al Bahar","category":"food","start_time":"20:15","end_time":"22:00","cost":250,"latitude":25.1946,"longitude":55.2740}
 ]},
 {"day_number":2,"title":"Old Dubai","activities":[
  {"title":"Al Fahidi Historical District","description":"Wind-tower houses and lanes from before the oil. The one part of the city that is genuinely old.","location_name":"Al Fahidi Historical Neighbourhood","category":"culture","start_time":"09:00","end_time":"10:30","cost":0,"latitude":25.2637,"longitude":55.2972},
  {"title":"Dubai Museum at Al Fahidi Fort","description":"The 1787 fort, and the city photographed decade by decade as it changed.","location_name":"Dubai Museum","category":"culture","start_time":"10:30","end_time":"11:30","cost":3,"latitude":25.2632,"longitude":55.2972},
  {"title":"Abra across Dubai Creek","description":"A wooden ferry, one dirham, and still how thousands of people commute.","location_name":"Bur Dubai Abra Station","category":"transport","start_time":"11:45","end_time":"12:00","cost":1,"latitude":25.2632,"longitude":55.2977},
  {"title":"Gold and Spice Souks","description":"Deira side. Haggling is expected in both and gold is sold by weight at the daily rate.","location_name":"Gold Souk","category":"shopping","start_time":"12:00","end_time":"14:00","cost":100,"latitude":25.2697,"longitude":55.2971},
  {"title":"Lunch in Deira","description":"Iranian and Pakistani kitchens, and the best value food in the city.","location_name":"Deira","category":"food","start_time":"14:00","end_time":"15:00","cost":45,"latitude":25.2690,"longitude":55.3090}
 ]},
 {"day_number":3,"title":"The desert","activities":[
  {"title":"Desert safari pickup","description":"Hotel pickup mid-afternoon. Dune bashing is not for anyone prone to motion sickness.","location_name":"Dubai","category":"transport","start_time":"14:30","end_time":"15:30","cost":0,"latitude":25.2048,"longitude":55.2708},
  {"title":"Dune bashing in Al Marmoom","description":"Forty minutes of four-wheel drives over the red dunes south-east of the city.","location_name":"Al Marmoom Desert Conservation Reserve","category":"adventure","start_time":"15:30","end_time":"17:00","cost":250,"latitude":24.8500,"longitude":55.4500},
  {"title":"Camel ride and sandboarding","description":"At the camp, before the light goes. Both are included in most safari packages.","location_name":"Al Marmoom Desert Camp","category":"adventure","start_time":"17:00","end_time":"18:30","cost":0,"latitude":24.8500,"longitude":55.4500},
  {"title":"Bedouin camp dinner","description":"Grilled buffet, shisha and tanoura dancing under the dark. Away from the city the stars are actually visible.","location_name":"Al Marmoom Desert Camp","category":"food","start_time":"19:00","end_time":"21:30","cost":0,"latitude":24.8500,"longitude":55.4500}
 ]},
 {"day_number":4,"title":"The Palm and the Marina","activities":[
  {"title":"The View at The Palm","description":"Level 52 of Palm Tower, and the only place the palm shape reads as a palm.","location_name":"The View at The Palm","category":"sightseeing","start_time":"10:00","end_time":"11:30","cost":100,"latitude":25.1122,"longitude":55.1390},
  {"title":"Atlantis and the Lost Chambers","description":"Ruins-themed aquarium at the head of the Palm. Aquaventure next door if you want the water park.","location_name":"Atlantis The Palm","category":"sightseeing","start_time":"12:00","end_time":"14:00","cost":135,"latitude":25.1304,"longitude":55.1171},
  {"title":"Kite Beach and Burj Al Arab","description":"Public beach with the sail hotel in the frame. Free, with showers and food trucks.","location_name":"Kite Beach","category":"relaxation","start_time":"15:00","end_time":"17:30","cost":0,"latitude":25.1412,"longitude":55.1930},
  {"title":"Dubai Marina walk","description":"Seven kilometres of waterfront under the towers. Dhow cruises leave from the far end.","location_name":"Dubai Marina","category":"sightseeing","start_time":"18:30","end_time":"21:00","cost":150,"latitude":25.0805,"longitude":55.1403}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- JAIPUR ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Jaipur in Four Days',
  'Jaipur, Rajasthan, India',
  4,
  'The Pink City — majestic forts, vibrant bazaars, spicy curries, and royal heritage.',
  '🐘', '#E75480', 'INR',
  '["history","culture","shopping"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"The walled city","activities":[
  {"title":"Hawa Mahal","description":"The honeycomb facade is best photographed from the cafe rooftops opposite, early, with the sun on it.","location_name":"Hawa Mahal","category":"culture","start_time":"08:30","end_time":"09:30","cost":200,"latitude":26.9239,"longitude":75.8267},
  {"title":"City Palace","description":"Still partly the residence of the royal family. The Chandra Mahal courtyards and the textile gallery are the highlights.","location_name":"City Palace Jaipur","category":"culture","start_time":"10:00","end_time":"12:00","cost":700,"latitude":26.9255,"longitude":75.8236},
  {"title":"Jantar Mantar","description":"Eighteenth-century stone astronomical instruments, including the largest sundial in the world. Accurate to two seconds.","location_name":"Jantar Mantar","category":"culture","start_time":"12:15","end_time":"13:15","cost":200,"latitude":26.9247,"longitude":75.8246},
  {"title":"Lunch on MI Road","description":"Laxmi Misthan Bhandar for a Rajasthani thali, or Rawat for pyaaz kachori.","location_name":"MI Road","category":"food","start_time":"13:30","end_time":"14:45","cost":350,"latitude":26.9157,"longitude":75.8145},
  {"title":"Johari Bazaar","description":"The jewellery bazaar. Gemstone cutting has been the city trade for three hundred years.","location_name":"Johari Bazaar","category":"shopping","start_time":"16:00","end_time":"18:30","cost":1000,"latitude":26.9196,"longitude":75.8262}
 ]},
 {"day_number":2,"title":"Amber and the northern forts","activities":[
  {"title":"Amber Fort","description":"Be at the gate for eight. The Sheesh Mahal mirror hall and the Ganesh Pol are why people come.","location_name":"Amber Fort","category":"culture","start_time":"08:00","end_time":"10:30","cost":500,"latitude":26.9855,"longitude":75.8513},
  {"title":"Panna Meena ka Kund","description":"A sixteenth-century stepwell five minutes from the fort, and almost always empty.","location_name":"Panna Meena ka Kund","category":"culture","start_time":"10:45","end_time":"11:30","cost":0,"latitude":26.9878,"longitude":75.8547},
  {"title":"Jaigarh Fort","description":"Above Amber, connected by a fortified passage, and home to Jaivana — once the largest cannon on wheels anywhere.","location_name":"Jaigarh Fort","category":"culture","start_time":"11:45","end_time":"13:15","cost":200,"latitude":26.9855,"longitude":75.8460},
  {"title":"Lunch near Amber","description":"Dal baati churma at one of the roadside dhabas on the Delhi road.","location_name":"Amer","category":"food","start_time":"13:30","end_time":"14:30","cost":300,"latitude":26.9800,"longitude":75.8500},
  {"title":"Jal Mahal at sunset","description":"A palace standing in Man Sagar lake, four storeys of which are underwater. Viewed from the bank only.","location_name":"Jal Mahal","category":"sightseeing","start_time":"17:30","end_time":"18:30","cost":0,"latitude":26.9535,"longitude":75.8462}
 ]},
 {"day_number":3,"title":"Nahargarh and the museums","activities":[
  {"title":"Albert Hall Museum","description":"Indo-Saracenic, built for the Prince of Wales in 1876, and the oldest museum in the state.","location_name":"Albert Hall Museum","category":"culture","start_time":"09:30","end_time":"11:00","cost":300,"latitude":26.9117,"longitude":75.8194},
  {"title":"Birla Mandir","description":"White marble, and at its best in the last hour of daylight when it is lit.","location_name":"Birla Mandir Jaipur","category":"culture","start_time":"11:30","end_time":"12:30","cost":0,"latitude":26.8938,"longitude":75.8153},
  {"title":"Anokhi Museum of Hand Printing","description":"In a restored haveli near Amber. Block printing demonstrated by the printers themselves.","location_name":"Anokhi Museum of Hand Printing","category":"culture","start_time":"14:00","end_time":"15:30","cost":100,"latitude":26.9899,"longitude":75.8508},
  {"title":"Nahargarh Fort at sunset","description":"On the ridge above the city. The whole grid of Jaipur lays out below and turns pink as the light drops.","location_name":"Nahargarh Fort","category":"sightseeing","start_time":"17:00","end_time":"19:00","cost":200,"latitude":26.9374,"longitude":75.8153},
  {"title":"Dinner at Padao","description":"The open terrace restaurant at Nahargarh, eating with the view you just walked up for.","location_name":"Nahargarh Fort","category":"food","start_time":"19:00","end_time":"20:30","cost":800,"latitude":26.9374,"longitude":75.8153}
 ]},
 {"day_number":4,"title":"Crafts and a village evening","activities":[
  {"title":"Sisodia Rani Garden","description":"Terraced Mughal gardens with painted murals, on the Agra road east of the city.","location_name":"Sisodia Rani Ka Bagh","category":"nature","start_time":"09:30","end_time":"10:45","cost":50,"latitude":26.8836,"longitude":75.8722},
  {"title":"Blue pottery workshop","description":"A Jaipur craft that uses no clay at all. Several Sanganer workshops take visitors.","location_name":"Sanganer","category":"culture","start_time":"11:30","end_time":"13:00","cost":500,"latitude":26.8158,"longitude":75.7906},
  {"title":"Bapu Bazaar","description":"Textiles, juttis and camel-leather. Cheaper and less pressured than Johari.","location_name":"Bapu Bazaar","category":"shopping","start_time":"14:30","end_time":"16:30","cost":1500,"latitude":26.9166,"longitude":75.8207},
  {"title":"Chokhi Dhani","description":"A recreated Rajasthani village twenty kilometres south. Folk dance, puppetry and an unlimited thali.","location_name":"Chokhi Dhani","category":"culture","start_time":"18:00","end_time":"21:30","cost":1100,"latitude":26.7576,"longitude":75.8095}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- GOA ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Goa in Four Days',
  'Goa, India',
  4,
  'Beaches north and south, Portuguese churches, spice plantations, and the best seafood on the Konkan coast.',
  '🏖️', '#00A5A5', 'INR',
  '["beach","nightlife","heritage"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"North Goa beaches","activities":[
  {"title":"Calangute and Baga","description":"The busiest stretch in the state. Shacks, water sports and a lot of people.","location_name":"Baga Beach","category":"relaxation","start_time":"10:00","end_time":"13:00","cost":500,"latitude":15.5553,"longitude":73.7517},
  {"title":"Lunch at a beach shack","description":"Fish thali, or whatever came in that morning. Ask what is fresh rather than reading the menu.","location_name":"Baga Beach","category":"food","start_time":"13:00","end_time":"14:30","cost":700,"latitude":15.5545,"longitude":73.7520},
  {"title":"Fort Aguada","description":"A 1612 Portuguese fort above the Mandovi mouth, with the lighthouse and the freshwater cistern that named it.","location_name":"Fort Aguada","category":"culture","start_time":"16:00","end_time":"17:30","cost":50,"latitude":15.4926,"longitude":73.7736},
  {"title":"Sunset at Sinquerim","description":"Below the fort, and calmer water than Baga.","location_name":"Sinquerim Beach","category":"relaxation","start_time":"17:30","end_time":"18:45","cost":0,"latitude":15.4989,"longitude":73.7669},
  {"title":"Tito Lane","description":"The centre of Goa nightlife, for better and worse. Clubs fill after eleven.","location_name":"Tito Lane","category":"nightlife","start_time":"21:30","end_time":"01:00","cost":2000,"latitude":15.5556,"longitude":73.7519}
 ]},
 {"day_number":2,"title":"Old Goa and Panjim","activities":[
  {"title":"Basilica of Bom Jesus","description":"A UNESCO site holding the remains of St Francis Xavier. The laterite facade has never been plastered.","location_name":"Basilica of Bom Jesus","category":"culture","start_time":"09:30","end_time":"10:45","cost":0,"latitude":15.5009,"longitude":73.9116},
  {"title":"Se Cathedral","description":"The largest church in Asia, and the Golden Bell in the surviving tower is the biggest in Goa.","location_name":"Se Cathedral","category":"culture","start_time":"10:45","end_time":"11:45","cost":0,"latitude":15.5031,"longitude":73.9119},
  {"title":"Lunch in Panjim","description":"Goan Catholic cooking — pork vindaloo, sorpotel, xacuti. Ritz Classic or Viva Panjim.","location_name":"Panaji","category":"food","start_time":"12:30","end_time":"14:00","cost":600,"latitude":15.4989,"longitude":73.8278},
  {"title":"Fontainhas Latin Quarter","description":"Ochre and blue Portuguese houses on narrow lanes. The oldest Latin quarter in Asia and best walked slowly.","location_name":"Fontainhas","category":"culture","start_time":"14:30","end_time":"16:30","cost":0,"latitude":15.4989,"longitude":73.8318},
  {"title":"Mandovi river cruise","description":"An hour at sunset with folk dance on deck. Leaves from the Santa Monica jetty.","location_name":"Santa Monica Jetty","category":"sightseeing","start_time":"18:00","end_time":"19:00","cost":400,"latitude":15.4970,"longitude":73.8280}
 ]},
 {"day_number":3,"title":"Spice country and the falls","activities":[
  {"title":"Dudhsagar Falls","description":"A three-hundred-metre fall on the Mandovi, inside Bhagwan Mahaveer sanctuary. Only reachable by booked jeep from Kulem.","location_name":"Dudhsagar Falls","category":"adventure","start_time":"08:00","end_time":"13:00","cost":1500,"latitude":15.3144,"longitude":74.3143},
  {"title":"Spice plantation lunch","description":"Sahakari or Tropical near Ponda. A guided walk through cardamom, vanilla and areca, then a buffet on banana leaf.","location_name":"Ponda","category":"food","start_time":"14:00","end_time":"16:00","cost":900,"latitude":15.4027,"longitude":74.0078},
  {"title":"Chapora Fort","description":"The ruin on the headland above Vagator. Empty walls and a long view down the coast.","location_name":"Chapora Fort","category":"culture","start_time":"17:30","end_time":"18:30","cost":0,"latitude":15.6033,"longitude":73.7368},
  {"title":"Dinner at Vagator","description":"Cliff-top places above Ozran, quieter than Baga and better food.","location_name":"Vagator Beach","category":"food","start_time":"19:30","end_time":"21:30","cost":1200,"latitude":15.5989,"longitude":73.7390}
 ]},
 {"day_number":4,"title":"South Goa","activities":[
  {"title":"Drive south to Palolem","description":"About two hours down the coast. The south is a different Goa — quieter, greener, far fewer people.","location_name":"Palolem","category":"transport","start_time":"08:30","end_time":"10:30","cost":2000,"latitude":15.0100,"longitude":74.0233},
  {"title":"Palolem Beach","description":"A crescent bay closed at both ends by headlands. Kayaks for hire and calm water.","location_name":"Palolem Beach","category":"relaxation","start_time":"10:30","end_time":"13:30","cost":300,"latitude":15.0100,"longitude":74.0233},
  {"title":"Lunch on the sand","description":"Shack kitchens the length of the bay. Butter garlic crab if it is on.","location_name":"Palolem Beach","category":"food","start_time":"13:30","end_time":"15:00","cost":800,"latitude":15.0105,"longitude":74.0230},
  {"title":"Cabo de Rama Fort","description":"Cliff-edge ruins on the way back north, and almost nobody there. The sunset from the wall is the best in the state.","location_name":"Cabo de Rama Fort","category":"culture","start_time":"17:00","end_time":"18:45","cost":0,"latitude":15.0894,"longitude":73.9203}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- KERALA ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Kerala in Five Days',
  'Kochi to Munnar to Alleppey, Kerala, India',
  5,
  'Colonial Kochi, tea country in the Western Ghats, and a night on the Alleppey backwaters.',
  '🛶', '#1B7A5A', 'INR',
  '["nature","food","relaxation"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"Fort Kochi","activities":[
  {"title":"Chinese fishing nets","description":"Cantilevered shore nets brought by traders from Kublai Khan court. Best worked at dawn and dusk.","location_name":"Chinese Fishing Nets Fort Kochi","category":"sightseeing","start_time":"08:00","end_time":"09:00","cost":0,"latitude":9.9668,"longitude":76.2420},
  {"title":"St Francis Church","description":"The oldest European church in India, 1503. Vasco da Gama was buried here for fourteen years.","location_name":"St Francis Church Kochi","category":"culture","start_time":"09:15","end_time":"10:00","cost":0,"latitude":9.9648,"longitude":76.2422},
  {"title":"Mattancherry Palace and Jew Town","description":"Sixteenth-century murals in the palace, then the spice warehouses and the Paradesi Synagogue.","location_name":"Mattancherry Palace","category":"culture","start_time":"10:30","end_time":"12:30","cost":50,"latitude":9.9578,"longitude":76.2596},
  {"title":"Seafood lunch at the nets","description":"Buy the fish at the stalls by the nets and the kitchens behind them will cook it for a fee.","location_name":"Fort Kochi","category":"food","start_time":"13:00","end_time":"14:30","cost":600,"latitude":9.9660,"longitude":76.2425},
  {"title":"Kathakali performance","description":"Arrive an hour early to watch the makeup applied. Kerala Kathakali Centre explains the mudras first.","location_name":"Kerala Kathakali Centre","category":"culture","start_time":"17:00","end_time":"19:30","cost":500,"latitude":9.9658,"longitude":76.2430}
 ]},
 {"day_number":2,"title":"Up to the tea country","activities":[
  {"title":"Drive Kochi to Munnar","description":"About one hundred and thirty kilometres and four hours, climbing sixteen hundred metres. The last hour is continuous hairpins.","location_name":"Kochi to Munnar road","category":"transport","start_time":"08:00","end_time":"12:00","cost":4000,"latitude":10.0500,"longitude":76.8000},
  {"title":"Cheeyappara and Valara waterfalls","description":"Roadside stops on the ascent, both signposted on NH85.","location_name":"Cheeyappara Waterfalls","category":"nature","start_time":"10:30","end_time":"11:15","cost":0,"latitude":10.0100,"longitude":76.9500},
  {"title":"Lunch in Munnar town","description":"Kerala meals on banana leaf — rice, sambar, thoran, avial, pickle, payasam.","location_name":"Munnar","category":"food","start_time":"12:30","end_time":"13:30","cost":250,"latitude":10.0889,"longitude":77.0595},
  {"title":"Tea Museum at Nallathanni","description":"The Tata estate museum. Working rollers and driers, and the processing explained end to end.","location_name":"Kannan Devan Tea Museum","category":"culture","start_time":"14:30","end_time":"16:00","cost":175,"latitude":10.0950,"longitude":77.0530},
  {"title":"Sunset over the estates","description":"Any bend on the Mattupetty road. The hills go blue-green as the light flattens.","location_name":"Mattupetty Road","category":"nature","start_time":"17:30","end_time":"18:30","cost":0,"latitude":10.1000,"longitude":77.1100}
 ]},
 {"day_number":3,"title":"Munnar","activities":[
  {"title":"Eravikulam National Park","description":"The last stronghold of the Nilgiri tahr. Book online; entry is by timed bus from Rajamalai and it fills.","location_name":"Eravikulam National Park","category":"nature","start_time":"08:00","end_time":"11:00","cost":200,"latitude":10.1919,"longitude":77.0472},
  {"title":"Mattupetty Dam and Echo Point","description":"Boating on the reservoir, with shola forest on the banks.","location_name":"Mattupetty Dam","category":"nature","start_time":"11:45","end_time":"13:30","cost":400,"latitude":10.1042,"longitude":77.1259},
  {"title":"Lunch by the dam","description":"Small places along the road do fish curry and rice.","location_name":"Mattupetty","category":"food","start_time":"13:30","end_time":"14:30","cost":300,"latitude":10.1050,"longitude":77.1250},
  {"title":"Top Station","description":"The highest point on the Munnar road at seventeen hundred metres, looking down into Tamil Nadu.","location_name":"Top Station","category":"sightseeing","start_time":"15:00","end_time":"17:00","cost":50,"latitude":10.2333,"longitude":77.2333},
  {"title":"Ayurvedic massage","description":"Munnar is full of them. Choose a place with a registered practitioner rather than a hotel add-on.","location_name":"Munnar","category":"relaxation","start_time":"18:00","end_time":"19:30","cost":1500,"latitude":10.0889,"longitude":77.0595}
 ]},
 {"day_number":4,"title":"Down to the backwaters","activities":[
  {"title":"Drive Munnar to Alleppey","description":"Around one hundred and seventy kilometres and five hours, back down the ghats and out to the coast.","location_name":"Munnar to Alappuzha road","category":"transport","start_time":"08:00","end_time":"13:00","cost":5000,"latitude":9.8000,"longitude":76.7000},
  {"title":"Board the houseboat","description":"Kettuvallams board at noon and cast off at one. Agree the route before you pay; some never leave the main channel.","location_name":"Alappuzha Houseboat Jetty","category":"accommodation","start_time":"13:00","end_time":"14:00","cost":8000,"latitude":9.4981,"longitude":76.3388},
  {"title":"Cruise the Punnamada backwaters","description":"Through the paddy polders, below sea level, past villages reachable only by water.","location_name":"Punnamada Lake","category":"nature","start_time":"14:00","end_time":"18:00","cost":0,"latitude":9.4900,"longitude":76.3500},
  {"title":"Dinner aboard","description":"Karimeen pollichathu — pearl spot grilled in banana leaf — cooked in the galley as you moor for the night.","location_name":"Alappuzha backwaters","category":"food","start_time":"19:30","end_time":"21:00","cost":0,"latitude":9.4850,"longitude":76.3600}
 ]},
 {"day_number":5,"title":"Alleppey and the coast","activities":[
  {"title":"Sunrise on the water","description":"Mist off the paddy fields and the village waking up. Worth the alarm.","location_name":"Punnamada Lake","category":"nature","start_time":"06:00","end_time":"07:30","cost":0,"latitude":9.4900,"longitude":76.3500},
  {"title":"Disembark at Alappuzha","description":"Houseboats return to the jetty by nine.","location_name":"Alappuzha Houseboat Jetty","category":"transport","start_time":"09:00","end_time":"09:30","cost":0,"latitude":9.4981,"longitude":76.3388},
  {"title":"Marari Beach","description":"A fishing village beach fifteen kilometres north, and empty compared with anywhere in Goa.","location_name":"Marari Beach","category":"relaxation","start_time":"10:30","end_time":"13:00","cost":0,"latitude":9.6167,"longitude":76.3000},
  {"title":"Coir village walk","description":"Alappuzha built its wealth on coconut fibre. The ropewalks and looms still run in the backstreets.","location_name":"Alappuzha","category":"culture","start_time":"14:30","end_time":"16:00","cost":200,"latitude":9.4900,"longitude":76.3300},
  {"title":"Return to Kochi","description":"Roughly ninety minutes north for onward flights.","location_name":"Kochi","category":"transport","start_time":"16:30","end_time":"18:00","cost":2500,"latitude":9.9312,"longitude":76.2673}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- VARANASI ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Varanasi in Three Days',
  'Varanasi, Uttar Pradesh, India',
  3,
  'The ghats at dawn, the evening aarti, and the Buddha first sermon at Sarnath.',
  '🪔', '#B5651D', 'INR',
  '["spiritual","culture","history"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"The ghats","activities":[
  {"title":"Walk the ghats from Assi to Dashashwamedh","description":"About four kilometres along the river, through eighty-odd ghats. The best introduction there is.","location_name":"Assi Ghat","category":"culture","start_time":"15:00","end_time":"17:30","cost":0,"latitude":25.2880,"longitude":83.0060},
  {"title":"Kashi Vishwanath Temple","description":"One of the twelve jyotirlingas. Phones and bags are not allowed inside; use the lockers at the corridor entrance.","location_name":"Kashi Vishwanath Temple","category":"culture","start_time":"17:30","end_time":"18:30","cost":0,"latitude":25.3109,"longitude":83.0107},
  {"title":"Ganga Aarti at Dashashwamedh","description":"Every evening at sunset. Arrive forty minutes early for a step, or hire a boat and watch from the water.","location_name":"Dashashwamedh Ghat","category":"culture","start_time":"18:45","end_time":"20:00","cost":300,"latitude":25.3072,"longitude":83.0104},
  {"title":"Dinner in the old city","description":"Kachori sabzi, tamatar chaat, and a Banarasi paan after. The lanes behind the ghat are full of it.","location_name":"Vishwanath Gali","category":"food","start_time":"20:15","end_time":"21:30","cost":250,"latitude":25.3100,"longitude":83.0100}
 ]},
 {"day_number":2,"title":"Sunrise on the river","activities":[
  {"title":"Sunrise boat ride","description":"Leave from Assi at five thirty and row north with the light coming up behind the ghats. The single thing to do here.","location_name":"Assi Ghat","category":"sightseeing","start_time":"05:30","end_time":"07:30","cost":600,"latitude":25.2880,"longitude":83.0060},
  {"title":"Manikarnika Ghat","description":"The main cremation ghat, burning continuously for centuries. Photography is not acceptable; guides demanding donations are not official.","location_name":"Manikarnika Ghat","category":"culture","start_time":"07:30","end_time":"08:30","cost":0,"latitude":25.3110,"longitude":83.0140},
  {"title":"Breakfast at a ghat cafe","description":"Assi and Shivala have rooftop places looking over the water.","location_name":"Assi Ghat","category":"food","start_time":"09:00","end_time":"10:00","cost":200,"latitude":25.2885,"longitude":83.0065},
  {"title":"Banaras Hindu University and Bharat Kala Bhavan","description":"A campus of thirteen hundred acres. The museum holds Mughal miniatures and early Hindu sculpture.","location_name":"Banaras Hindu University","category":"culture","start_time":"11:00","end_time":"13:30","cost":100,"latitude":25.2677,"longitude":82.9913},
  {"title":"Silk weaving workshop","description":"Banarasi brocade on handlooms in Madanpura. Go with someone local; the showroom circuit is commission-driven.","location_name":"Madanpura","category":"shopping","start_time":"15:30","end_time":"17:30","cost":2000,"latitude":25.3020,"longitude":83.0060}
 ]},
 {"day_number":3,"title":"Sarnath","activities":[
  {"title":"Drive to Sarnath","description":"Thirteen kilometres north-east, about forty minutes in traffic.","location_name":"Sarnath","category":"transport","start_time":"08:30","end_time":"09:15","cost":400,"latitude":25.3811,"longitude":83.0244},
  {"title":"Dhamek Stupa and the deer park","description":"Where the Buddha gave his first sermon after enlightenment. The stupa in its present form is fifth century.","location_name":"Dhamek Stupa","category":"culture","start_time":"09:15","end_time":"10:45","cost":300,"latitude":25.3806,"longitude":83.0244},
  {"title":"Sarnath Archaeological Museum","description":"Holds the Lion Capital of Ashoka — the original of the Indian state emblem.","location_name":"Sarnath Museum","category":"culture","start_time":"11:00","end_time":"12:15","cost":100,"latitude":25.3795,"longitude":83.0220},
  {"title":"Lunch back in the city","description":"A Banarasi thali before the journey on.","location_name":"Varanasi","category":"food","start_time":"13:30","end_time":"14:45","cost":350,"latitude":25.3176,"longitude":82.9739},
  {"title":"Last evening at Assi Ghat","description":"The subah-e-banaras stage does live classical music most evenings.","location_name":"Assi Ghat","category":"culture","start_time":"17:30","end_time":"19:00","cost":0,"latitude":25.2880,"longitude":83.0060}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ---------- LEH LADAKH ----------
INSERT INTO public.trip_templates
  (title, destination, duration_days, description, icon, cover, currency, tags, is_official, itinerary_data)
VALUES (
  'Ladakh in Five Days',
  'Leh, Ladakh, India',
  5,
  'High-altitude desert, Tibetan monasteries, and the road over Khardung La to the Nubra dunes.',
  '🏔️', '#4A6FA5', 'INR',
  '["adventure","nature","photography"]'::jsonb,
  true,
  $json$
{"days":[
 {"day_number":1,"title":"Arrive and acclimatise","activities":[
  {"title":"Land at Leh","description":"Leh is at three thousand five hundred metres. The first twenty-four hours must be spent doing nothing — this is altitude sickness prevention, not a suggestion.","location_name":"Kushok Bakula Rimpochee Airport","category":"transport","start_time":"08:00","end_time":"09:00","cost":0,"latitude":34.1359,"longitude":77.5465},
  {"title":"Rest at the guesthouse","description":"Sleep, drink three litres of water, eat lightly. No exertion and no alcohol.","location_name":"Leh","category":"relaxation","start_time":"09:30","end_time":"16:00","cost":0,"latitude":34.1526,"longitude":77.5771},
  {"title":"Short walk to Leh Market","description":"Flat, slow, and no more than an hour. Gauge how you feel before planning anything.","location_name":"Leh Main Bazaar","category":"shopping","start_time":"16:30","end_time":"17:30","cost":500,"latitude":34.1642,"longitude":77.5847},
  {"title":"Early dinner","description":"Thukpa and momos. Sleep early — the first night is usually a broken one.","location_name":"Leh","category":"food","start_time":"19:00","end_time":"20:00","cost":400,"latitude":34.1640,"longitude":77.5850}
 ]},
 {"day_number":2,"title":"Leh valley monasteries","activities":[
  {"title":"Thiksey Monastery","description":"Twelve storeys stepped up a hill, and a fifteen-metre Maitreya Buddha. The dawn prayers at six are open to visitors.","location_name":"Thiksey Monastery","category":"culture","start_time":"08:00","end_time":"10:00","cost":50,"latitude":34.0555,"longitude":77.6672},
  {"title":"Hemis Monastery","description":"The largest and wealthiest gompa in Ladakh, founded 1630, in a side gorge that hid it from raiders.","location_name":"Hemis Monastery","category":"culture","start_time":"10:45","end_time":"12:30","cost":100,"latitude":33.9125,"longitude":77.7025},
  {"title":"Lunch at Shey","description":"Roadside Ladakhi kitchens between the monasteries.","location_name":"Shey","category":"food","start_time":"13:00","end_time":"14:00","cost":350,"latitude":34.0700,"longitude":77.6300},
  {"title":"Shey Palace and Sindhu Ghat","description":"The old royal seat, and the Indus running below it.","location_name":"Shey Palace","category":"culture","start_time":"14:15","end_time":"15:45","cost":50,"latitude":34.0722,"longitude":77.6300},
  {"title":"Shanti Stupa at sunset","description":"Above Leh, built by Japanese monks in 1991. The whole valley and the Stok range opposite.","location_name":"Shanti Stupa","category":"sightseeing","start_time":"17:30","end_time":"19:00","cost":0,"latitude":34.1655,"longitude":77.5731}
 ]},
 {"day_number":3,"title":"Over Khardung La to Nubra","activities":[
  {"title":"Khardung La pass","description":"Five thousand three hundred and fifty metres. Stop no longer than twenty minutes — the air at the top is thin enough to make people ill.","location_name":"Khardung La","category":"adventure","start_time":"07:00","end_time":"09:30","cost":0,"latitude":34.2779,"longitude":77.6046},
  {"title":"Descend to Diskit","description":"Down the north side into the Shyok valley. Inner Line Permit required and checked at Khardung.","location_name":"Diskit","category":"transport","start_time":"09:30","end_time":"12:30","cost":0,"latitude":34.5539,"longitude":77.5544},
  {"title":"Diskit Monastery and the Maitreya","description":"A thirty-two metre Buddha facing down the valley towards Pakistan, and a gompa from 1420 above it.","location_name":"Diskit Monastery","category":"culture","start_time":"13:30","end_time":"15:00","cost":50,"latitude":34.5406,"longitude":77.5486},
  {"title":"Hunder sand dunes","description":"A cold desert at three thousand metres, with double-humped Bactrian camels left from the Silk Road caravans.","location_name":"Hunder","category":"adventure","start_time":"15:30","end_time":"18:00","cost":500,"latitude":34.5750,"longitude":77.4900},
  {"title":"Night in Nubra","description":"Camps and homestays at Hunder. Clear skies and no light for two hundred kilometres.","location_name":"Hunder","category":"accommodation","start_time":"19:00","end_time":"21:00","cost":3000,"latitude":34.5750,"longitude":77.4900}
 ]},
 {"day_number":4,"title":"Pangong Tso","activities":[
  {"title":"Shyok route to Pangong","description":"Six hours along the river rather than back over Khardung. Rough road, and it closes in bad weather.","location_name":"Shyok Valley Road","category":"transport","start_time":"07:00","end_time":"13:00","cost":0,"latitude":34.3000,"longitude":77.9000},
  {"title":"Pangong Tso","description":"A hundred and thirty-four kilometres of saltwater lake at four thousand three hundred metres, two thirds of it in Tibet. The colour shifts through the day.","location_name":"Pangong Tso","category":"nature","start_time":"13:00","end_time":"18:00","cost":0,"latitude":33.7500,"longitude":78.6667},
  {"title":"Lunch at Spangmik","description":"The permitted village on the shore. Maggi and thukpa, which is the whole menu.","location_name":"Spangmik","category":"food","start_time":"13:30","end_time":"14:30","cost":300,"latitude":33.7833,"longitude":78.6167},
  {"title":"Night at the lake","description":"Tented camps at Spangmik. It drops below freezing even in July, and there is no heating.","location_name":"Spangmik","category":"accommodation","start_time":"19:00","end_time":"21:00","cost":3500,"latitude":33.7833,"longitude":78.6167}
 ]},
 {"day_number":5,"title":"Back to Leh over Chang La","activities":[
  {"title":"Sunrise on Pangong","description":"The reason to have stayed the night. The lake turns from black through violet to turquoise in about forty minutes.","location_name":"Pangong Tso","category":"nature","start_time":"05:30","end_time":"07:00","cost":0,"latitude":33.7833,"longitude":78.6167},
  {"title":"Chang La pass","description":"Five thousand three hundred and sixty metres on the road back. Army canteen at the top serves free tea.","location_name":"Chang La","category":"adventure","start_time":"09:00","end_time":"10:00","cost":0,"latitude":34.0333,"longitude":77.9333},
  {"title":"Druk White Lotus School at Shey","description":"The school from the end of the film Three Idiots, and a serious piece of high-altitude architecture.","location_name":"Druk White Lotus School","category":"culture","start_time":"12:30","end_time":"13:30","cost":100,"latitude":34.0700,"longitude":77.6400},
  {"title":"Leh Palace and the old town","description":"A seventeenth-century nine-storey palace on the model of the Potala, and the restored mud-brick lanes below it.","location_name":"Leh Palace","category":"culture","start_time":"15:00","end_time":"17:00","cost":300,"latitude":34.1657,"longitude":77.5849},
  {"title":"Last dinner in Leh","description":"Apricot everything, and Ladakhi butter tea if you have grown to like it.","location_name":"Leh Main Bazaar","category":"food","start_time":"19:00","end_time":"20:30","cost":600,"latitude":34.1642,"longitude":77.5847}
 ]}
]}
  $json$::jsonb
)
ON CONFLICT (destination) WHERE is_official = true DO UPDATE SET
  title = EXCLUDED.title, duration_days = EXCLUDED.duration_days,
  description = EXCLUDED.description, icon = EXCLUDED.icon, cover = EXCLUDED.cover,
  currency = EXCLUDED.currency, tags = EXCLUDED.tags, itinerary_data = EXCLUDED.itinerary_data;

-- ============================================
-- 6. USING A TEMPLATE
-- ============================================
-- Bumping usage_count needs an UPDATE the caller does not have: the update
-- policy allows created_by = auth.uid(), and official templates have no
-- creator. SECURITY DEFINER, scoped as tightly as it can be — one counter, one
-- official row, no other column reachable.
CREATE OR REPLACE FUNCTION public.bump_template_usage(p_template_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.trip_templates
  SET usage_count = COALESCE(usage_count, 0) + 1
  WHERE id = p_template_id AND is_official = true;
$$;

-- The whole point of this migration. create_trip_with_days writes a trip and
-- its days; this also writes the activities, so a template arrives as a plan
-- rather than an empty calendar.
--
-- SECURITY INVOKER (the default) on purpose, exactly as create_trip_with_days
-- is: RLS still applies to trips, trip_days and activities, so this cannot
-- become a way to write into somebody else's trip.
CREATE OR REPLACE FUNCTION public.create_trip_from_template(
  p_template_id UUID,
  p_start_date DATE
)
RETURNS public.trips
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  tpl public.trip_templates;
  new_trip public.trips;
  day_rec RECORD;
  new_day_id UUID;
  day_total INT := 0;
BEGIN
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'A start date is required';
  END IF;

  SELECT * INTO tpl FROM public.trip_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- Same guarantee create_trip_with_days gives: a trip without days is one the
  -- editor cannot open. Checked before the insert rather than after, so a
  -- template with an empty plan fails cleanly instead of rolling back.
  IF COALESCE(jsonb_array_length(tpl.itinerary_data->'days'), 0) = 0 THEN
    RAISE EXCEPTION 'Template % has no plan to copy', tpl.destination;
  END IF;

  INSERT INTO public.trips (
    user_id, title, destination, start_date, end_date,
    status, currency, ai_preferences
  )
  VALUES (
    -- Not from the payload, for the same reason create_trip_with_days does not
    -- take it: the caller does not choose whose trip this is.
    auth.uid(),
    tpl.title,
    tpl.destination,
    p_start_date,
    p_start_date + (tpl.duration_days - 1),
    'planned',
    COALESCE(NULLIF(tpl.currency, ''), 'USD'),
    jsonb_build_object(
      -- `interests`, not `tags`. The generate route reads
      -- ai_preferences.interests, so a regeneration of any day still knows what
      -- kind of trip this was meant to be.
      'interests', public.template_interests(tpl.tags),
      'from_template', true,
      'template_id', tpl.id
    )
  )
  RETURNING * INTO new_trip;

  FOR day_rec IN
    SELECT
      COALESCE((d->>'day_number')::INT, ord::INT) AS day_number,
      d->>'title'      AS title,
      d->'activities'  AS activities
    FROM jsonb_array_elements(tpl.itinerary_data->'days') WITH ORDINALITY AS t(d, ord)
    ORDER BY ord
  LOOP
    INSERT INTO public.trip_days (trip_id, day_number, date, notes)
    VALUES (
      new_trip.id,
      day_rec.day_number,
      p_start_date + (day_rec.day_number - 1),
      COALESCE(day_rec.title, '')
    )
    RETURNING id INTO new_day_id;

    day_total := day_total + 1;

    INSERT INTO public.activities (
      trip_day_id, title, description, location_name, category,
      start_time, end_time, cost, currency, latitude, longitude, order_index
    )
    SELECT
      new_day_id,
      a->>'title',
      COALESCE(a->>'description', ''),
      COALESCE(a->>'location_name', ''),
      COALESCE(a->>'category', 'other'),
      NULLIF(a->>'start_time', '')::TIME,
      NULLIF(a->>'end_time', '')::TIME,
      COALESCE((a->>'cost')::NUMERIC, 0),
      new_trip.currency,
      NULLIF(a->>'latitude', '')::DOUBLE PRECISION,
      NULLIF(a->>'longitude', '')::DOUBLE PRECISION,
      (ord - 1)::INT
    FROM jsonb_array_elements(COALESCE(day_rec.activities, '[]'::jsonb))
         WITH ORDINALITY AS t(a, ord);
  END LOOP;

  -- duration_days drives the end_date while the plan drives the days. If they
  -- ever disagree the trip has a date range that does not match its contents,
  -- so refuse rather than ship a trip with a phantom final day.
  IF day_total <> tpl.duration_days THEN
    RAISE EXCEPTION 'Template % claims % days but its plan has %',
      tpl.destination, tpl.duration_days, day_total;
  END IF;

  PERFORM public.bump_template_usage(tpl.id);

  RETURN new_trip;
END;
$$;

-- Anonymous visitors may read templates; they may not create trips from them,
-- because a trip needs an owner.
GRANT EXECUTE ON FUNCTION public.create_trip_from_template(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.template_interests(JSONB) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_template_usage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_template_usage(UUID) TO authenticated;

COMMENT ON FUNCTION public.create_trip_from_template(UUID, DATE) IS
  'Copies an official template into a new trip — days and activities included — in a single transaction.';

-- ============================================
-- 7. VERIFY
-- ============================================
-- Fails the migration rather than leaving a template that would break on use.
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(destination || ' (' || duration_days || ' vs ' ||
                    COALESCE(jsonb_array_length(itinerary_data->'days'), 0) || ')', ', ')
  INTO bad
  FROM public.trip_templates
  WHERE is_official = true
    AND duration_days <> COALESCE(jsonb_array_length(itinerary_data->'days'), 0);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Templates whose duration does not match their plan: %', bad;
  END IF;

  RAISE NOTICE 'Seeded % official templates.',
    (SELECT COUNT(*) FROM public.trip_templates WHERE is_official = true);
END;
$$;

NOTIFY pgrst, 'reload schema';
