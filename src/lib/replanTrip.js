/**
 * Rebuild an entire trip, preserving every place already collected.
 *
 * Used after a conflict check finds problems that cannot be solved within one day
 * — two sights too far apart to share a day have to be redistributed, which needs
 * a view of the whole trip.
 *
 * Safety model:
 *  - Nothing is deleted until a valid plan is in hand.
 *  - If the plan drops any existing place, the rebuild is REFUSED rather than
 *    applied, unless the caller explicitly allows it. The traveler chose those
 *    places; silently losing one is worse than leaving the conflicts in place.
 */
export async function replanTrip(
  supabase,
  { trip, days, activities, issues = [], allowDrops = false }
) {
  const mustKeep = days.flatMap((d) => activities?.[d.id] || []);

  if (mustKeep.length === 0) {
    return { ok: false, error: 'This trip has no activities to rebuild.' };
  }

  let plan;
  try {
    const res = await fetch('/api/ai/replan-trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: trip?.destination,
        days: days.map((d) => ({ dayNumber: d.day_number, date: d.date })),
        mustKeep: mustKeep.map((a) => ({
          title: a.title,
          location_name: a.location_name,
          category: a.category,
        })),
        issues: issues.map((i) => ({ day: i.day, message: i.message })),
        transportMode: trip?.transport_mode,
        budgetLevel: trip?.ai_preferences?.budget_level,
        interests: trip?.ai_preferences?.interests || [],
        notes: trip?.ai_preferences?.notes || '',
        currency: trip?.currency,
      }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    plan = body;
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // A plan referencing days the trip doesn't have is never applied: those
  // activities have nowhere to go and would be destroyed by the rewrite.
  if (plan.invalidDays?.length) {
    return {
      ok: false,
      error: `The rebuild put activities on Day ${plan.invalidDays.join(', ')}, but this trip only has ${days.length} day${days.length === 1 ? '' : 's'}. Nothing was changed — try again.`,
    };
  }

  // Merging two chosen places into one entry loses one of them in practice, so
  // it is surfaced for confirmation exactly like an outright drop.
  if (plan.merged?.length && !allowDrops) {
    return {
      ok: false,
      needsConfirmation: true,
      missing: plan.merged.map((m) => `${m.places.join(' + ')} were combined into "${m.title}"`),
      error: `The rebuild combined ${plan.merged.length} pair(s) of places into single entries.`,
      plan,
    };
  }

  if (plan.missing?.length && !allowDrops) {
    return {
      ok: false,
      needsConfirmation: true,
      missing: plan.missing,
      error: `The rebuild would drop ${plan.missing.length} of your places.`,
      plan,
    };
  }

  return applyTripPlan(supabase, { trip, days, activities, plan });
}

/**
 * Write an accepted plan to the database. Split out so a caller that has chosen
 * to accept dropped places can apply the same plan without re-generating it.
 */
export async function applyTripPlan(supabase, { trip, days, activities, plan }) {
  // Reuse coordinates for places that survive by name, so a rebuild neither
  // re-geocodes what we already located nor moves existing pins.
  const knownCoords = new Map();
  for (const day of days) {
    for (const a of activities?.[day.id] || []) {
      if (a.latitude != null && a.longitude != null) {
        knownCoords.set(String(a.title).toLowerCase(), { lat: a.latitude, lng: a.longitude });
      }
    }
  }

  // Final guard before the destructive step: every planned day must map to a real
  // one, or the delete would remove activities the insert cannot restore.
  const unknown = plan.itinerary
    .map((d) => Number(d.day))
    .filter((n) => !days.some((d) => d.day_number === n));
  if (unknown.length) {
    return {
      ok: false,
      error: `Plan references Day ${[...new Set(unknown)].join(', ')}, which this trip doesn't have. Nothing was changed.`,
    };
  }

  const dayIds = days.map((d) => d.id);
  const { error: delErr } = await supabase
    .from('activities').delete().in('trip_day_id', dayIds);
  if (delErr) return { ok: false, error: `Couldn't clear the itinerary: ${delErr.message}` };

  const failures = [];
  let inserted = 0;

  for (const dayPlan of plan.itinerary) {
    const day = days.find((d) => d.day_number === Number(dayPlan.day));
    if (!day) {
      failures.push(`No Day ${dayPlan.day} on this trip — its activities were skipped`);
      continue;
    }

    const list = dayPlan.activities || [];
    for (let i = 0; i < list.length; i++) {
      const act = list[i];
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
        } catch { /* better placed without coordinates than not at all */ }
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
      else inserted++;
    }
  }

  return {
    ok: true,
    inserted,
    summary: plan.summary,
    moved: plan.moved || [],
    missing: plan.missing || [],
    keptCount: plan.keptCount,
    totalMustKeep: plan.totalMustKeep,
    failures,
  };
}
