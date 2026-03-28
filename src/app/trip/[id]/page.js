'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DynamicMap from '@/components/maps/DynamicMap';
import CollaborationPanel from '@/components/trip/CollaborationPanel';
import AIChatPanel from '@/components/trip/AIChatPanel';
import { useRealtimeTrip } from '@/hooks/useRealtimeTrip';

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
  const [days, setDays] = useState([]);
  const [activities, setActivities] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [weather, setWeather] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const [collaborators, setCollaborators] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const [activityForm, setActivityForm] = useState({
    title: '', description: '', location_name: '', category: 'sightseeing',
    start_time: '', end_time: '', cost: '', notes: '', booking_link: '',
    latitude: '', longitude: '',
  });

  // Real-time collaboration
  const handleRealtimeUpdate = useCallback((table, event) => {
    // Auto-refresh when collaborators make changes
    fetchTripData();
  }, []);

  const { onlineUsers } = useRealtimeTrip(id, handleRealtimeUpdate);

  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (!user || !id) return;
    fetchTripData();
    fetchCollaborators();
  }, [user, id]);

  const fetchCollaborators = async () => {
    const { data } = await supabase
      .from('trip_collaborators')
      .select('*, profiles(display_name, email)')
      .eq('trip_id', id);
    setCollaborators((data || []).map(c => ({
      ...c,
      display_name: c.profiles?.display_name,
      email: c.profiles?.email,
    })));
  };

  const fetchTripData = async () => {
    try {
      const { data: tripData, error: tripErr } = await supabase
        .from('trips').select('*').eq('id', id).single();
      if (tripErr) throw tripErr;
      setTrip(tripData);

      const { data: daysData } = await supabase
        .from('trip_days').select('*').eq('trip_id', id).order('day_number');
      setDays(daysData || []);

      if (daysData?.length > 0) {
        if (!selectedDay) setSelectedDay(daysData[0]);

        const dayIds = daysData.map(d => d.id);
        const { data: actData } = await supabase
          .from('activities').select('*').in('trip_day_id', dayIds).order('order_index');

        const grouped = {};
        daysData.forEach(d => { grouped[d.id] = []; });
        (actData || []).forEach(a => {
          if (grouped[a.trip_day_id]) grouped[a.trip_day_id].push(a);
        });
        setActivities(grouped);

        // Fetch weather if we have destination coords
        if (tripData.dest_lat && tripData.dest_lng) {
          fetchWeather(tripData.dest_lat, tripData.dest_lng);
        }
      }
    } catch {
      toast.error('Failed to load trip');
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const fetchWeather = async (lat, lng) => {
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
      const data = await res.json();
      if (data.forecast) setWeather(data.forecast);
    } catch { /* ignore */ }
  };

  // Geocode location
  const geocodeLocation = async (query) => {
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.results?.[0] || null;
    } catch { return null; }
  };

  const openAddActivity = () => {
    setEditingActivity(null);
    setActivityForm({
      title: '', description: '', location_name: '', category: 'sightseeing',
      start_time: '', end_time: '', cost: '', notes: '', booking_link: '',
      latitude: '', longitude: '',
    });
    setShowActivityModal(true);
  };

  const openEditActivity = (activity) => {
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
      const geo = await geocodeLocation(`${activityForm.location_name}, ${trip?.destination}`);
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

  const handleDeleteActivity = async (activityId) => {
    if (!confirm('Delete this activity?')) return;
    await supabase.from('activities').delete().eq('id', activityId);
    toast.success('Deleted');
    fetchTripData();
  };

  const handleMoveActivity = async (activityId, direction) => {
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
  const handleAIGenerate = async () => {
    if (!trip) return;
    setAiGenerating(true);
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: trip.destination,
          days: days.length,
          interests: trip.ai_preferences?.interests || [],
          transportMode: trip.transport_mode,
          budgetLevel: trip.ai_preferences?.budget_level || 'moderate',
          notes: trip.ai_preferences?.notes || '',
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.itinerary) throw new Error('No itinerary returned');

      // Insert generated activities into each day
      for (const dayPlan of data.itinerary) {
        const dayNum = dayPlan.day;
        const day = days.find(d => d.day_number === dayNum);
        if (!day || !dayPlan.activities) continue;

        for (let i = 0; i < dayPlan.activities.length; i++) {
          const act = dayPlan.activities[i];
          // Geocode each activity
          let lat = null, lng = null;
          if (act.location_name) {
            const geo = await geocodeLocation(`${act.location_name}, ${trip.destination}`);
            if (geo) { lat = geo.lat; lng = geo.lng; }
          }

          await supabase.from('activities').insert({
            trip_day_id: day.id,
            title: act.title,
            description: act.description || '',
            location_name: act.location_name || '',
            category: act.category || 'sightseeing',
            start_time: act.start_time || null,
            end_time: act.end_time || null,
            cost: parseFloat(act.cost) || 0,
            notes: act.notes || '',
            booking_link: act.booking_link || '',
            order_index: i,
            currency: data.currency || trip.currency || 'USD',
            latitude: lat,
            longitude: lng,
          });
        }
      }

      // Also geocode destination for weather
      if (!trip.dest_lat) {
        const destGeo = await geocodeLocation(trip.destination);
        if (destGeo) {
          await supabase.from('trips').update({
            dest_lat: destGeo.lat, dest_lng: destGeo.lng
          }).eq('id', trip.id);
          fetchWeather(destGeo.lat, destGeo.lng);
        }
      }

      toast.success(`${data.itinerary.length} days generated with ${data.itinerary.reduce((s, d) => s + (d.activities?.length || 0), 0)} activities!`, 'AI Itinerary Ready 🤖');
      fetchTripData();
    } catch (err) {
      toast.error(err.message, 'AI Generation Failed');
    } finally {
      setAiGenerating(false);
    }
  };

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
  const totalCost = allActivities.reduce((sum, a) => sum + (parseFloat(a.cost) || 0), 0);
  const selectedDayWeather = weather && selectedDay?.date
    ? weather.find(w => w.date === selectedDay.date) : null;

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
                  <span>💰 {trip.currency} {totalCost.toFixed(0)} spent{trip.total_budget ? ` / ${parseFloat(trip.total_budget).toFixed(0)} budget` : ''}</span>
                  <span>📋 {allActivities.length} activities</span>
                </div>
              </div>
              <div className="editor__header-actions">
                <CollaborationPanel
                  tripId={id}
                  trip={trip}
                  days={days}
                  activities={activities}
                  collaborators={collaborators}
                  onlineUsers={onlineUsers}
                  onRefresh={() => { fetchCollaborators(); fetchTripData(); }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAIGenerate}
                  loading={aiGenerating}
                  disabled={aiGenerating}
                  icon={<span>🤖</span>}
                >
                  {aiGenerating ? 'Generating...' : 'AI Generate'}
                </Button>
              </div>
            </div>
          </div>
        </div>

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
                    return (
                      <button key={day.id}
                        className={`day-tab ${isSelected ? 'day-tab--selected' : ''}`}
                        onClick={() => { setSelectedDay(day); setSelectedActivityId(null); }}
                      >
                        <div className="day-tab__top">
                          <span className="day-tab__number">Day {day.day_number}</span>
                          {dayWeather && <span className="day-tab__weather" title={dayWeather.description}>{dayWeather.icon}</span>}
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
                        <Button variant="primary" size="sm" onClick={openAddActivity}
                          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
                        >
                          Add
                        </Button>
                      </div>
                    </div>

                    {selectedDayActivities.length === 0 ? (
                      <div className="main__empty">
                        <span>🗓️</span>
                        <h3>No activities yet</h3>
                        <p>Click &quot;AI Generate&quot; to auto-fill, or add manually</p>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
                          <Button variant="primary" size="sm" onClick={openAddActivity}>+ Add Manually</Button>
                          <Button variant="secondary" size="sm" onClick={handleAIGenerate} loading={aiGenerating}>🤖 AI Fill</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="timeline">
                        {selectedDayActivities.map((activity, idx) => {
                          const cat = CATEGORY_CONFIG[activity.category] || CATEGORY_CONFIG.other;
                          const isHighlighted = selectedActivityId === activity.id;
                          return (
                            <div key={activity.id}
                              className={`timeline__item ${isHighlighted ? 'timeline__item--highlighted' : ''}`}
                              onClick={() => setSelectedActivityId(activity.id)}
                            >
                              <div className="timeline__line">
                                <div className="timeline__dot" style={{ background: cat.color }} />
                                {idx < selectedDayActivities.length - 1 && <div className="timeline__connector" />}
                              </div>
                              <div className="activity-card">
                                <div className="activity-card__header">
                                  <span className="activity-card__category" style={{ background: `${cat.color}18`, color: cat.color }}>
                                    {cat.icon} {cat.label}
                                  </span>
                                  <div className="activity-card__actions">
                                    {idx > 0 && <button className="act-btn" onClick={(e) => { e.stopPropagation(); handleMoveActivity(activity.id, 'up'); }}>↑</button>}
                                    {idx < selectedDayActivities.length - 1 && <button className="act-btn" onClick={(e) => { e.stopPropagation(); handleMoveActivity(activity.id, 'down'); }}>↓</button>}
                                    <button className="act-btn" onClick={(e) => { e.stopPropagation(); openEditActivity(activity); }}>✏️</button>
                                    <button className="act-btn act-btn--danger" onClick={(e) => { e.stopPropagation(); handleDeleteActivity(activity.id); }}>🗑️</button>
                                  </div>
                                </div>
                                <h3 className="activity-card__title">{activity.title}</h3>
                                {activity.location_name && <p className="activity-card__location">📍 {activity.location_name}</p>}
                                <div className="activity-card__details">
                                  {activity.start_time && <span>🕐 {activity.start_time?.slice(0, 5)}{activity.end_time && ` – ${activity.end_time.slice(0, 5)}`}</span>}
                                  {parseFloat(activity.cost) > 0 && <span>💰 {trip.currency} {parseFloat(activity.cost).toFixed(0)}</span>}
                                  {activity.latitude && <span className="activity-card__mapped">🗺️ Mapped</span>}
                                </div>
                                {activity.description && <p className="activity-card__desc">{activity.description}</p>}
                                {activity.notes && <p className="activity-card__notes">📝 {activity.notes}</p>}
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

      {/* AI Chat Panel */}
      <AIChatPanel
        trip={trip}
        days={days}
        activities={activities}
        isOpen={showChat}
        onClose={() => setShowChat(false)}
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

        .editor__header-actions { display: flex; gap: var(--space-2); flex-shrink: 0; }

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
        .day-tab__weather { font-size: 16px; }
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
        .activity-card__actions { display: flex; gap: 3px; opacity: 0; transition: opacity var(--transition-fast); }
        .activity-card:hover .activity-card__actions { opacity: 1; }

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
