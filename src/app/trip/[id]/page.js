'use client';

import { useState, useEffect, useCallback, useMemo, useRef, use } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DynamicMap from '@/components/maps/DynamicMap';
import CollaborationPanel from '@/components/trip/CollaborationPanel';
import TripActionBar from '@/components/trip/TripActionBar';
import ConfirmGenerateModal from '@/components/trip/ConfirmGenerateModal';
import AIChatPanel from '@/components/trip/AIChatPanel';
import { useRealtimeTrip } from '@/hooks/useRealtimeTrip';
import ExpenseSplitPanel from '@/components/trip/ExpenseSplitPanel';
import ConflictCheckPanel from '@/components/trip/ConflictCheckPanel';
import { formatMoney, inferCurrency } from '@/lib/currency';
import NearbyPlacesPanel from '@/components/trip/NearbyPlacesPanel';
import BookingsPanel from '@/components/trip/BookingsPanel';
import { bookingsTotal } from '@/lib/bookings';
import { clearsExistingActivities, orderOffsetFor, planGeneration } from '@/lib/generationGuard';
import { replanDay, undoReplan } from '@/lib/replanDay';
import { geocodeBatch, unresolvedLocations } from '@/lib/geocodeClient';
import { checkItinerary } from '@/lib/conflictChecker';
import { conflictsForActivity, dayConflictSummary, worstSeverity } from '@/lib/conflictView';
import { normalizeCategory } from '@/lib/itineraryPrompt';
import {
  applyActivityEvent,
  applyDayEvent,
  createEchoFilter,
  pickSelectedDay,
  shapeTripPayload,
} from '@/lib/realtimeState';
import { fetchWeather as loadWeather } from '@/lib/weatherCache';
import TripSettingsPanel from '@/components/trip/TripSettingsPanel';
import GenerationProgress from '@/components/trip/GenerationProgress';
import { readSSE } from '@/lib/streamingJson';

const CATEGORY_CONFIG = {
  sightseeing: { icon: '🏛️', color: '#6366F1', label: 'Sightseeing' },
  food: { icon: '🍜', color: '#F59E0B', label: 'Food & Dining' },
  transport: { icon: '🚌', color: '#64748B', label: 'Transport' },
  accommodation: { icon: '🏨', color: '#8B5CF6', label: 'Accommodation' },
  adventure: { icon: '⛰️', color: '#10B981', label: 'Adventure' },
  shopping: { icon: '🛍️', color: '#EC4899', label: 'Shopping' },
  nightlife: { icon: '🌃', color: '#7C3AED', label: 'Nightlife' },
  culture: { icon: '🎭', color: '#3B82F6', label: 'Culture' },
  nature: { icon: '🌿', color: '#22C55E', label: 'Nature' },
  relaxation: { icon: '🧘', color: '#06B6D4', label: 'Relaxation' },
  other: { icon: '📌', color: '#94A3B8', label: 'Other' },
};

export default function TripEditorPage({ params }) {
  const { id } = use(params);
  const [trip, setTrip] = useState(null);
  const [missing, setMissing] = useState(false);
  const [days, setDays] = useState([]);
  const [activities, setActivities] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState(null);
  // What the stream has produced so far. Preview only — nothing here is saved
  // until the server's `complete` event arrives.
  const [streaming, setStreaming] = useState(null);
  // Lets the Cancel button reach the in-flight request. Aborting closes the SSE
  // connection, which the route treats as "stop paying Groq".
  const generateAbortRef = useRef(null);
  const [pendingGenerate, setPendingGenerate] = useState(null);
  // Guards against a double-click landing before the aiGenerating state commits.
  const generatingRef = useRef(false);
  const [weather, setWeather] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const [collaborators, setCollaborators] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const [deletingActivity, setDeletingActivity] = useState(null);
  const [showExpenses, setShowExpenses] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [locating, setLocating] = useState(null);
  const [showNearby, setShowNearby] = useState(false);
  const [showBookings, setShowBookings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);
  const [deletingTrip, setDeletingTrip] = useState(false);
  // The day_number currently being rebuilt, or null. A number rather than a
  // boolean so the panel can show the spinner on the day it belongs to.
  const [replanningDay, setReplanningDay] = useState(null);
  // The snapshot of whichever day was replanned last, so it can be put back.
  // Cleared once used, or when the day is changed by anything else.
  const [lastReplan, setLastReplan] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [togglingLock, setTogglingLock] = useState(false);
  const [stays, setStays] = useState([]);
  const [transport, setTransport] = useState([]);
  const [activityForm, setActivityForm] = useState({
    title: '', description: '', location_name: '', category: 'sightseeing',
    start_time: '', end_time: '', cost: '', notes: '', booking_link: '',
    latitude: '', longitude: '',
  });

  /**
   * Rows this tab just wrote, so their echoes can be skipped.
   *
   * Realtime delivers postgres_changes for the client's own writes. The merge
   * below is idempotent so an echo is harmless, but it still repaints the
   * timeline — 25 times during one AI Generate.
   */
  const echoes = useRef(createEchoFilter());

  /**
   * A mirror of the state a realtime event needs to read.
   *
   * The event handler is created once, so it cannot close over current state,
   * and the two pieces it has to change together cannot both be reached through
   * functional updaters. Kept in sync after every render.
   */
  const stateRef = useRef({ days: [], activities: {} });

  /**
   * Apply one realtime event to local state.
   *
   * This used to call fetchTripData() — three serial queries and a weather
   * fetch — for every event, including every echo of this tab's own inserts.
   * One AI Generate was roughly 125 requests. The payload already carries the
   * whole row, so merging it costs nothing and gives the same answer.
   */
  const handleRealtimeUpdate = useCallback((table, event, row) => {
    if (!row) return;
    if (echoes.current.isEcho(row.id)) return;

    if (table === 'activities') {
      setActivities((prev) => applyActivityEvent(prev, event, row));
      return;
    }

    if (table === 'trip_days') {
      // A day event moves two pieces of state at once, and they have to agree —
      // a new day needs its activity bucket, a deleted one must take its bucket
      // with it. Read both from the mirror rather than nesting one setState
      // updater inside another: updaters must be pure, and StrictMode runs them
      // twice to prove it.
      const { days: prevDays, activities: prevActs } = stateRef.current;
      const merged = applyDayEvent(prevDays, prevActs, event, row);
      setDays(merged.days);
      setActivities(merged.activities);
      setSelectedDay((current) => pickSelectedDay(merged.days, current));
      return;
    }

    if (table === 'trips') {
      setTrip((prev) => ({ ...prev, ...row }));
    }
  }, []);

  useEffect(() => {
    stateRef.current = { days, activities };
  });

  const { onlineUsers } = useRealtimeTrip(id, handleRealtimeUpdate, days.map(d => d.id));

  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  /**
   * Weather follows the destination, not the itinerary.
   *
   * It used to be fetched from inside fetchTripData, so every realtime event
   * re-fetched a forecast for coordinates that had not moved. The forecast
   * depends on where the trip is and when — neither changes when somebody edits
   * an activity — so this keys on the coordinates alone and reads a cached
   * forecast when there is a fresh one.
   */
  useEffect(() => {
    const lat = trip?.dest_lat;
    const lng = trip?.dest_lng;
    if (lat == null || lng == null) return;

    let cancelled = false;
    loadWeather(lat, lng).then((forecast) => {
      if (!cancelled && forecast) setWeather(forecast);
    });
    return () => { cancelled = true; };
  }, [trip?.dest_lat, trip?.dest_lng]);

  useEffect(() => {
    // Same trap as the dashboard: bailing out while auth is unresolved without
    // clearing `loading` left "Loading your trip..." on screen permanently.
    if (authLoading || !id) return;

    if (!user) {
      setLoading(false);
      router.replace(`/auth/login?redirect=%2Ftrip%2F${id}`);
      return;
    }

    fetchTripData();
    fetchCollaborators();
    fetchBookings();
    // Keyed on the user id, not the user object — a token refresh returns a new
    // object each cycle and would otherwise reload the whole trip every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, id]);

  const fetchCollaborators = async () => {
    // trip_collaborators.user_id references auth.users, not profiles, so PostgREST
    // cannot embed profiles here — the old `select('*, profiles(...)')` returned
    // PGRST200 on every call and left the list permanently empty. Join manually.
    // withTimeout like every other load path: supabase-js queues queries behind
    // an in-flight token refresh, and a refresh that never completes leaves the
    // promise unsettled rather than rejected.
    const { data: rows, error } = await withTimeout(
      supabase.from('trip_collaborators').select('*').eq('trip_id', id),
      'Loading collaborators'
    );

    if (error) {
      console.error('[WanderForge] Failed to load collaborators:', error);
      toast.error('Could not load collaborators', 'Collaboration');
      return;
    }
    if (!rows?.length) {
      setCollaborators([]);
      return;
    }

    // No email: migration 007 revokes SELECT on that column from client roles,
    // because a world-readable email list is what let an attacker pick a victim
    // to impersonate. display_name is always populated by handle_new_user.
    const { data: people } = await withTimeout(
      supabase.from('profiles').select('id, display_name').in('id', rows.map(r => r.user_id)),
      'Loading collaborator names'
    );

    const byId = Object.fromEntries((people || []).map(p => [p.id, p]));
    setCollaborators(rows.map(c => ({
      ...c,
      display_name: byId[c.user_id]?.display_name,
    })));
  };

  const fetchBookings = async () => {
    const [a, t] = await Promise.all([
      withTimeout(supabase.from('accommodations').select('*').eq('trip_id', id), 'Loading stays'),
      withTimeout(supabase.from('transport_bookings').select('*').eq('trip_id', id), 'Loading transport'),
    ]);
    setStays(a.data || []);
    setTransport(t.data || []);
  };

  /**
   * Load the whole trip in one round trip.
   *
   * This was a waterfall: trip, then days, then activities, each awaiting the
   * one before, plus a weather call — and it ran again on every realtime event.
   * PostgREST can embed all three, and does the joining server-side.
   */
  const fetchTripData = async () => {
    try {
      const { data: row, error: tripErr } = await withTimeout(
        supabase
          .from('trips')
          .select('*, trip_days(*, activities(*))')
          .eq('id', id)
          .order('day_number', { referencedTable: 'trip_days', ascending: true })
          .single(),
        'Loading this trip'
      );

      // A trip that does not exist, or one RLS hides from this user, is a 404
      // rather than a failure: .single() reports no rows as PGRST116. Record it
      // and let the render throw notFound(), because notFound() called from this
      // async callback would escape the error boundary entirely.
      if (tripErr?.code === 'PGRST116' || (!tripErr && !row)) {
        setMissing(true);
        return;
      }

      if (tripErr) throw tripErr;

      const shaped = shapeTripPayload(row);
      setTrip(shaped.trip);
      setDays(shaped.days);
      setActivities(shaped.activities);
      // Keeps the day the user is looking at, rather than snapping back to day 1
      // every time anything reloads.
      setSelectedDay((current) => pickSelectedDay(shaped.days, current));
    } catch {
      toast.error('Failed to load trip');
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  // Geocode a place name, biased toward the trip's destination.
  const geocodeLocation = async (query, near = null) => {
    try {
      const params = new URLSearchParams({ q: query });
      if (near?.lat != null && near?.lng != null) {
        params.set('lat', near.lat);
        params.set('lng', near.lng);
      }
      const res = await fetch(`/api/geocode?${params}`);
      const data = await res.json();
      return data.results?.[0] || null;
    } catch { return null; }
  };

  // Locate every activity that has a place name but no coordinates. Existing
  // trips were generated when geocoding silently failed for all of them, so this
  // repairs them in place rather than requiring a full regenerate.
  // Manual adds and picker adds both append to the end of a day. This rebuilds
  // the day so ordering, timings and travel make sense again.
  const handleToggleLock = async () => {
    setTogglingLock(true);
    const next = !trip.itinerary_locked;
    const { data, error } = await supabase
      .from('trips')
      .update({ itinerary_locked: next })
      .eq('id', id)
      .select()
      .single();
    setTogglingLock(false);

    if (error) {
      // The database trigger rejects lock changes from anyone but the owner.
      return toast.error(error.message, next ? 'Could not lock' : 'Could not unlock');
    }
    setTrip(data);
    toast.success(
      next
        ? 'The itinerary is frozen. Nobody can edit it until you unlock it.'
        : 'The itinerary is editable again.',
      next ? 'Itinerary Locked 🔒' : 'Itinerary Unlocked'
    );
  };

  /**
   * Rebuild one day around everything on it.
   *
   * Takes the day rather than reading selectedDay, so the conflict panel can fix
   * a day the user is not currently looking at — being made to go and find the
   * broken day before you may fix it is exactly the friction the panel exists to
   * remove.
   */
  /**
   * Save an edited trip.
   *
   * The day list is reconciled in the same transaction as the trip fields, so a
   * trip can never end up with days that disagree with its own dates. The panel
   * has already shown the user what removing days costs.
   */
  const handleSaveTrip = async ({ form, plan }) => {
    setSavingTrip(true);
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('update_trip_with_days', {
          p_trip_id: id,
          p_trip: {
            title: form.title.trim(),
            destination: form.destination.trim(),
            start_date: form.startDate,
            end_date: form.endDate,
            transport_mode: form.transportMode,
            // Present-but-empty clears it; the RPC distinguishes that from absent.
            total_budget: form.totalBudget === '' ? null : String(form.totalBudget),
          },
          p_days: plan.days,
        }),
        'Saving your trip'
      );
      if (error) throw error;

      setTrip((prev) => ({ ...prev, ...data }));
      setShowSettings(false);
      toast.success(
        plan.removed.length
          ? `Saved. ${plan.removed.length} day(s) outside the new dates were removed.`
          : 'Your trip has been updated.',
        'Trip Saved'
      );
      // Days changed shape, so this one does need a re-read — the RPC returns the
      // trip row, not the reconciled day list.
      fetchTripData();
    } catch (err) {
      toast.error(err.message || 'Could not save the trip', 'Save failed');
    } finally {
      setSavingTrip(false);
    }
  };

  /** Delete the trip. Everything below it cascades in Postgres. */
  const handleDeleteTrip = async () => {
    setDeletingTrip(true);
    try {
      const { error } = await withTimeout(
        supabase.from('trips').delete().eq('id', id),
        'Deleting your trip'
      );
      if (error) throw error;

      toast.success('The trip and everything on it has been deleted.', 'Trip Deleted');
      router.push('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Could not delete the trip', 'Delete failed');
      setDeletingTrip(false);
    }
  };

  const handleReplanDay = async (day = selectedDay) => {
    if (blockedByLock() || !day) return;
    setReplanningDay(day.day_number);

    const result = await replanDay(supabase, {
      trip,
      day,
      keep: activities[day.id] || [],
    });
    setReplanningDay(null);

    // A failure now genuinely means nothing changed — the delete and the inserts
    // are one transaction — so this can say so instead of leaving the user
    // wondering what survived.
    if (!result.ok) return toast.error(result.error, 'Replan failed — the day is unchanged');

    applyDayWrite(day.id, result.activities);
    setLastReplan({ dayId: day.id, dayNumber: day.day_number, undo: result.undo });

    toast.success(
      `Day ${day.day_number} rebuilt — ${result.count} entries, times and travel sorted. Use "Undo replan" if you preferred the old one.`,
      result.theme || 'Day Replanned'
    );
  };

  /** Put back the day as it was before the last replan. */
  const handleUndoReplan = async () => {
    if (blockedByLock() || !lastReplan) return;
    setUndoing(true);
    const result = await undoReplan(supabase, lastReplan.dayId, lastReplan.undo);
    setUndoing(false);

    if (!result.ok) return toast.error(result.error, 'Could not undo');

    applyDayWrite(lastReplan.dayId, result.activities);
    toast.success(`Day ${lastReplan.dayNumber} is back as it was.`, 'Replan undone');
    setLastReplan(null);
  };

  /**
   * Put the rows the server just returned straight into local state.
   *
   * The RPC returns what it wrote, so there is nothing to go back and read. The
   * ids are registered as ours first, so the realtime echoes of this same write
   * are ignored rather than repainting the timeline once per row.
   */
  const applyDayWrite = (dayId, rows = []) => {
    echoes.current.remember(rows.map((r) => r.id));
    setActivities((prev) => ({ ...prev, [dayId]: rows }));
  };

  /** Fix the day with this number, wherever the request came from. */
  const handleFixDay = (dayNumber) => {
    const day = days.find((d) => d.day_number === dayNumber);
    if (day) handleReplanDay(day);
  };

  const handleLocateActivities = async () => {
    if (blockedByLock()) return;
    const pending = Object.values(activities).flat()
      .filter(a => a.location_name && (a.latitude == null || a.longitude == null));

    if (pending.length === 0) {
      toast.info('Every activity with a location is already on the map.', 'Nothing to do');
      return;
    }

    setLocating({ done: 0, total: pending.length });

    // Resolve the destination first so it can bias the per-activity lookups.
    let center = trip.dest_lat != null ? { lat: trip.dest_lat, lng: trip.dest_lng } : null;
    if (!center && trip.destination) {
      const destHit = await geocodeLocation(trip.destination);
      if (destHit) {
        center = { lat: destHit.lat, lng: destHit.lng };
        await supabase.from('trips')
          .update({ dest_lat: destHit.lat, dest_lng: destHit.lng })
          .eq('id', trip.id);
      }
    }

    // Resolve every outstanding place in one batched, cache-backed request, then
    // write. This was one billed Places lookup per activity, awaited in series.
    const coords = await geocodeBatch(unresolvedLocations(pending), center);

    let located = 0;
    for (let i = 0; i < pending.length; i++) {
      const act = pending[i];
      const hit = coords.get(act.location_name);
      if (hit) {
        await supabase.from('activities')
          .update({ latitude: hit.lat, longitude: hit.lng })
          .eq('id', act.id);
        located++;
      }
      setLocating({ done: i + 1, total: pending.length });
    }

    setLocating(null);
    toast.success(`Located ${located} of ${pending.length} activities.`, 'Map Updated');
    fetchTripData();
  };

  // Every itinerary mutation checks the lock first, so a stale page can't slip an
  // edit past. The database would reject it anyway; this gives a clear message.
  const blockedByLock = () => {
    if (!trip?.itinerary_locked) return false;
    toast.error(
      'This itinerary is locked. The trip owner must unlock it before changes can be made.',
      'Locked 🔒'
    );
    return true;
  };

  const openAddActivity = () => {
    if (blockedByLock()) return;
    setEditingActivity(null);
    setActivityForm({
      title: '', description: '', location_name: '', category: 'sightseeing',
      start_time: '', end_time: '', cost: '', notes: '', booking_link: '',
      latitude: '', longitude: '',
    });
    setShowActivityModal(true);
  };

  const openEditActivity = (activity) => {
    if (blockedByLock()) return;
    setEditingActivity(activity);
    setActivityForm({
      title: activity.title || '', description: activity.description || '',
      location_name: activity.location_name || '', category: activity.category || 'sightseeing',
      start_time: activity.start_time || '', end_time: activity.end_time || '',
      cost: activity.cost || '', notes: activity.notes || '',
      booking_link: activity.booking_link || '',
      latitude: activity.latitude || '', longitude: activity.longitude || '',
    });
    setShowActivityModal(true);
  };

  const handleSaveActivity = async () => {
    if (!activityForm.title.trim() || !selectedDay) return;

    // Auto-geocode if location but no coords
    let lat = activityForm.latitude ? parseFloat(activityForm.latitude) : null;
    let lng = activityForm.longitude ? parseFloat(activityForm.longitude) : null;

    if (activityForm.location_name && (!lat || !lng)) {
      const geo = await geocodeLocation(
        activityForm.location_name,
        trip?.dest_lat != null ? { lat: trip.dest_lat, lng: trip.dest_lng } : null
      );
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    try {
      const payload = {
        title: activityForm.title,
        description: activityForm.description,
        location_name: activityForm.location_name,
        category: activityForm.category,
        start_time: activityForm.start_time || null,
        end_time: activityForm.end_time || null,
        cost: activityForm.cost ? parseFloat(activityForm.cost) : 0,
        notes: activityForm.notes,
        booking_link: activityForm.booking_link,
        latitude: lat,
        longitude: lng,
      };

      if (editingActivity) {
        await supabase.from('activities').update(payload).eq('id', editingActivity.id);
        toast.success('Activity updated');
      } else {
        const currentActivities = activities[selectedDay.id] || [];
        await supabase.from('activities').insert({
          trip_day_id: selectedDay.id,
          ...payload,
          order_index: currentActivities.length,
          currency: trip?.currency || 'USD',
        });
        toast.success('Activity added!');
      }
      setShowActivityModal(false);
      fetchTripData();
    } catch (err) { toast.error(err.message); }
  };

  const confirmDeleteActivity = async () => {
    if (blockedByLock()) return;
    const activity = deletingActivity;
    if (!activity) return;
    setDeletingActivity(null);
    try {
      // .select() makes PostgREST return the rows it actually removed. Without it a
      // delete that RLS filtered to zero rows resolves without an error, so the UI
      // reported success while the activity was still there.
      const { data, error } = await supabase
        .from('activities')
        .delete()
        .eq('id', activity.id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          'That activity could not be deleted. You may not have edit permission on this trip.'
        );
      }

      toast.success('Activity deleted');
      if (selectedActivityId === activity.id) setSelectedActivityId(null);
      fetchTripData();
    } catch (err) {
      toast.error(err.message || 'Failed to delete activity', 'Delete Failed');
    }
  };

  const handleMoveActivity = async (activityId, direction) => {
    if (blockedByLock()) return;
    if (!selectedDay) return;
    const dayActs = [...(activities[selectedDay.id] || [])];
    const idx = dayActs.findIndex(a => a.id === activityId);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= dayActs.length) return;
    [dayActs[idx], dayActs[newIdx]] = [dayActs[newIdx], dayActs[idx]];
    await Promise.all(dayActs.map((a, i) =>
      supabase.from('activities').update({ order_index: i }).eq('id', a.id)
    ));
    fetchTripData();
  };

  // AI Generate itinerary
  /**
   * Write one generated day's activities.
   *
   * @returns {{written: number, failures: string[]}} — failures are surfaced
   *   rather than counted silently. Every value here has already been validated
   *   against the database's own constraints server-side, so a rejected row now
   *   means something went wrong that the traveler needs to hear about, not a
   *   model that wrote "9am" into a TIME column.
   */
  const insertDayPlan = async (day, dayPlan, currency, orderOffset = 0, coords = new Map()) => {
    const acts = dayPlan?.activities || [];
    if (acts.length === 0) return { written: 0, failures: [] };

    const rows = acts.map((act, i) => {
      // The server geocoded these already, to check travel times before anything
      // was written. Reusing its coordinates keeps the saved trip identical to
      // the one that was checked, and saves a billed lookup per activity.
      // `coords` covers whatever the server could not resolve, filled in by one
      // batch call rather than a lookup per activity inside a loop.
      const fallback = act.location_name ? coords.get(act.location_name) : null;
      return {
        trip_day_id: day.id,
        title: act.title,
        description: act.description || '',
        location_name: act.location_name || '',
        category: normalizeCategory(act.category),
        start_time: act.start_time || null,
        end_time: act.end_time || null,
        cost: parseFloat(act.cost) || 0,
        notes: act.notes || '',
        booking_link: act.booking_link || '',
        order_index: orderOffset + i,
        currency: currency || trip.currency || 'USD',
        latitude: Number.isFinite(act.latitude) ? act.latitude : fallback?.lat ?? null,
        longitude: Number.isFinite(act.longitude) ? act.longitude : fallback?.lng ?? null,
      };
    });

    // One request per day, not per activity. A 25-activity generation was 25
    // round trips here — and every one of them came back as a realtime event
    // that triggered a full reload. It also makes a day all-or-nothing, which is
    // now safe to rely on: every value was validated server-side against the
    // same constraints Postgres enforces.
    const { data: inserted, error } = await supabase.from('activities').insert(rows).select();

    if (error) {
      return { written: 0, failures: [`Day ${day.day_number}: ${error.message}`] };
    }

    // Straight into local state, and registered as ours so the echoes of this
    // write are ignored rather than repainting the timeline once per row.
    applyDayWrite(
      day.id,
      orderOffset > 0 ? [...(activities[day.id] || []), ...(inserted || [])] : inserted || []
    );
    setAiProgress((p) => (p ? { ...p, done: p.done + rows.length } : p));

    return { written: inserted?.length ?? 0, failures: [] };
  };

  /**
   * Record what the server's conflict check found.
   *
   * The check runs before the insert and most conflicts are fixed by
   * re-prompting, but the survivors have to be visible somewhere — otherwise the
   * traveler owns a plan that was known to be unachievable and nothing says so.
   * Never fatal: the itinerary is already saved, and the check can be re-run.
   */
  const persistConflicts = async (conflicts) => {
    if (!conflicts) return;

    const { error } = await supabase
      .from('trips')
      .update({ conflicts, conflicts_checked_at: new Date().toISOString() })
      .eq('id', trip.id);

    if (error) {
      console.warn('[WanderForge] Could not store the conflict check:', error.message);
    }
  };

  /** Adopt the AI's local currency and backfill destination coords for weather. */
  const applyTripMetadata = async (data) => {
    const detected = data.currency || inferCurrency(trip.destination);
    if (detected && detected !== trip.currency) {
      await supabase.from('trips').update({ currency: detected }).eq('id', trip.id);
    }

    if (!trip.dest_lat) {
      const destGeo = await geocodeLocation(trip.destination);
      if (destGeo) {
        await supabase.from('trips').update({
          dest_lat: destGeo.lat, dest_lng: destGeo.lng,
        }).eq('id', trip.id);
        // No explicit weather call: setting dest_lat/dest_lng on the trip row is
        // what the weather effect keys on, so it follows on the next load.
      }
    }
  };

  /**
   * Generate a whole itinerary.
   *
   * `mode` is 'replace' or 'append'. Generation used to insert unconditionally,
   * so a second press — an obvious thing to try after a disappointing result, or
   * after a long silent run that looks stuck — wrote a complete second copy of
   * every activity with colliding order_index values, and the only way back was
   * deleting them one at a time. handleAIGenerate now refuses to run blind and
   * asks first; this does the work once a choice has been made.
   */
  const runGenerate = async (mode) => {
    // A ref, not the aiGenerating state: state updates are asynchronous, so two
    // clicks landing in the same tick could both pass a state-based check.
    if (generatingRef.current) return;
    generatingRef.current = true;
    setPendingGenerate(null);
    setAiGenerating(true);
    setAiProgress({ phase: 'planning', done: 0, total: 0 });
    setStreaming({ status: 'Starting…', days: [], expected: days.length });

    const controller = new AbortController();
    generateAbortRef.current = controller;

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          destination: trip.destination,
          days: days.length,
          interests: trip.ai_preferences?.interests || [],
          transportMode: trip.transport_mode,
          budgetLevel: trip.ai_preferences?.budget_level || 'moderate',
          notes: trip.ai_preferences?.notes || '',
          // The server geocodes and conflict-checks the plan before returning
          // it; these let it bias place lookups to the right town and judge
          // whether a day runs over budget.
          destLat: trip.dest_lat,
          destLng: trip.dest_lng,
          totalBudget: trip.total_budget,
          // Day-by-day, so the first one lands in a couple of seconds instead of
          // forty. What gets saved is unchanged: the server still validates,
          // geocodes and checks the whole plan before sending `complete`.
          stream: true,
        }),
      });

      // A failure before the stream opens is still a JSON body.
      if (!res.ok || !res.body) {
        const failed = await res.json().catch(() => ({}));
        throw new Error(failed.error || `Generation failed (${res.status})`);
      }

      let data = null;
      let streamError = null;

      for await (const { event, data: payload } of readSSE(res.body, { signal: controller.signal })) {
        if (event === 'status') {
          setStreaming((s) => ({ ...s, status: payload.message }));
        } else if (event === 'day') {
          setStreaming((s) => ({
            ...s,
            days: [...(s?.days || []), payload.day],
            expected: payload.expected || s?.expected || 0,
            status: `Day ${payload.day.day}: ${payload.day.theme || 'planned'}`,
          }));
        } else if (event === 'error') {
          streamError = payload;
        } else if (event === 'complete') {
          data = payload;
        }
      }

      // Cancelled. The route aborts its Groq request when this connection
      // closes, and nothing has been written, so there is nothing to undo.
      if (controller.signal.aborted) return;

      if (streamError) throw new Error(streamError.message);
      if (!data?.itinerary) throw new Error('No itinerary returned');

      const total = data.itinerary.reduce((s, d) => s + (d.activities?.length || 0), 0);
      if (total === 0) throw new Error('The AI returned an itinerary with no activities.');

      // Only now is it safe to clear. Deleting before this point meant a Groq
      // rate limit — the likeliest failure on a free-tier key — wiped the
      // itinerary and left nothing to replace it, which is the same
      // delete-before-you-can-restore mistake replanDay makes.
      if (clearsExistingActivities(mode)) {
        const dayIds = days.map((d) => d.id);
        if (dayIds.length) {
          const { error } = await supabase.from('activities').delete().in('trip_day_id', dayIds);
          // Abort rather than insert: a failed clear followed by a successful
          // insert reproduces exactly the duplication this guard exists to stop.
          if (error) throw new Error(`Could not clear the old itinerary: ${error.message}`);
          // Local state has to follow, because nothing re-reads the trip after
          // this any more — the inserts below return their own rows.
          setActivities(Object.fromEntries(dayIds.map((dayId) => [dayId, []])));
        }
      }

      setAiProgress({ phase: 'saving', done: 0, total });
      setStreaming((s) => ({ ...s, status: 'Saving your itinerary…' }));

      // One batch call for everything the server could not place, before the
      // write loop rather than inside it. This used to be a Places lookup per
      // activity — around $1.30 for a 5-day trip, re-spent on every regenerate.
      const coords = await geocodeBatch(
        unresolvedLocations(data.itinerary.flatMap((d) => d.activities || [])),
        trip.dest_lat != null ? { lat: trip.dest_lat, lng: trip.dest_lng } : null
      );

      let written = 0;
      const failures = [];
      for (const dayPlan of data.itinerary) {
        const day = days.find((d) => d.day_number === dayPlan.day);
        if (!day) continue;
        // Appending must not reuse order_index values already on the day.
        const offset = orderOffsetFor(mode, activities[day.id]?.length || 0);
        const result = await insertDayPlan(day, dayPlan, data.currency, offset, coords);
        written += result.written;
        failures.push(...result.failures);
      }

      await applyTripMetadata(data);
      await persistConflicts(data.conflicts);

      toast.success(
        `${data.itinerary.length} days planned, ${written} activities saved.`,
        mode === 'append' ? 'Added to your itinerary 🤖' : 'AI Itinerary Ready 🤖'
      );

      // Say so rather than quietly reporting a smaller number than the user
      // watched the progress bar count to.
      if (failures.length) {
        console.warn('[WanderForge] Activities rejected on insert:', failures);
        toast.error(
          `${failures.length} activity(s) could not be saved: ${failures[0]}`,
          'Partly saved'
        );
      }

      // The plan is real and editable either way, but an unachievable one must
      // not arrive looking like a clean result.
      const conflicts = data.conflicts;
      if (conflicts && !conflicts.achievable) {
        const blocking = conflicts.summary?.errors ?? 0;
        toast.error(
          `The check found ${blocking || conflicts.issues.length} transition(s) that will not work — open Check Itinerary to see which.`,
          'Saved, but not fully achievable'
        );
      }

      // No reconciling read. Every row written came back from the insert and is
      // already on screen; re-reading 25 rows the browser just wrote is the
      // pattern this whole ticket is about.
    } catch (err) {
      // An abort is a choice, not a failure, and must not be reported as one.
      if (err?.name !== 'AbortError') toast.error(err.message, 'AI Generation Failed');
    } finally {
      generateAbortRef.current = null;
      generatingRef.current = false;
      setAiGenerating(false);
      setAiProgress(null);
      setStreaming(null);
    }
  };

  /**
   * Stop a generation in flight.
   *
   * Closing the connection is what stops it: the route aborts its own request to
   * Groq when the browser goes away, so a cancelled generation stops being
   * billed rather than running to completion into a socket nobody is reading.
   * Nothing has been written at this point, so there is nothing to roll back.
   */
  const handleCancelGenerate = () => {
    if (!generateAbortRef.current) return;
    generateAbortRef.current.abort();
    toast.info('Generation stopped. Your itinerary is unchanged.', 'Cancelled');
  };

  const handleAIGenerate = () => {
    if (!trip) return;
    // blockedByLock() also raises a toast explaining why, so call it first.
    if (blockedByLock()) return;

    const decision = planGeneration({
      existingCount: Object.values(activities).flat().length,
      inFlight: generatingRef.current,
      locked: isLocked,
    });

    if (decision.action === 'ignore') return;
    if (decision.action === 'confirm') {
      setPendingGenerate({ existing: decision.existing });
      return;
    }

    runGenerate(decision.mode);
  };

  /**
   * Fill just the selected day.
   *
   * This button used to call handleAIGenerate, so "AI Fill" on one empty day
   * regenerated the entire trip. replanDay cannot be reused here — it rejects an
   * empty day outright — so ask for a single day's plan instead, which also costs
   * a fraction of the tokens of a full trip.
   */
  const handleAIFillDay = async () => {
    if (blockedByLock() || !trip || !selectedDay) return;
    if (generatingRef.current) return;
    generatingRef.current = true;
    setAiGenerating(true);
    setAiProgress({ phase: 'planning', done: 0, total: 0 });

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: trip.destination,
          days: 1,
          interests: trip.ai_preferences?.interests || [],
          transportMode: trip.transport_mode,
          budgetLevel: trip.ai_preferences?.budget_level || 'moderate',
          notes: trip.ai_preferences?.notes || '',
          destLat: trip.dest_lat,
          destLng: trip.dest_lng,
          totalBudget: trip.total_budget,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const dayPlan = data.itinerary?.[0];
      if (!dayPlan?.activities?.length) throw new Error('The AI returned an empty day.');

      setAiProgress({ phase: 'saving', done: 0, total: dayPlan.activities.length });
      const offset = activities[selectedDay.id]?.length || 0;
      const coords = await geocodeBatch(
        unresolvedLocations(dayPlan.activities),
        trip.dest_lat != null ? { lat: trip.dest_lat, lng: trip.dest_lng } : null
      );
      const { written, failures } = await insertDayPlan(
        selectedDay, dayPlan, data.currency, offset, coords
      );
      await applyTripMetadata(data);
      // Deliberately not persisted: this checked one day, and writing it to
      // trips.conflicts would claim the whole trip had been re-checked.

      toast.success(
        `Day ${selectedDay.day_number} filled with ${written} activities.`,
        dayPlan.theme || 'Day Planned 🤖'
      );

      if (failures.length) {
        console.warn('[WanderForge] Activities rejected on insert:', failures);
        toast.error(
          `${failures.length} activity(s) could not be saved: ${failures[0]}`,
          'Partly saved'
        );
      }

      if (data.conflicts && !data.conflicts.achievable) {
        toast.error(
          'Some transitions on this day will not work — open Check Itinerary to see which.',
          'Filled, but not fully achievable'
        );
      }
    } catch (err) {
      toast.error(err.message, 'AI Fill Failed');
    } finally {
      generatingRef.current = false;
      setAiGenerating(false);
      setAiProgress(null);
    }
  };

  /**
   * The live conflict check.
   *
   * Recomputed from whatever is currently on screen, on every edit. It is a pure
   * function over already-loaded data — no AI, no network, no cost — so there is
   * no reason to make the user press a button and wait for it, and no reason for
   * the result to ever be stale. The generate route runs the same checker
   * server-side before writing; this is the same answer, kept current.
   *
   * Travel times come from the checker's road model rather than a routing call.
   * Fetching real road legs would be more accurate and would cost a billed
   * Google Routes request per pair of activities, every time a day is opened.
   */
  const conflictReport = useMemo(() => {
    if (!trip || days.length === 0) {
      return { issues: [], summary: { errors: 0, warnings: 0, info: 0, checkedDays: 0, checkedActivities: 0 } };
    }
    return checkItinerary(trip, days, activities);
  }, [trip, days, activities]);

  // Thrown during render so the not-found boundary catches it. Calling
  // notFound() from the fetch callback would not be caught at all.
  if (missing) notFound();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', flexDirection: 'column', gap: '16px' }}>
        <LoadingSpinner size={48} />
        <p style={{ color: 'var(--color-text-tertiary)' }}>Loading your trip...</p>
      </div>
    );
  }

  if (!trip) return null;

  const selectedDayActivities = selectedDay ? (activities[selectedDay.id] || []) : [];
  const allActivities = Object.values(activities).flat();
  const activityCost = allActivities.reduce((sum, a) => sum + (parseFloat(a.cost) || 0), 0);
  // Accommodation and transport are real trip spend, so they belong in the total
  // the traveler is comparing against their budget.
  const booked = bookingsTotal(stays, transport);
  const totalCost = activityCost + booked.total;
  // Fall back to the destination when the trip has no stored currency yet.
  const tripCurrency = trip.currency || inferCurrency(trip.destination) || 'USD';
  // The lock is enforced by RLS as well; this only drives the UI.
  const isLocked = !!trip.itinerary_locked;
  const isOwner = trip.user_id === user?.id;
  const selectedDayWeather = weather && selectedDay?.date
    ? weather.find(w => w.date === selectedDay.date) : null;
  const selectedDayConflicts = selectedDay
    ? dayConflictSummary(conflictReport.issues, selectedDay.day_number)
    : null;

  return (
    <>
      <div className="editor">
        {/* Trip Header */}
        <div className="editor__header">
          <div className="container">
            <div className="editor__header-inner">
              <div className="editor__header-info">
                <button className="editor__back" onClick={() => router.push('/dashboard')}>
                  ← Dashboard
                </button>
                <h1 className="editor__title">{trip.title}</h1>
                <div className="editor__meta">
                  <span>📍 {trip.destination}</span>
                  {trip.start_date && (
                    <span>📅 {new Date(trip.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {trip.end_date && ` — ${new Date(trip.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    </span>
                  )}
                  <span>💰 {formatMoney(totalCost, tripCurrency)} spent{trip.total_budget ? ` / ${formatMoney(trip.total_budget, tripCurrency)} budget` : ''}</span>
                  <span>📋 {allActivities.length} activities</span>
                </div>
              </div>
              <TripActionBar
                actions={[
                  isOwner && {
                    key: 'lock',
                    label: isLocked ? 'Unlock' : 'Lock',
                    icon: isLocked ? '🔒' : '🔓',
                    variant: isLocked ? 'primary' : 'ghost',
                    onClick: handleToggleLock,
                    loading: togglingLock,
                    disabled: togglingLock,
                    title: isLocked
                      ? 'Unlock so the group can edit the itinerary again'
                      : 'Freeze the itinerary so nobody can change it',
                  },
                  {
                    key: 'settings',
                    label: 'Trip Settings',
                    icon: '⚙️',
                    onClick: () => setShowSettings(true),
                    title: 'Edit the title, dates, destination, budget or transport — or delete the trip',
                  },
                  {
                    key: 'nearby',
                    label: 'Find Nearby',
                    icon: '🧭',
                    onClick: () => setShowNearby(true),
                    disabled: isLocked,
                  },
                  {
                    key: 'bookings',
                    label: 'Bookings',
                    icon: '🏨',
                    onClick: () => setShowBookings(true),
                  },
                  {
                    key: 'locate',
                    label: locating ? `Locating ${locating.done}/${locating.total}` : 'Locate on Map',
                    icon: '📍',
                    onClick: handleLocateActivities,
                    loading: !!locating,
                    disabled: !!locating || isLocked,
                  },
                  {
                    key: 'conflicts',
                    label: 'Check Itinerary',
                    icon: '🔍',
                    onClick: () => setShowConflicts(true),
                  },
                  {
                    key: 'expenses',
                    label: 'Split Bills',
                    icon: '🧾',
                    onClick: () => setShowExpenses(true),
                  },
                ].filter(Boolean)}
                primaryAction={{
                  key: 'ai-generate',
                  // A silent multi-minute run is what makes people click again,
                  // so say which phase it is in and how far along.
                  // The panel below carries the detail now; this just has to
                  // stop looking like a button worth pressing again.
                  label: !aiGenerating
                    ? 'AI Generate'
                    : aiProgress?.phase === 'saving' && aiProgress.total
                      ? `Saving ${aiProgress.done}/${aiProgress.total}`
                      : streaming?.days?.length
                        ? `Day ${streaming.days.length} of ${streaming.expected || '?'}`
                        : 'Planning...',
                  icon: '🤖',
                  onClick: handleAIGenerate,
                  loading: aiGenerating,
                  disabled: aiGenerating || isLocked,
                }}
              >
                <CollaborationPanel
                  tripId={id}
                  trip={trip}
                  days={days}
                  activities={activities}
                  collaborators={collaborators}
                  bookings={{ stays, transport }}
                  onlineUsers={onlineUsers}
                  onRefresh={() => { fetchCollaborators(); fetchTripData(); }}
                />
              </TripActionBar>
            </div>
          </div>
        </div>

        {isLocked && (
          <div className="container">
            <div className="lock-banner">
              <span className="lock-banner__icon">🔒</span>
              <div>
                <strong className="lock-banner__title">Itinerary locked</strong>
                <span className="lock-banner__text">
                  {isOwner
                    ? 'You froze this plan. Unlock it to make changes.'
                    : 'The trip owner has frozen this plan. Ask them to unlock it to make changes.'}
                  {' '}Splitting bills still works as normal.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Map Section */}
        <div className="editor__map-section">
          <div className="container">
            <DynamicMap
              activities={selectedDayActivities}
              center={trip.dest_lat && trip.dest_lng ? [trip.dest_lat, trip.dest_lng] : undefined}
              height="350px"
              showRoute={true}
              selectedActivityId={selectedActivityId}
              onActivityClick={(a) => setSelectedActivityId(a.id)}
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="editor__body">
          <div className="container">
            <div className="editor__layout">
              {/* Day Sidebar */}
              <aside className="editor__sidebar">
                <h3 className="sidebar__title">Days</h3>
                <div className="sidebar__days">
                  {days.map((day) => {
                    const dayActs = activities[day.id] || [];
                    const isSelected = selectedDay?.id === day.id;
                    const dayWeather = weather?.find(w => w.date === day.date);
                    // A broken day has to be findable without opening it.
                    const dayIssues = dayConflictSummary(conflictReport.issues, day.day_number);
                    return (
                      <button key={day.id}
                        className={`day-tab ${isSelected ? 'day-tab--selected' : ''} ${dayIssues.impossible ? 'day-tab--broken' : ''}`}
                        onClick={() => { setSelectedDay(day); setSelectedActivityId(null); }}
                      >
                        <div className="day-tab__top">
                          <span className="day-tab__number">Day {day.day_number}</span>
                          <span className="day-tab__marks">
                            {dayIssues.impossible && (
                              <span className="day-tab__flag day-tab__flag--bad"
                                title={`${dayIssues.hard.length} thing(s) on this day will not work`}>⛔</span>
                            )}
                            {!dayIssues.impossible && dayIssues.worst === 'warning' && (
                              <span className="day-tab__flag day-tab__flag--warn"
                                title={`${dayIssues.soft.length} thing(s) worth checking`}>⚠️</span>
                            )}
                            {dayWeather && <span className="day-tab__weather" title={dayWeather.description}>{dayWeather.icon}</span>}
                          </span>
                        </div>
                        <span className="day-tab__date">
                          {day.date && new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <span className="day-tab__count">{dayActs.length} activities</span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Timeline Content */}
              <main className="editor__main">
                {selectedDay && (
                  <>
                    <div className="main__header">
                      <div>
                        <h2 className="main__day-title">Day {selectedDay.day_number}</h2>
                        <p className="main__day-date">
                          {selectedDay.date && new Date(selectedDay.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {selectedDayWeather && (
                          <div className="weather-badge">
                            <span>{selectedDayWeather.icon}</span>
                            <span>{selectedDayWeather.tempMax}°/{selectedDayWeather.tempMin}°</span>
                            <span className="weather-badge__desc">{selectedDayWeather.description}</span>
                          </div>
                        )}
                        {lastReplan?.dayId === selectedDay.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleUndoReplan}
                            loading={undoing}
                            disabled={undoing || isLocked}
                            icon={<span>↩</span>}
                            title="Put this day back exactly as it was before the replan"
                          >
                            Undo replan
                          </Button>
                        )}
                        {selectedDayActivities.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReplanDay(selectedDay)}
                            loading={replanningDay === selectedDay.day_number}
                            disabled={replanningDay != null || isLocked}
                            icon={<span>🔄</span>}
                            title="Rebuild this day around everything on it: order, timings and travel"
                          >
                            Replan Day
                          </Button>
                        )}
                        <Button variant="primary" size="sm" onClick={openAddActivity} disabled={isLocked}
                          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
                        >
                          Add
                        </Button>
                      </div>
                    </div>

                    {/* Days appear here as the model writes them, so the first
                        one lands in a couple of seconds instead of forty. It is a
                        preview — nothing is written until the server finishes
                        checking the whole plan. */}
                    {aiGenerating && streaming && (
                      <GenerationProgress
                        status={streaming.status}
                        phase={aiProgress?.phase === 'saving' ? 'saving' : 'planning'}
                        streamedDays={streaming.days || []}
                        expected={streaming.expected}
                        saved={aiProgress?.phase === 'saving' ? aiProgress : null}
                        onCancel={handleCancelGenerate}
                      />
                    )}

                    {/* The whole point of S2-3: an impossible day says so where the
                        day is, with the fix next to the problem — not behind a
                        modal the user has to think to open. */}
                    {selectedDayConflicts?.impossible && (
                      <div className="day-alert">
                        <span className="day-alert__icon">⛔</span>
                        <div className="day-alert__body">
                          <strong className="day-alert__title">
                            This day cannot be done as written
                          </strong>
                          <ul className="day-alert__list">
                            {selectedDayConflicts.hard.map((issue, i) => (
                              <li key={i}>{issue.message}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="day-alert__actions">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleReplanDay(selectedDay)}
                            loading={replanningDay === selectedDay.day_number}
                            disabled={replanningDay != null || isLocked}
                            title="Rebuild this day around everything on it: order, timings and travel"
                          >
                            🔄 Fix this day
                          </Button>
                          <button className="day-alert__more" onClick={() => setShowConflicts(true)}>
                            See all checks
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedDayActivities.length === 0 ? (
                      <div className="main__empty">
                        <span>🗓️</span>
                        <h3>No activities yet</h3>
                        <p>Fill just this day with AI, or add activities yourself</p>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
                          <Button variant="primary" size="sm" onClick={openAddActivity} disabled={isLocked}>+ Add Manually</Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleAIFillDay}
                            loading={aiGenerating}
                            disabled={aiGenerating || isLocked}
                          >
                            🤖 Fill Day {selectedDay.day_number}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="timeline">
                        {selectedDayActivities.map((activity, idx) => {
                          const cat = CATEGORY_CONFIG[activity.category] || CATEGORY_CONFIG.other;
                          const isHighlighted = selectedActivityId === activity.id;
                          const actIssues = conflictsForActivity(conflictReport.issues, activity.id);
                          const actWorst = worstSeverity(actIssues);
                          return (
                            <div key={activity.id}
                              className={`timeline__item ${isHighlighted ? 'timeline__item--highlighted' : ''}`}
                              onClick={() => setSelectedActivityId(activity.id)}
                            >
                              <div className="timeline__line">
                                <div className="timeline__dot" style={{ background: cat.color }} />
                                {idx < selectedDayActivities.length - 1 && <div className="timeline__connector" />}
                              </div>
                              <div className={`activity-card ${actWorst ? `activity-card--${actWorst}` : ''}`}>
                                <div className="activity-card__header">
                                  <span className="activity-card__category" style={{ background: `${cat.color}18`, color: cat.color }}>
                                    {cat.icon} {cat.label}
                                  </span>
                                  <div className="activity-card__actions" hidden={isLocked}>
                                    {idx > 0 && <button className="act-btn" onClick={(e) => { e.stopPropagation(); handleMoveActivity(activity.id, 'up'); }}>↑</button>}
                                    {idx < selectedDayActivities.length - 1 && <button className="act-btn" onClick={(e) => { e.stopPropagation(); handleMoveActivity(activity.id, 'down'); }}>↓</button>}
                                    <button className="act-btn" onClick={(e) => { e.stopPropagation(); openEditActivity(activity); }}>✏️</button>
                                    <button className="act-btn act-btn--danger" onClick={(e) => { e.stopPropagation(); setDeletingActivity(activity); }}>🗑️</button>
                                  </div>
                                </div>
                                <h3 className="activity-card__title">{activity.title}</h3>
                                {activity.location_name && <p className="activity-card__location">📍 {activity.location_name}</p>}
                                <div className="activity-card__details">
                                  {activity.start_time && <span>🕐 {activity.start_time?.slice(0, 5)}{activity.end_time && ` – ${activity.end_time.slice(0, 5)}`}</span>}
                                  {parseFloat(activity.cost) > 0 && <span>💰 {formatMoney(activity.cost, tripCurrency)}</span>}
                                  {activity.latitude && <span className="activity-card__mapped">🗺️ Mapped</span>}
                                </div>
                                {activity.description && <p className="activity-card__desc">{activity.description}</p>}
                                {activity.notes && <p className="activity-card__notes">📝 {activity.notes}</p>}
                                {actIssues.map((issue, i) => (
                                  <p key={i} className={`activity-card__issue activity-card__issue--${issue.severity}`}>
                                    {issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'} {issue.message}
                                  </p>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </main>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Modal */}
      <Modal isOpen={showActivityModal} onClose={() => setShowActivityModal(false)} title={editingActivity ? 'Edit Activity' : 'Add Activity'} size="lg">
        <div className="modal-form">
          <Input label="Activity Name *" placeholder="Visit Eiffel Tower" value={activityForm.title} onChange={(e) => setActivityForm(p => ({ ...p, title: e.target.value }))} />
          <Input label="Location" placeholder="Champ de Mars, Paris" value={activityForm.location_name} onChange={(e) => setActivityForm(p => ({ ...p, location_name: e.target.value }))} hint="Auto-geocoded when saved" />

          <div>
            <label className="modal-form__label">Category</label>
            <div className="modal-form__categories">
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <button key={key}
                  className={`cat-btn ${activityForm.category === key ? 'cat-btn--selected' : ''}`}
                  style={activityForm.category === key ? { borderColor: cfg.color, background: `${cfg.color}12` } : {}}
                  onClick={() => setActivityForm(p => ({ ...p, category: key }))}>
                  <span>{cfg.icon}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="modal-form__row">
            <Input label="Start Time" type="time" value={activityForm.start_time} onChange={(e) => setActivityForm(p => ({ ...p, start_time: e.target.value }))} />
            <Input label="End Time" type="time" value={activityForm.end_time} onChange={(e) => setActivityForm(p => ({ ...p, end_time: e.target.value }))} />
            <Input label="Cost" type="number" placeholder="0" value={activityForm.cost} onChange={(e) => setActivityForm(p => ({ ...p, cost: e.target.value }))} />
          </div>

          <Input label="Description" placeholder="Brief description..." value={activityForm.description} onChange={(e) => setActivityForm(p => ({ ...p, description: e.target.value }))} />
          <Input label="Notes" placeholder="Tips, reminders..." value={activityForm.notes} onChange={(e) => setActivityForm(p => ({ ...p, notes: e.target.value }))} />
          <Input label="Booking Link" placeholder="https://..." value={activityForm.booking_link} onChange={(e) => setActivityForm(p => ({ ...p, booking_link: e.target.value }))} />

          <div className="modal-form__actions">
            <Button variant="ghost" onClick={() => setShowActivityModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveActivity} disabled={!activityForm.title.trim()}>
              {editingActivity ? 'Save Changes' : 'Add Activity'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation — replaces window.confirm(), which some browsers
          suppress entirely, silently cancelling the delete. */}
      <Modal
        isOpen={!!deletingActivity}
        onClose={() => setDeletingActivity(null)}
        title="Delete Activity"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
            Delete <strong style={{ color: 'var(--color-text)' }}>{deletingActivity?.title}</strong>? This cannot be undone.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button variant="ghost" onClick={() => setDeletingActivity(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmDeleteActivity}>Delete</Button>
          </div>
        </div>
      </Modal>

      <ConfirmGenerateModal
        pending={pendingGenerate}
        onCancel={() => setPendingGenerate(null)}
        onReplace={() => runGenerate('replace')}
        onAppend={() => runGenerate('append')}
      />

      <NearbyPlacesPanel
        trip={{ ...trip, currency: tripCurrency }}
        days={days}
        activities={activities}
        selectedDay={selectedDay}
        isOpen={showNearby}
        onClose={() => setShowNearby(false)}
        onAdded={fetchTripData}
      />

      <BookingsPanel
        tripId={id}
        trip={{ ...trip, currency: tripCurrency }}
        isOpen={showBookings}
        onClose={() => setShowBookings(false)}
        onChanged={fetchBookings}
      />

      <ExpenseSplitPanel
        tripId={id}
        trip={{ ...trip, currency: tripCurrency }}
        collaborators={collaborators}
        isOpen={showExpenses}
        onClose={() => setShowExpenses(false)}
      />

      {/* Mounted only while open, so the form re-seeds from the trip each time
          rather than needing an effect to reset it. */}
      {showSettings && (
      <TripSettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        trip={trip}
        days={days}
        activities={activities}
        onSave={handleSaveTrip}
        onDelete={handleDeleteTrip}
        saving={savingTrip}
        deleting={deletingTrip}
        // Editors may change a trip; only the owner may destroy it.
        canDelete={isOwner}
      />
      )}

      <ConflictCheckPanel
        isOpen={showConflicts}
        onClose={() => setShowConflicts(false)}
        report={conflictReport}
        trip={trip}
        onFixDay={handleFixDay}
        fixingDay={replanningDay}
        locked={isLocked}
      />

      {/* AI Chat Panel */}
      <AIChatPanel
        trip={trip}
        days={days}
        activities={activities}
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        onApplied={fetchTripData}
      />

      {/* Floating Chat FAB */}
      {!showChat && (
        <button className="chat-fab" onClick={() => setShowChat(true)} title="AI Assistant">
          <span>🧭</span>
        </button>
      )}

      <style jsx>{`
        .editor { min-height: calc(100vh - var(--navbar-height)); }

        .chat-fab {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
          border: none;
          box-shadow: 0 4px 20px rgba(0,0,0,0.25);
          cursor: pointer;
          font-size: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          transition: all var(--transition-base);
        }
        .chat-fab:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(0,0,0,0.3); }

        .editor__header {
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border-light);
          padding: var(--space-5) 0;
        }

        .editor__header-inner {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-4);
          flex-wrap: wrap;
        }

        /* The action row lives in TripActionBar, which owns its own wrapping and
           its below-768px overflow menu. The rule that used to be here set
           flex-shrink: 0 with no flex-wrap, which pushed AI Generate off-screen
           on phones. */

        .editor__back {
          background: none; border: none;
          color: var(--color-text-tertiary);
          font-family: var(--font-body); font-size: var(--text-sm);
          cursor: pointer; padding: 0; margin-bottom: var(--space-1);
        }

        .editor__back:hover { color: var(--color-primary); }
        .editor__title { font-size: var(--text-xl); margin-bottom: var(--space-1); }
        .editor__meta { display: flex; gap: var(--space-4); flex-wrap: wrap; font-size: var(--text-sm); color: var(--color-text-secondary); }

        .editor__map-section { padding: var(--space-4) 0 0; }
        .editor__body { padding: var(--space-4) 0 var(--space-16); }

        .editor__layout {
          display: grid;
          grid-template-columns: 220px 1fr;
          gap: var(--space-5);
          align-items: start;
        }

        .editor__sidebar { position: sticky; top: calc(var(--navbar-height) + var(--space-4)); }
        .sidebar__title { font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-tertiary); margin-bottom: var(--space-2); padding: 0 var(--space-2); }
        .sidebar__days { display: flex; flex-direction: column; gap: 2px; }

        .day-tab {
          display: flex; flex-direction: column; align-items: flex-start;
          padding: var(--space-2) var(--space-3);
          border: none; background: none; border-radius: var(--radius-md);
          cursor: pointer; font-family: var(--font-body);
          transition: all var(--transition-fast); text-align: left;
          border-left: 3px solid transparent;
        }

        .day-tab:hover { background: var(--color-bg-secondary); }
        .day-tab--selected { background: rgba(var(--color-primary-rgb), 0.08); border-left-color: var(--color-primary); }
        .day-tab__top { display: flex; justify-content: space-between; width: 100%; align-items: center; }
        .day-tab__number { font-weight: 600; font-size: var(--text-sm); color: var(--color-text); }
        .day-tab--selected .day-tab__number { color: var(--color-primary); }
        .lock-banner {
          display: flex; align-items: center; gap: var(--space-3);
          margin: var(--space-4) 0 0;
          padding: var(--space-3) var(--space-4);
          border: 1px solid var(--color-warning);
          border-radius: var(--radius-lg);
          background: var(--color-warning-bg);
        }
        .lock-banner__icon { font-size: 20px; }
        .lock-banner__title { display: block; font-size: var(--text-sm); }
        .lock-banner__text { font-size: var(--text-xs); color: var(--color-text-secondary); }
        .day-tab__weather { font-size: 16px; }
        .day-tab__marks { display: inline-flex; align-items: center; gap: 4px; }
        .day-tab__flag { font-size: 13px; line-height: 1; }
        .day-tab--broken { box-shadow: inset 3px 0 0 var(--color-error); }
        .day-tab__date { font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .day-tab__count { font-size: var(--text-xs); color: var(--color-text-tertiary); }

        .main__header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--space-4); gap: var(--space-3); flex-wrap: wrap; }
        .main__day-title { font-size: var(--text-xl); }
        .main__day-date { font-size: var(--text-sm); color: var(--color-text-secondary); }

        .weather-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 12px; border-radius: var(--radius-full);
          background: var(--color-bg-secondary); font-size: var(--text-sm);
          color: var(--color-text-secondary); white-space: nowrap;
        }

        .weather-badge__desc { font-size: var(--text-xs); color: var(--color-text-tertiary); }

        .main__empty {
          text-align: center; padding: var(--space-12) var(--space-6);
          background: var(--color-surface); border: 2px dashed var(--color-border);
          border-radius: var(--radius-xl);
        }
        .main__empty span { font-size: 40px; }
        .main__empty h3 { font-size: var(--text-lg); margin: var(--space-2) 0 var(--space-1); }
        .main__empty p { color: var(--color-text-tertiary); font-size: var(--text-sm); }

        .timeline { display: flex; flex-direction: column; }
        .timeline__item { display: flex; gap: var(--space-3); cursor: pointer; transition: all var(--transition-fast); }
        .timeline__item--highlighted .activity-card { border-color: var(--color-primary); box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.15); }
        .timeline__line { display: flex; flex-direction: column; align-items: center; width: 18px; flex-shrink: 0; padding-top: 18px; }
        .timeline__dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 3px var(--color-bg); }
        .timeline__connector { width: 2px; flex: 1; background: var(--color-border-light); margin: 3px 0; min-height: 16px; }

        .activity-card {
          flex: 1; background: var(--color-surface); border: 1px solid var(--color-border-light);
          border-radius: var(--radius-lg); padding: var(--space-4); margin-bottom: var(--space-2);
          transition: all var(--transition-base);
        }
        .activity-card:hover { border-color: var(--color-primary-light); box-shadow: var(--shadow-sm); }
        .activity-card__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-1); }
        .activity-card__category { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-full); font-size: 11px; font-weight: 600; }
        /* Faded until hover on pointer devices, but always fully visible on touch —
           hover never fires there, so the edit/delete buttons were unreachable. */
        .activity-card__actions { display: flex; gap: 3px; opacity: 1; transition: opacity var(--transition-fast); }
        @media (hover: hover) {
          .activity-card__actions { opacity: 0.35; }
          .activity-card:hover .activity-card__actions { opacity: 1; }
        }

        .act-btn {
          width: 26px; height: 26px; border-radius: var(--radius-sm);
          border: none; background: var(--color-bg-secondary);
          cursor: pointer; font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          transition: all var(--transition-fast);
        }
        .act-btn:hover { background: var(--color-bg-tertiary); }
        .act-btn--danger:hover { background: var(--color-error-bg); }

        .activity-card__title { font-size: var(--text-base); font-family: var(--font-heading); margin-bottom: 2px; }
        .activity-card__location { font-size: var(--text-sm); color: var(--color-text-secondary); margin-bottom: var(--space-1); }
        .activity-card__details { display: flex; gap: var(--space-3); margin-bottom: var(--space-1); font-size: var(--text-sm); color: var(--color-text-secondary); flex-wrap: wrap; }
        .activity-card__mapped { color: var(--color-success); font-weight: 500; }
        .activity-card__desc { font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.4; }
        .activity-card__notes { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: var(--space-1); font-style: italic; }
        /* A hard conflict outlines the card; a soft one only annotates it. The
           difference has to be visible before the text is read. */
        .activity-card--error { border-color: var(--color-error); background: var(--color-error-bg); }
        .activity-card--warning { border-color: var(--color-warning); }
        .activity-card__issue {
          font-size: var(--text-xs); line-height: 1.4;
          margin-top: var(--space-1); padding-left: var(--space-1);
          border-left: 2px solid transparent;
        }
        .activity-card__issue--error { color: var(--color-error); border-left-color: var(--color-error); font-weight: 500; }
        .activity-card__issue--warning { color: var(--color-warning); border-left-color: var(--color-warning); }
        .activity-card__issue--info { color: var(--color-text-tertiary); }

        .day-alert {
          display: flex; gap: var(--space-3); align-items: flex-start;
          padding: var(--space-3) var(--space-4);
          margin-bottom: var(--space-4);
          border: 1px solid var(--color-error);
          border-left-width: 4px;
          border-radius: var(--radius-md);
          background: var(--color-error-bg);
          flex-wrap: wrap;
        }
        .day-alert__icon { font-size: 20px; line-height: 1.2; }
        .day-alert__body { flex: 1 1 260px; min-width: 0; }
        .day-alert__title { font-size: var(--text-sm); color: var(--color-error); }
        .day-alert__list {
          margin: var(--space-1) 0 0; padding-left: var(--space-4);
          font-size: var(--text-xs); color: var(--color-text-secondary); line-height: 1.5;
        }
        .day-alert__actions { display: flex; align-items: center; gap: var(--space-2); }
        .day-alert__more {
          background: none; border: none; cursor: pointer;
          font-size: var(--text-xs); color: var(--color-text-secondary);
          text-decoration: underline;
        }

        .modal-form { display: flex; flex-direction: column; gap: var(--space-3); }
        .modal-form__label { font-size: var(--text-sm); font-weight: 500; color: var(--color-text); display: block; margin-bottom: 4px; }
        .modal-form__row { display: flex; gap: var(--space-3); }
        .modal-form__row > * { flex: 1; }
        .modal-form__actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-1); }
        .modal-form__categories { display: flex; flex-wrap: wrap; gap: 5px; }

        .cat-btn {
          width: 38px; height: 38px; border-radius: var(--radius-md);
          border: 2px solid var(--color-border-light); background: var(--color-surface);
          cursor: pointer; font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          transition: all var(--transition-fast);
        }
        .cat-btn:hover { border-color: var(--color-primary-light); transform: scale(1.08); }

        @media (max-width: 768px) {
          .editor__layout { grid-template-columns: 1fr; }
          .editor__sidebar { position: static; }
          .sidebar__days { flex-direction: row; overflow-x: auto; gap: var(--space-2); padding-bottom: var(--space-2); }
          .day-tab { flex-shrink: 0; border-left: none; border-bottom: 3px solid transparent; }
          .day-tab--selected { border-left-color: transparent; border-bottom-color: var(--color-primary); }
          .modal-form__row { flex-direction: column; }
        }
      `}</style>
    </>
  );
}
