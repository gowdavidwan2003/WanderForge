'use client';

import { useState, useCallback, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { replanDay } from '@/lib/replanDay';

const CATEGORIES = [
  { id: 'tourism', label: 'Attractions', icon: '🏛️', activityCategory: 'sightseeing' },
  { id: 'food', label: 'Food', icon: '🍜', activityCategory: 'food' },
  { id: 'nature', label: 'Nature', icon: '🌿', activityCategory: 'nature' },
  { id: 'culture', label: 'Culture', icon: '🎭', activityCategory: 'culture' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️', activityCategory: 'shopping' },
  { id: 'nightlife', label: 'Nightlife', icon: '🌃', activityCategory: 'nightlife' },
  { id: 'accommodation', label: 'Stays', icon: '🏨', activityCategory: 'accommodation' },
];

const RADII = [
  { m: 2000, label: '2 km' },
  { m: 5000, label: '5 km' },
  { m: 15000, label: '15 km' },
  { m: 25000, label: '25 km' },
];

export default function NearbyPlacesPanel({
  trip, days, activities, selectedDay, isOpen, onClose, onAdded,
}) {
  const [category, setCategory] = useState('tourism');
  const [radius, setRadius] = useState(5000);
  const [places, setPlaces] = useState([]);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(null);
  const [addedIds, setAddedIds] = useState(new Set());
  const [replanning, setReplanning] = useState(false);
  // Days that received a place this session, so we can offer to tidy them up.
  const [touchedDays, setTouchedDays] = useState(new Set());
  const [targetDayId, setTargetDayId] = useState(selectedDay?.id || days?.[0]?.id);

  const toast = useToast();
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (selectedDay?.id) setTargetDayId(selectedDay.id);
  }, [selectedDay?.id]);

  // Search around the last mapped stop of the selected day, so "nearby" means
  // near where the traveler actually is — falling back to the destination.
  const centre = (() => {
    const dayActs = (activities?.[selectedDay?.id] || []).filter(
      (a) => typeof a.latitude === 'number' && typeof a.longitude === 'number'
    );
    const last = dayActs[dayActs.length - 1];
    if (last) return { lat: last.latitude, lng: last.longitude, from: `"${last.title}"` };
    if (trip?.dest_lat != null) return { lat: trip.dest_lat, lng: trip.dest_lng, from: trip.destination };
    return null;
  })();

  const search = useCallback(async () => {
    if (!centre) return;
    setLoading(true);
    setPlaces([]);
    try {
      const params = new URLSearchParams({
        lat: centre.lat, lng: centre.lng, radius, category,
      });
      const res = await fetch(`/api/places?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlaces(data.places || []);
      setSource(data.source);
    } catch (err) {
      toast.error(err.message, 'Nearby search failed');
    } finally {
      setLoading(false);
    }
  }, [centre?.lat, centre?.lng, radius, category]);

  useEffect(() => {
    if (isOpen && centre) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, category, radius]);

  const addPlace = async (place) => {
    if (trip?.itinerary_locked) return toast.error('This itinerary is locked.', 'Locked 🔒');
    const day = days?.find((d) => d.id === targetDayId);
    if (!day) return toast.error('Pick a day first');

    setAdding(place.id);
    try {
      const existing = activities?.[day.id] || [];
      const cat = CATEGORIES.find((c) => c.id === category)?.activityCategory || 'other';

      // Coordinates come straight from the search result, so no geocoding round
      // trip is needed and the pin is exactly where the user saw it.
      const { error } = await supabase.from('activities').insert({
        trip_day_id: day.id,
        title: place.name,
        description: place.description || '',
        location_name: place.name,
        category: cat,
        cost: 0,
        notes: [
          place.opening_hours ? `Opening hours: ${place.opening_hours}` : '',
          place.phone ? `Phone: ${place.phone}` : '',
          place.rating ? `Rated ${place.rating}/5` : '',
        ].filter(Boolean).join(' · '),
        booking_link: place.website || '',
        order_index: existing.length,
        currency: trip?.currency || 'USD',
        latitude: place.lat,
        longitude: place.lng,
      });
      if (error) throw error;

      setAddedIds((prev) => new Set(prev).add(place.id));
      setTouchedDays((prev) => new Set(prev).add(day.id));
      toast.success(`${place.name} added to Day ${day.day_number}`, 'Added');
      onAdded?.();
    } catch (err) {
      toast.error(err.message, 'Could not add place');
    } finally {
      setAdding(null);
    }
  };

  // Places are appended as they're picked, which leaves the day out of order and
  // without travel time. Replanning is deliberate rather than automatic so several
  // places can be added over time and tidied up in one pass.
  const handleReplan = async () => {
    const day = days?.find((d) => d.id === targetDayId);
    if (!day) return;

    setReplanning(true);
    const result = await replanDay(supabase, {
      trip,
      day,
      keep: activities?.[day.id] || [],
    });
    setReplanning(false);

    if (!result.ok) return toast.error(result.error, 'Replan failed');

    toast.success(
      `Day ${day.day_number} rebuilt — ${result.count} entries, times and travel sorted.`,
      result.theme || 'Day Replanned'
    );
    setTouchedDays((prev) => {
      const next = new Set(prev);
      next.delete(day.id);
      return next;
    });
    onAdded?.();
  };

  const targetDay = days?.find((d) => d.id === targetDayId);
  const dayNeedsReplan = touchedDays.has(targetDayId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Find Nearby" size="lg">
      <div className="np">
        {!centre ? (
          <p className="np__muted">
            Add at least one activity with a location, or run <strong>Locate on Map</strong>,
            so we know where to search from.
          </p>
        ) : (
          <>
            <p className="np__muted">
              Searching around {centre.from}. New places are added with their exact
              coordinates, so they appear on the map immediately.
            </p>

            <div className="np__cats">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  className={`np-cat ${category === c.id ? 'np-cat--on' : ''}`}
                  onClick={() => setCategory(c.id)}
                >
                  <span>{c.icon}</span> {c.label}
                </button>
              ))}
            </div>

            <div className="np__controls">
              <div className="np__radii">
                {RADII.map((r) => (
                  <button
                    key={r.m}
                    className={`np-chip ${radius === r.m ? 'np-chip--on' : ''}`}
                    onClick={() => setRadius(r.m)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <select
                className="np__day"
                value={targetDayId || ''}
                onChange={(e) => setTargetDayId(e.target.value)}
              >
                {(days || []).map((d) => (
                  <option key={d.id} value={d.id}>Add to Day {d.day_number}</option>
                ))}
              </select>
            </div>

            {targetDay && (
              <div className={`np__replan ${dayNeedsReplan ? 'np__replan--due' : ''}`}>
                <span className="np__replan-text">
                  {dayNeedsReplan
                    ? `Places were appended to the end of Day ${targetDay.day_number}. Replan to fit them in properly.`
                    : `Rebuild Day ${targetDay.day_number} around everything currently on it.`}
                </span>
                <Button
                  variant={dayNeedsReplan ? 'primary' : 'ghost'}
                  size="sm"
                  loading={replanning}
                  disabled={replanning}
                  onClick={handleReplan}
                >
                  Replan Day {targetDay.day_number}
                </Button>
              </div>
            )}

            {loading ? (
              <p className="np__muted">Searching...</p>
            ) : places.length === 0 ? (
              <p className="np__muted">
                Nothing found in this category within {RADII.find((r) => r.m === radius)?.label}.
                Try a wider radius or another category.
              </p>
            ) : (
              <>
                <span className="np__count">
                  {places.length} found {source === 'osm' ? 'via OpenStreetMap' : 'via Google Places'}
                </span>
                <div className="np__list">
                  {places.map((p) => (
                    <div key={p.id} className="np-item">
                      <div className="np-item__body">
                        <span className="np-item__name">{p.name}</span>
                        <span className="np-item__meta">
                          {p.distanceKm.toFixed(1)} km
                          {p.type ? ` · ${String(p.type).replace(/_/g, ' ')}` : ''}
                          {p.rating ? ` · ⭐ ${p.rating}` : ''}
                          {p.cuisine ? ` · ${p.cuisine}` : ''}
                        </span>
                        {p.opening_hours && (
                          <span className="np-item__hours">🕐 {p.opening_hours}</span>
                        )}
                      </div>
                      {addedIds.has(p.id) ? (
                        <span className="np-item__added">✅ Added</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={adding === p.id}
                          disabled={adding !== null}
                          onClick={() => addPlace(p)}
                        >
                          Add
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .np { display: flex; flex-direction: column; gap: var(--space-3); }
        .np__muted { font-size: var(--text-sm); color: var(--color-text-tertiary); }
        .np__cats { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .np-cat {
          padding: 6px 12px; border-radius: 999px;
          border: 1px solid var(--color-border); background: var(--color-surface);
          color: var(--color-text-secondary);
          font-family: var(--font-body); font-size: var(--text-sm); cursor: pointer;
        }
        .np-cat--on {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.12);
          color: var(--color-primary); font-weight: 600;
        }
        .np__controls {
          display: flex; justify-content: space-between; align-items: center;
          gap: var(--space-3); flex-wrap: wrap;
        }
        .np__radii { display: flex; gap: var(--space-1); }
        .np-chip {
          padding: 4px 10px; border-radius: var(--radius-sm);
          border: 1px solid var(--color-border); background: var(--color-surface);
          color: var(--color-text-tertiary);
          font-family: var(--font-body); font-size: var(--text-xs); cursor: pointer;
        }
        .np-chip--on {
          border-color: var(--color-primary); color: var(--color-primary); font-weight: 600;
        }
        .np__day {
          padding: 6px 10px; border-radius: var(--radius-md);
          border: 1px solid var(--color-border); background: var(--color-surface);
          color: var(--color-text); font-family: var(--font-body); font-size: var(--text-sm);
        }
        .np__replan {
          display: flex; align-items: center; justify-content: space-between;
          gap: var(--space-3); flex-wrap: wrap;
          padding: var(--space-3); border-radius: var(--radius-md);
          border: 1px solid var(--color-border);
          background: var(--color-bg-secondary);
        }
        .np__replan--due {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.10);
        }
        .np__replan-text { font-size: var(--text-sm); flex: 1; min-width: 180px; }
        .np__count {
          font-size: var(--text-xs); color: var(--color-text-tertiary);
          text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
        }
        .np__list {
          display: flex; flex-direction: column; gap: var(--space-2);
          max-height: 46vh; overflow-y: auto;
        }
        .np-item {
          display: flex; align-items: center; gap: var(--space-3);
          padding: var(--space-3);
          border-radius: var(--radius-md); background: var(--color-bg-secondary);
        }
        .np-item__body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .np-item__name { font-size: var(--text-sm); font-weight: 600; }
        .np-item__meta { font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .np-item__hours { font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .np-item__added { font-size: var(--text-sm); color: var(--color-success); font-weight: 600; }
      `}</style>
    </Modal>
  );
}
