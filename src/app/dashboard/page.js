'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthProvider';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Footer from '@/components/layout/Footer';

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseBrowserClient();

  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Explorer';

  useEffect(() => {
    const fetchTrips = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('trips')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setTrips(data || []);
      setLoading(false);
    };
    fetchTrips();
  }, [user]);

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
                      <h3 className="trip-card__title">{trip.title || 'Untitled Trip'}</h3>
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
