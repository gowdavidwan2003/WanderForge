/**
 * Re-plan one day and write it back.
 *
 * Adding activities one at a time — whether from the AI chat, the nearby picker,
 * or by hand — cannot produce a coherent schedule, because each insert only sees
 * itself. This rebuilds the whole day around everything currently in it, applying
 * the same realism rules as full generation, then replaces the day atomically
 * enough that a failure never leaves it empty.
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

  // Reuse coordinates we already hold for places whose names survive the replan,
  // so re-planning a day does not re-geocode everything it kept.
  const knownCoords = new Map();
  for (const a of keep) {
    if (a.latitude != null && a.longitude != null) {
      knownCoords.set(String(a.title).toLowerCase(), { lat: a.latitude, lng: a.longitude });
    }
  }

  // Only clear the day once a valid plan is in hand.
  const { error: delErr } = await supabase
    .from('activities').delete().eq('trip_day_id', day.id);
  if (delErr) return { ok: false, error: `Couldn't clear the day: ${delErr.message}` };

  const failures = [];
  for (let i = 0; i < plan.activities.length; i++) {
    const act = plan.activities[i];
    let coords = knownCoords.get(String(act.title).toLowerCase()) || null;

    if (!coords && act.location_name) {
      try {
        const params = new URLSearchParams({ q: act.location_name });
        if (trip?.dest_lat != null) {
          params.set('lat', trip.dest_lat);
          params.set('lng', trip.dest_lng);
        }
        const geo = await (await fetch(`/api/geocode?${params}`)).json();
        if (geo.results?.[0]) coords = { lat: geo.results[0].lat, lng: geo.results[0].lng };
      } catch { /* placing it without coordinates beats failing the whole replan */ }
    }

    const { error } = await supabase.from('activities').insert({
      trip_day_id: day.id,
      title: act.title,
      description: act.description || '',
      location_name: act.location_name || '',
      category: act.category || 'other',
      start_time: act.start_time || null,
      end_time: act.end_time || null,
      cost: Number(act.cost) || 0,
      notes: act.notes || '',
      order_index: i,
      currency: trip?.currency || 'USD',
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    });
    if (error) failures.push(`${act.title}: ${error.message}`);
  }

  return {
    ok: true,
    count: plan.activities.length,
    theme: plan.theme,
    missing: plan.missing || [],
    failures,
  };
}
