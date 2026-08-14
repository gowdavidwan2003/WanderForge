/**
 * Itinerary conflict checker.
 *
 * Runs entirely on already-loaded trip data — no AI, no network — so results are
 * deterministic and instant. Catches the classes of mistake that manual edits (and
 * optimistic AI plans) introduce: overlaps, impossible travel, odd hours,
 * over-budget days and implausible daily distances.
 */

// Straight-line km/h by transport mode, already discounted for real conditions.
const SPEED_KMH = {
  walking: 4,
  bike: 12,
  public_transit: 20,
  car: 35,
  flight: 60,
  mixed: 25,
};

// Roads are never straight. Multiply great-circle distance to approximate road km.
const ROAD_FACTOR = 1.3;

// Parking, walking from the drop-off point, ticket queues.
const OVERHEAD_MIN = { walking: 0, bike: 5, public_transit: 8, car: 12, flight: 90, mixed: 10 };

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Minimum realistic minutes between two points.
 *
 * When the real road distance is known, the ratio of road distance to
 * straight-line distance tells us about the terrain: a road more than twice the
 * crow-flight distance is switchbacking up a hill, and no flat-road average speed
 * applies. Chikmagaluru town → Mullayanagiri is 10.1 km straight but 21.8 km by
 * road (ratio 2.16) and really takes ~90 minutes, which a flat 35 km/h model puts
 * at 34 minutes.
 *
 * @param straightKm great-circle distance
 * @param mode       transport mode
 * @param roadKm     real road distance when available (from /api/route-matrix)
 */
export function travelMinutes(straightKm, mode = 'mixed', roadKm = null, realMinutes = null) {
  const overhead = OVERHEAD_MIN[mode] ?? OVERHEAD_MIN.mixed;
  const baseSpeed = SPEED_KMH[mode] ?? SPEED_KMH.mixed;

  // A routing provider's own duration already accounts for road class, gradient
  // and (for Google) traffic — far better than any speed model. Still add the
  // door-to-door overhead, which routing engines never include.
  if (Number.isFinite(realMinutes) && realMinutes > 0) {
    return Math.round(realMinutes + overhead);
  }

  const distance = roadKm ?? straightKm * ROAD_FACTOR;

  let speed = baseSpeed;
  if (roadKm && straightKm > 0.5 && mode !== 'walking' && mode !== 'flight') {
    const sinuosity = roadKm / straightKm;
    if (sinuosity >= 2.0) speed = Math.min(baseSpeed, 22);       // hairpin ghat road
    else if (sinuosity >= 1.6) speed = Math.min(baseSpeed, 28);  // winding hill road
  }

  return Math.round((distance / speed) * 60 + overhead);
}

const toMinutes = (t) => {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const fmt = (mins) => {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

const hasCoords = (a) =>
  typeof a.latitude === 'number' && typeof a.longitude === 'number' &&
  !Number.isNaN(a.latitude) && !Number.isNaN(a.longitude);

/**
 * @param trip      the trip row (currency, total_budget, transport_mode)
 * @param days      ordered trip_days
 * @param activities { [dayId]: Activity[] }  already ordered by order_index
 * @returns { issues, summary }
 */
export function checkItinerary(trip, days = [], activities = {}, roadLegs = {}) {
  const issues = [];
  const mode = trip?.transport_mode || 'mixed';
  const dayCount = days.length || 1;
  const dailyBudget = trip?.total_budget ? Number(trip.total_budget) / dayCount : null;

  const add = (i) => issues.push(i);

  for (const day of days) {
    const acts = (activities[day.id] || []).filter(Boolean);
    const label = `Day ${day.day_number}`;
    let dayCost = 0;
    let dayDistance = 0;

    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const start = toMinutes(a.start_time);
      const end = toMinutes(a.end_time);
      dayCost += Number(a.cost) || 0;

      // --- Structural problems with a single activity ---
      if (start == null || end == null) {
        add({
          severity: 'info', type: 'missing-times', day: day.day_number,
          activityId: a.id, title: a.title,
          message: `"${a.title}" has no ${start == null ? 'start' : 'end'} time, so it can't be checked for conflicts.`,
        });
      } else if (end <= start) {
        add({
          severity: 'error', type: 'invalid-duration', day: day.day_number,
          activityId: a.id, title: a.title,
          message: `"${a.title}" ends at or before it starts (${a.start_time} → ${a.end_time}).`,
        });
      }

      // --- Opening-hour plausibility ---
      // Real opening hours aren't available, so this flags times that are
      // implausible for the activity category rather than asserting a closure.
      if (start != null) {
        const cat = a.category;
        if (start < 6 * 60) {
          add({
            severity: 'warning', type: 'odd-hours', day: day.day_number,
            activityId: a.id, title: a.title,
            message: `"${a.title}" starts at ${a.start_time} — most venues are closed before 06:00.`,
          });
        } else if (
          start < 9 * 60 &&
          ['culture', 'shopping', 'sightseeing'].includes(cat)
        ) {
          add({
            severity: 'info', type: 'odd-hours', day: day.day_number,
            activityId: a.id, title: a.title,
            message: `"${a.title}" starts at ${a.start_time}. Museums, shops and monuments commonly open at 09:00–10:00 — worth confirming.`,
          });
        }
      }
      if (end != null && end > 23 * 60 + 30 && a.category !== 'nightlife' && a.category !== 'accommodation') {
        add({
          severity: 'warning', type: 'odd-hours', day: day.day_number,
          activityId: a.id, title: a.title,
          message: `"${a.title}" runs until ${a.end_time}, which is late for a ${a.category} activity.`,
        });
      }

      // --- Pairwise checks against the previous activity ---
      if (i === 0) continue;
      const prev = acts[i - 1];
      const prevEnd = toMinutes(prev.end_time);
      if (prevEnd == null || start == null) continue;

      if (start < prevEnd) {
        add({
          severity: 'error', type: 'overlap', day: day.day_number,
          activityId: a.id, title: a.title,
          message: `"${a.title}" starts at ${a.start_time}, before "${prev.title}" ends at ${prev.end_time} — they overlap by ${fmt(prevEnd - start)}.`,
        });
        continue; // travel check is meaningless once they overlap
      }

      if (!hasCoords(prev) || !hasCoords(a)) continue;

      const km = haversineKm(prev.latitude, prev.longitude, a.latitude, a.longitude);
      const leg = roadLegs[`${prev.id}->${a.id}`] || {};
      const roadKm = leg.km ?? null;
      const realMinutes = leg.minutes ?? null;
      const effectiveKm = roadKm ?? km * ROAD_FACTOR;
      dayDistance += effectiveKm;

      const needed = travelMinutes(km, mode, roadKm, realMinutes);
      const available = start - prevEnd;

      if (km > 0.3 && available < needed) {
        const basis = realMinutes
          ? `${roadKm ? roadKm.toFixed(1) + ' km by road' : 'the route'}, which routing puts at ${fmt(Math.round(realMinutes))} of driving`
          : roadKm
            ? `${roadKm.toFixed(1)} km by road`
            : `about ${(km * ROAD_FACTOR).toFixed(1)} km (estimated)`;
        add({
          severity: needed - available > 30 ? 'error' : 'warning',
          type: 'travel-time', day: day.day_number,
          activityId: a.id, title: a.title,
          message: `Only ${fmt(available)} between "${prev.title}" and "${a.title}", but the journey is ${basis} — roughly ${fmt(needed)} by ${mode.replace('_', ' ')}. Short by ${fmt(needed - available)}.`,
        });
      }

      if (effectiveKm > 100) {
        add({
          severity: 'warning', type: 'long-hop', day: day.day_number,
          activityId: a.id, title: a.title,
          message: `"${prev.title}" to "${a.title}" is about ${effectiveKm.toFixed(0)} km — a long haul to fit inside one day.`,
        });
      }
    }

    // --- Whole-day checks ---
    if (dailyBudget && dayCost > dailyBudget * 1.2) {
      add({
        severity: 'warning', type: 'over-budget', day: day.day_number,
        message: `${label} costs ${Math.round(dayCost)} ${trip.currency || ''}, over the ~${Math.round(dailyBudget)} daily average implied by your ${Math.round(Number(trip.total_budget))} budget.`,
      });
    }

    if (dayDistance > 250) {
      add({
        severity: 'warning', type: 'long-day', day: day.day_number,
        message: `${label} covers roughly ${Math.round(dayDistance)} km of travel — likely more time in transit than at the sights.`,
      });
    }

    const withCoords = acts.filter(hasCoords).length;
    if (acts.length >= 2 && withCoords < acts.length) {
      add({
        severity: 'info', type: 'missing-coords', day: day.day_number,
        message: `${acts.length - withCoords} of ${acts.length} activities on ${label} have no map location, so travel time between them couldn't be checked.`,
      });
    }
  }

  issues.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.day - b.day
  );

  return {
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
      checkedDays: days.length,
      checkedActivities: Object.values(activities).flat().length,
    },
  };
}
