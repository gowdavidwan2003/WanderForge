/**
 * Applying realtime events to trip state, without going back to the server.
 *
 * Every realtime event used to call fetchTripData(), which ran three queries in
 * series and then a weather fetch. The subscription also received the client's
 * own writes, so one AI Generate — 25 inserts — produced 25 events, each firing
 * four more requests: roughly 125 requests for a single button press, most of
 * them re-reading rows the browser had just written.
 *
 * A postgres_changes payload already carries the whole row. Merging it into
 * local state gives the same result as re-reading it, for no requests at all.
 *
 * All pure. The socket lives in useRealtimeTrip; the decisions live here.
 */

/** Activities within a day are ordered by order_index, then by title as a tiebreak. */
const byOrder = (a, b) =>
  (a.order_index ?? 0) - (b.order_index ?? 0) ||
  String(a.title ?? '').localeCompare(String(b.title ?? ''));

/**
 * Unpack the single embedded read into the three shapes the editor holds.
 *
 * The load was a waterfall: trip, then days, then activities, each waiting on the
 * one before. PostgREST can embed all three in one round trip, and does the
 * joining itself.
 */
export function shapeTripPayload(row) {
  if (!row) return { trip: null, days: [], activities: {} };

  const { trip_days: embeddedDays, ...trip } = row;
  const days = [...(embeddedDays || [])].sort((a, b) => a.day_number - b.day_number);

  const activities = {};
  for (const day of days) {
    activities[day.id] = [...(day.activities || [])].sort(byOrder);
  }

  // The embedded arrays are an implementation detail of the read; keeping them
  // on the day rows would give two sources of truth for the same activities.
  return {
    trip,
    days: days.map(({ activities: _ignored, ...day }) => day),
    activities,
  };
}

/**
 * Merge one activities event into the day-keyed map.
 *
 * Returns the SAME object when nothing changed, so React can skip the re-render:
 * an echo of the client's own write is the common case, and re-rendering the
 * whole timeline for a row that already matches is the cost this exists to avoid.
 */
export function applyActivityEvent(activities, eventType, row) {
  if (!row?.trip_day_id) return activities;

  // An event for a day this trip does not have is not ours to apply. It should
  // not arrive — the subscription is filtered per day — but a stale filter after
  // a day is added should not corrupt state.
  if (!Object.hasOwn(activities, row.trip_day_id)) return activities;

  const dayId = row.trip_day_id;
  const current = activities[dayId] || [];

  if (eventType === 'DELETE') {
    if (!current.some((a) => a.id === row.id)) return activities;
    return { ...activities, [dayId]: current.filter((a) => a.id !== row.id) };
  }

  const existing = current.find((a) => a.id === row.id);
  if (existing && sameRow(existing, row)) return activities;

  const next = existing
    ? current.map((a) => (a.id === row.id ? { ...a, ...row } : a))
    : [...current, row];

  // An UPDATE can move an activity to another day. Drop it from wherever it was.
  const moved = existing ? null : findDayOf(activities, row.id, dayId);
  const base = moved
    ? { ...activities, [moved]: activities[moved].filter((a) => a.id !== row.id) }
    : activities;

  return { ...base, [dayId]: [...next].sort(byOrder) };
}

/** Which day currently holds this activity, ignoring `except`. */
function findDayOf(activities, activityId, except) {
  for (const [dayId, list] of Object.entries(activities)) {
    if (dayId === except) continue;
    if (list.some((a) => a.id === activityId)) return dayId;
  }
  return null;
}

/**
 * Are these the same row, as far as anything on screen is concerned?
 *
 * Compares the fields the editor renders rather than every column, so a bumped
 * updated_at does not count as a change and force a repaint.
 */
const RENDERED_FIELDS = [
  'title', 'description', 'location_name', 'category', 'start_time', 'end_time',
  'cost', 'currency', 'notes', 'booking_link', 'order_index', 'latitude', 'longitude',
  'trip_day_id',
];

export function sameRow(a, b) {
  return RENDERED_FIELDS.every((f) => a?.[f] === b?.[f]);
}

/** Merge one trip_days event into the ordered day list and the activity map. */
export function applyDayEvent(days, activities, eventType, row) {
  if (!row?.id) return { days, activities };

  if (eventType === 'DELETE') {
    if (!days.some((d) => d.id === row.id)) return { days, activities };
    const { [row.id]: _gone, ...rest } = activities;
    return { days: days.filter((d) => d.id !== row.id), activities: rest };
  }

  const existing = days.find((d) => d.id === row.id);
  const nextDays = existing
    ? days.map((d) => (d.id === row.id ? { ...d, ...row } : d))
    : [...days, row];

  return {
    days: [...nextDays].sort((a, b) => a.day_number - b.day_number),
    // A day that has just appeared needs a bucket, or activity events for it are
    // dropped by applyActivityEvent's membership check.
    activities: Object.hasOwn(activities, row.id) ? activities : { ...activities, [row.id]: [] },
  };
}

/**
 * Which day should stay selected after the day list changes.
 *
 * The old code re-selected day 1 on every realtime event, because the callback
 * closed over `selectedDay` from the first render — where it is always null — so
 * `if (!selectedDay) setSelectedDay(daysData[0])` was always true. Editing day 5
 * while a collaborator typed threw you back to day 1.
 *
 * Selection is by id, not by object: the row is replaced on every read, so
 * comparing references would lose the selection on any refresh.
 */
export function pickSelectedDay(days = [], current = null) {
  if (!days.length) return null;
  if (current) {
    const stillThere = days.find((d) => d.id === current.id);
    if (stillThere) return stillThere;
  }
  return days[0];
}

/**
 * Remembers rows this tab just wrote, so their echoes can be ignored.
 *
 * Supabase Realtime delivers postgres_changes for the client's own writes;
 * `broadcast: { self: false }` only covers broadcast messages. The merge above is
 * already idempotent, so an echo is harmless — but it still re-renders, and
 * during a 25-activity generation that is 25 avoidable repaints of the timeline.
 *
 * Entries expire, because the only thing worse than a wasted repaint is a real
 * edit from a collaborator being discarded as an echo. A write id that never
 * comes back is forgotten within seconds.
 */
export function createEchoFilter(ttlMs = 15_000, now = () => Date.now()) {
  const seen = new Map();

  const sweep = () => {
    const cutoff = now() - ttlMs;
    for (const [key, at] of seen) if (at < cutoff) seen.delete(key);
  };

  return {
    /** Call with the ids of rows this tab has just written. */
    remember(ids = []) {
      sweep();
      for (const id of [].concat(ids).filter(Boolean)) seen.set(id, now());
    },

    /** True when this event is our own write coming back to us. */
    isEcho(id) {
      if (!id) return false;
      sweep();
      return seen.has(id);
    },

    get size() {
      sweep();
      return seen.size;
    },
  };
}
