'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { withTimeout } from '@/lib/withTimeout';
import { useAuth } from '@/context/AuthProvider';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Footer from '@/components/layout/Footer';

export default function DashboardPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [trips, setTrips] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [respondingTo, setRespondingTo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Explorer';

  const fetchTrips = useCallback(async () => {
    // Wait for auth to resolve before deciding anything. Previously this returned
    // early whenever `user` was falsy without clearing `loading`, so an unresolved
    // or expired session left "Loading your trips..." on screen indefinitely.
    if (authLoading) return;

    if (!user) {
      setLoading(false);
      router.replace('/auth/login?redirect=%2Fdashboard');
      return;
    }

    setError(null);

    // Each call is timed and settled independently. Bundling them in a single
    // Promise.all made the dashboard all-or-nothing: one slow call blanked
    // everything, including trips that had already come back fine.
    const attempt = async (label, run) => {
      try {
        const { data, error: qErr } = await withTimeout(run(), label, 20000);
        if (qErr) throw qErr;
        return { data };
      } catch (err) {
        // A stalled query almost always means it was queued behind a token
        // refresh that hadn't settled. Force the refresh, then retry once —
        // that turns a visible failure into an invisible hiccup.
        console.warn(`[WanderForge] ${label} stalled, refreshing session and retrying...`);
        try {
          await withTimeout(supabase.auth.refreshSession(), 'Refreshing session', 10000);
          const { data, error: qErr } = await withTimeout(run(), label, 20000);
          if (qErr) throw qErr;
          return { data };
        } catch (retryErr) {
          console.error(`[WanderForge] ${label} failed after retry:`, retryErr);
          return { failed: retryErr.message || String(retryErr) };
        }
      }
    };

    // Trips the user owns, plus trips shared via an accepted invitation. This
    // previously filtered on user_id alone, so collaborators never saw a shared
    // trip on their dashboard at all.
    const [owned, sharedIds, invites] = await Promise.all([
      attempt('Loading your trips', () =>
        supabase.from('trips').select('*').eq('user_id', user.id)),
      attempt('Loading shared trips', () => supabase.rpc('get_shared_trip_ids')),
      attempt('Loading invitations', () => supabase.rpc('get_my_invitations')),
    ]);

    let shared = [];
    const ids = (sharedIds.data || []).map(r =>
      typeof r === 'string' ? r : r.get_shared_trip_ids
    );
    if (ids.length) {
      const res = await attempt('Loading shared trip details', () =>
        supabase.from('trips').select('*').in('id', ids));
      shared = (res.data || []).map(t => ({ ...t, shared: true }));
    }

    setTrips(
      [...(owned.data || []), ...shared].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      )
    );
    setInvitations(invites.data || []);

    // Only the owned-trips query is essential. If the collaboration extras fail
    // we still render the dashboard rather than replacing it with an error.
    if (owned.failed) {
      setError(owned.failed);
    } else if (sharedIds.failed || invites.failed) {
      setError(null);
      console.warn('[WanderForge] Collaboration data unavailable; showing owned trips only.');
    }

    setLoading(false);
    // Keyed on the user id, not the user object — Supabase hands back a new object
    // on every token refresh, which would otherwise refire this on each cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, router]);

  const resetSession = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      /* clearing local state below is what matters */
    }
    try {
      Object.keys(window.localStorage)
        .filter(k => k.startsWith('sb-'))
        .forEach(k => window.localStorage.removeItem(k));
    } catch { /* storage may be unavailable */ }
    router.replace('/auth/login?redirect=%2Fdashboard');
  };

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const respondToInvite = async (invite, accept) => {
    setRespondingTo(invite.id);
    try {
      if (accept) {
        const { error } = await supabase
          .from('trip_collaborators')
          .update({ accepted: true })
          .eq('id', invite.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('trip_collaborators')
          .delete()
          .eq('id', invite.id);
        if (error) throw error;
      }
      await fetchTrips();
    } catch (err) {
      console.error('[WanderForge] Invitation response failed:', err);
    } finally {
      setRespondingTo(null);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: 'var(--color-text-tertiary)',
      planned: 'var(--color-info)',
      in_progress: 'var(--color-warning)',
      completed: 'var(--color-success)',
    };
    return colors[status] || colors.draft;
  };

  const getStatusLabel = (status) => {
    const labels = {
      draft: 'Draft',
      planned: 'Planned',
      in_progress: 'In Progress',
      completed: 'Completed',
    };
    return labels[status] || 'Draft';
  };

  return (
    <>
      <div className="dashboard">
        {/* Welcome Section */}
        <section className="dashboard__welcome">
          <div className="container">
            <div className="welcome-card glass animate-fade-in-up">
              <div className="welcome-card__content">
                <span className="welcome-card__greeting text-accent">
                  {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'},
                </span>
                <h1 className="welcome-card__name">{displayName} 👋</h1>
                <p className="welcome-card__subtitle">Ready to forge your next adventure?</p>
              </div>
              <Link href="/trip/new">
                <Button
                  size="lg"
                  variant="primary"
                  icon={
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  }
                >
                  Plan New Trip
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Quick Stats */}
        <section className="dashboard__stats">
          <div className="container">
            <div className="stats-grid animate-fade-in-up stagger-1">
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'rgba(var(--color-primary-rgb), 0.12)' }}>✈️</div>
                <div className="stat-card__info">
                  <span className="stat-card__value">{trips.length}</span>
                  <span className="stat-card__label">Total Trips</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-info-bg)' }}>📍</div>
                <div className="stat-card__info">
                  <span className="stat-card__value">{new Set(trips.map(t => t.destination)).size}</span>
                  <span className="stat-card__label">Destinations</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-success-bg)' }}>✅</div>
                <div className="stat-card__info">
                  <span className="stat-card__value">{trips.filter(t => t.status === 'completed').length}</span>
                  <span className="stat-card__label">Completed</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card__icon" style={{ background: 'var(--color-warning-bg)' }}>🗓️</div>
                <div className="stat-card__info">
                  <span className="stat-card__value">{trips.filter(t => t.status === 'planned' || t.status === 'in_progress').length}</span>
                  <span className="stat-card__label">Upcoming</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pending Invitations */}
        {invitations.length > 0 && (
          <section className="dashboard__invites">
            <div className="container">
              <h2 className="section-heading">
                Trip Invitations <span className="invite-count">{invitations.length}</span>
              </h2>
              <div className="invites-list">
                {invitations.map((inv) => (
                  <div key={inv.id} className="invite-card animate-fade-in-up">
                    <div className="invite-card__icon">✉️</div>
                    <div className="invite-card__body">
                      <h3 className="invite-card__title">{inv.trip_title || 'Untitled Trip'}</h3>
                      <p className="invite-card__meta">
                        📍 {inv.trip_destination || 'No destination'}
                        {inv.trip_start_date && ` · ${new Date(inv.trip_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                      </p>
                      <p className="invite-card__from">
                        <strong>{inv.owner_name || inv.owner_email}</strong> invited you as <strong>{inv.role}</strong>
                      </p>
                    </div>
                    <div className="invite-card__actions">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => respondToInvite(inv, true)}
                        loading={respondingTo === inv.id}
                        disabled={respondingTo === inv.id}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => respondToInvite(inv, false)}
                        disabled={respondingTo === inv.id}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Trips Section */}
        <section className="dashboard__trips">
          <div className="container">
            <div className="section-top">
              <h2 className="section-heading">Your Trips</h2>
              <Link href="/explore">
                <Button variant="ghost" size="sm">Browse Templates →</Button>
              </Link>
            </div>

            {loading ? (
              <div className="dashboard__loading">
                <LoadingSpinner size={48} />
                <p>Loading your trips...</p>
              </div>
            ) : error ? (
              <div className="dashboard__empty animate-fade-in-up">
                <div className="empty-state">
                  <span className="empty-state__icon">⚠️</span>
                  <h3 className="empty-state__title">Couldn&apos;t load your trips</h3>
                  <p className="empty-state__desc">{error}</p>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
                    <Button variant="primary" onClick={() => { setLoading(true); fetchTrips(); }}>
                      Try Again
                    </Button>
                    <Button variant="ghost" onClick={resetSession}>
                      Reset Session
                    </Button>
                  </div>
                </div>
              </div>
            ) : trips.length === 0 ? (
              <div className="dashboard__empty animate-fade-in-up">
                <div className="empty-state">
                  <span className="empty-state__icon">🗺️</span>
                  <h3 className="empty-state__title">No trips yet</h3>
                  <p className="empty-state__desc">
                    Your adventure begins here. Let our AI craft the perfect itinerary for you.
                  </p>
                  <Link href="/trip/new">
                    <Button variant="primary" size="lg">
                      Create Your First Trip
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="trips-grid">
                {trips.map((trip, i) => (
                  <Link
                    href={`/trip/${trip.id}`}
                    key={trip.id}
                    className={`trip-card animate-fade-in-up`}
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div
                      className="trip-card__cover"
                      style={{
                        background: `linear-gradient(135deg, 
                          hsl(${(trip.destination?.charCodeAt(0) || 0) * 7 % 360}, 60%, 50%), 
                          hsl(${(trip.destination?.charCodeAt(1) || 0) * 11 % 360}, 50%, 40%))`,
                      }}
                    >
                      <span className="trip-card__cover-emoji">
                        {trip.transport_mode === 'car' ? '🚗' : trip.transport_mode === 'flight' ? '✈️' : '🌍'}
                      </span>
                    </div>
                    <div className="trip-card__body">
                      <div className="trip-card__status" style={{ color: getStatusColor(trip.status) }}>
                        <span className="trip-card__status-dot" style={{ background: getStatusColor(trip.status) }} />
                        {getStatusLabel(trip.status)}
                      </div>
                      <h3 className="trip-card__title">
                        {trip.title || 'Untitled Trip'}
                        {trip.shared && <span className="trip-card__shared">Shared</span>}
                      </h3>
                      <p className="trip-card__destination">📍 {trip.destination || 'No destination'}</p>
                      {trip.start_date && (
                        <p className="trip-card__dates">
                          {new Date(trip.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {trip.end_date && ` — ${new Date(trip.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <Footer />

      <style jsx>{`
        .dashboard {
          min-height: calc(100vh - var(--navbar-height));
          padding-bottom: var(--space-12);
        }

        /* Welcome */
        .dashboard__welcome {
          padding: var(--space-8) 0 var(--space-4);
        }

        .welcome-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-8) var(--space-10);
          border-radius: var(--radius-2xl);
          gap: var(--space-6);
          flex-wrap: wrap;
        }

        .welcome-card__greeting {
          font-size: var(--text-xl);
          color: var(--color-primary);
          display: block;
        }

        .welcome-card__name {
          font-size: var(--text-3xl);
          margin: var(--space-1) 0;
        }

        .welcome-card__subtitle {
          font-size: var(--text-base);
          color: var(--color-text-secondary);
        }

        /* Stats */
        .dashboard__stats {
          padding: var(--space-4) 0;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--space-4);
        }

        .stat-card {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-5) var(--space-6);
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: var(--radius-xl);
          transition: all var(--transition-base);
        }

        .stat-card:hover {
          border-color: var(--color-primary-light);
          box-shadow: var(--shadow-sm);
          transform: translateY(-2px);
        }

        .stat-card__icon {
          width: 48px;
          height: 48px;
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          flex-shrink: 0;
        }

        .stat-card__info {
          display: flex;
          flex-direction: column;
        }

        .stat-card__value {
          font-family: var(--font-heading);
          font-size: var(--text-2xl);
          font-weight: 700;
          color: var(--color-text);
        }

        .stat-card__label {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }

        /* Trips */
        .dashboard__invites {
          padding: var(--space-4) 0 0;
        }

        .invite-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 24px;
          height: 24px;
          padding: 0 8px;
          margin-left: var(--space-2);
          border-radius: 999px;
          background: var(--color-primary);
          color: #1a1a1a;
          font-size: var(--text-xs);
          font-weight: 700;
          vertical-align: middle;
        }

        .invites-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          margin-top: var(--space-4);
        }

        .invite-card {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-4) var(--space-5);
          border: 1px solid var(--color-primary);
          border-radius: var(--radius-xl);
          background: rgba(var(--color-primary-rgb), 0.06);
        }

        .invite-card__icon { font-size: 28px; flex-shrink: 0; }
        .invite-card__body { flex: 1; min-width: 0; }
        .invite-card__title { font-size: var(--text-lg); margin-bottom: 2px; }
        .invite-card__meta { font-size: var(--text-sm); color: var(--color-text-secondary); }
        .invite-card__from { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 4px; }
        .invite-card__actions { display: flex; gap: var(--space-2); flex-shrink: 0; }

        .trip-card__shared {
          display: inline-block;
          margin-left: var(--space-2);
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--color-info-bg);
          color: var(--color-info);
          font-size: var(--text-xs);
          font-weight: 600;
          vertical-align: middle;
        }

        @media (max-width: 640px) {
          .invite-card { flex-wrap: wrap; }
          .invite-card__actions { width: 100%; justify-content: flex-end; }
        }

        .dashboard__trips {
          padding: var(--space-8) 0;
        }

        .section-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-6);
        }

        .section-heading {
          font-size: var(--text-2xl);
        }

        .dashboard__loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-16) 0;
          color: var(--color-text-tertiary);
        }

        .dashboard__empty {
          padding: var(--space-8) 0;
        }

        .empty-state {
          text-align: center;
          padding: var(--space-16) var(--space-8);
          background: var(--color-surface);
          border: 2px dashed var(--color-border);
          border-radius: var(--radius-2xl);
        }

        .empty-state__icon {
          font-size: 64px;
          display: block;
          margin-bottom: var(--space-4);
        }

        .empty-state__title {
          font-size: var(--text-2xl);
          margin-bottom: var(--space-2);
        }

        .empty-state__desc {
          color: var(--color-text-tertiary);
          max-width: 400px;
          margin: 0 auto var(--space-6);
        }

        .trips-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: var(--space-6);
        }

        .trip-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: var(--radius-xl);
          overflow: hidden;
          text-decoration: none;
          transition: all var(--transition-base);
        }

        .trip-card:hover {
          border-color: var(--color-primary-light);
          box-shadow: var(--shadow-lg);
          transform: translateY(-4px);
        }

        .trip-card__cover {
          height: 140px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .trip-card__cover-emoji {
          font-size: 48px;
          opacity: 0.5;
        }

        .trip-card__body {
          padding: var(--space-5);
        }

        .trip-card__status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: var(--space-2);
        }

        .trip-card__status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .trip-card__title {
          font-size: var(--text-lg);
          font-family: var(--font-heading);
          color: var(--color-text);
          margin-bottom: var(--space-1);
        }

        .trip-card__destination {
          font-size: var(--text-sm);
          color: var(--color-text-secondary);
          margin-bottom: var(--space-1);
        }

        .trip-card__dates {
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
        }

        @media (max-width: 1024px) {
          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .welcome-card {
            padding: var(--space-6);
            flex-direction: column;
            text-align: center;
          }

          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .trips-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 480px) {
          .stats-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
