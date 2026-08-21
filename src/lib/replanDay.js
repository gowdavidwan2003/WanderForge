import { geocodeBatch } from '@/lib/geocodeClient';
import { normalizeCategory } from '@/lib/itineraryPrompt';
import { validateItinerary } from '@/lib/itinerarySchema';

/**
 * Re-plan one day and write it back.
 *
 * Adding activities one at a time — whether from the AI chat, the nearby picker,
 * or by hand — cannot produce a coherent schedule, because each insert only sees
 * itself. This rebuilds the whole day around everything currently in it, applying
 * the same realism rules as full generation.
 *
 * The write is the part that used to be dangerous. It deleted the whole day and
 * then inserted the replacement one row at a time, from the browser, across two
 * PostgREST requests — which are two transactions however carefully they are
 * sequenced. A Groq timeout, a closed laptop or a dropped connection between them
 * left the day destroyed with nothing to put back, and the function still
 * reported success as long as the delete had worked.
 *
 * Now: nothing is sent until a validated plan is in hand, the delete and the
 * inserts happen inside one Postgres function, and a failure anywhere leaves the
 * original day exactly as it was. The caller also gets a snapshot back, so the
 * replan can be undone even after it succeeds.
 *
 * @param supabase   browser Supabase client (RLS applies)
 * @param trip       trip row
 * @param day        trip_days row
 * @param keep       activities currently on the day (all will be preserved)
 * @param mustInclude places not yet saved that must appear (used by the chat flow)
 */
export async function replanDay(supabase, { trip, day, keep = [], mustInclude = [] }) {
  if (!day) return { ok: false, error: 'No day selected' };
  if (keep.length === 0 && mustInclude.length === 0) {
    return { ok: false, error: 'This day is empty — add something to it first.' };
  }

  let plan;
  try {
    const res = await fetch('/api/ai/replan-day', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: trip?.destination,
        date: day.date,
        dayNumber: day.day_number,
        keep: keep.map((a) => ({
          title: a.title,
          location_name: a.location_name,
          category: a.category,
        })),
        mustInclude,
        transportMode: trip?.transport_mode,
        budgetLevel: trip?.ai_preferences?.budget_level,
        interests: trip?.ai_preferences?.interests || [],
        notes: trip?.ai_preferences?.notes || '',
        currency: trip?.currency,
      }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    if (!Array.isArray(body.activities) || body.activities.length === 0) {
      throw new Error('The AI returned an empty day.');
    }
    plan = body;
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Validate before the day is touched, using the same contract the generate
  // path enforces. /api/ai/replan-day does not validate its own output, so an
  // unparseable time or a made-up category would previously have been found by
  // Postgres, one row at a time, after the day had already been deleted.
  const validated = validateItinerary(
    { itinerary: [{ day: day.day_number, activities: plan.activities }] },
    {}
  );
  if (!validated.ok) {
    return {
      ok: false,
      error: `The AI returned a day we could not use, so nothing was changed: ${validated.errors[0]}`,
      details: validated.errors,
    };
  }
  const activities = validated.data.itinerary[0].activities;

  // Reuse coordinates we already hold for places whose names survive the replan,
  // so re-planning a day does not re-geocode everything it kept. Keyed on both
  // title and location_name: a replan usually rewrites the title ("Lunch at
  // Town Canteen" → "Late lunch") while keeping the place, and matching on title
  // alone was paying Google again for a place already on screen.
  const knownCoords = new Map();
  const remember = (key, a) => {
    if (key) knownCoords.set(String(key).trim().toLowerCase(), { lat: a.latitude, lng: a.longitude });
  };
  for (const a of keep) {
    if (a.latitude != null && a.longitude != null) {
      remember(a.title, a);
      remember(a.location_name, a);
    }
  }

  const coordsFor = (act) =>
    knownCoords.get(String(act.title ?? '').trim().toLowerCase()) ||
    knownCoords.get(String(act.location_name ?? '').trim().toLowerCase()) ||
    null;

  // Everything still unresolved, in one batched cache-backed request rather than
  // a lookup awaited inside a write loop.
  const resolved = await geocodeBatch(
    activities.filter((a) => !coordsFor(a)).map((a) => a.location_name),
    trip?.dest_lat != null ? { lat: trip.dest_lat, lng: trip.dest_lng } : null
  );

  const rows = activities.map((act, i) => {
    // Placing an activity without coordinates beats failing the whole replan.
    const coords = coordsFor(act) || resolved.get(act.location_name) || null;
    return {
      title: act.title,
      description: act.description || '',
      location_name: act.location_name || '',
      category: normalizeCategory(act.category),
      start_time: act.start_time || null,
      end_time: act.end_time || null,
      cost: Number(act.cost) || 0,
      notes: act.notes || '',
      booking_link: act.booking_link || '',
      order_index: i,
      currency: trip?.currency || 'USD',
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    };
  });

  // One statement, one transaction. Everything above this line is reversible by
  // doing nothing; from here it either all lands or none of it does.
  const written = await writeDay(supabase, day.id, rows);
  if (!written.ok) return written;

  return {
    ok: true,
    count: written.activities.length,
    theme: plan.theme,
    missing: plan.missing || [],
    activities: written.activities,
    // What the day held a moment ago, in a shape restoreDay accepts. Held by the
    // caller so the replan can be undone — an AI rewrite the traveler dislikes
    // was previously as unrecoverable as one that crashed.
    undo: snapshot(keep),
  };
}

/**
 * The rows of a day, in the shape replace_day_activities accepts.
 *
 * Ids are carried through so a restore puts the same activities back rather than
 * copies of them.
 */
export function snapshot(activities = []) {
  return activities.map((a, i) => ({
    id: a.id,
    title: a.title,
    description: a.description || '',
    location_name: a.location_name || '',
    category: a.category || 'other',
    start_time: a.start_time || null,
    end_time: a.end_time || null,
    cost: Number(a.cost) || 0,
    notes: a.notes || '',
    booking_link: a.booking_link || '',
    order_index: a.order_index ?? i,
    currency: a.currency || 'USD',
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
  }));
}

/**
 * Send one day's replacement rows through the atomic RPC.
 *
 * Shared by replan and undo, because they are the same operation: replace
 * everything on this day with exactly these rows, or change nothing.
 */
export async function writeDay(supabase, dayId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'Refusing to replace a day with an empty plan.' };
  }

  const { data, error } = await supabase.rpc('replace_day_activities', {
    p_trip_day_id: dayId,
    p_activities: rows,
  });

  // No partial state to report, and nothing to apologise for halfway: the
  // function either committed or it did not.
  if (error) {
    return { ok: false, error: `The day was not changed: ${error.message}` };
  }

  return { ok: true, activities: data || [] };
}

/**
 * Put a day back the way it was.
 *
 * @param undoRows the `undo` array returned by a previous replanDay
 */
export async function undoReplan(supabase, dayId, undoRows) {
  if (!Array.isArray(undoRows) || undoRows.length === 0) {
    return { ok: false, error: 'There is nothing to restore.' };
  }
  return writeDay(supabase, dayId, undoRows);
}
