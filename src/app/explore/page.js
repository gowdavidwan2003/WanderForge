'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Footer from '@/components/layout/Footer';
import { TEMPLATE_DATA, fetchOfficialTemplates } from '@/lib/templates';
import { withTimeout } from '@/lib/withTimeout';

export default function ExplorePage() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  // Seeded from the static list so the grid paints immediately and never
  // flashes empty, then replaced by the live rows. The fallback carries no
  // plans, so those cards link to the preview rather than claiming a stop count.
  const [templates, setTemplates] = useState(TEMPLATE_DATA);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(null);
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    fetchOfficialTemplates(supabase).then((rows) => {
      setTemplates(rows);
      setLoaded(true);
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Only rows that came from the database carry an id, and without one there is
  // no plan to read and nothing for the RPC to copy. If the fetch has finished
  // and still nothing has an id, we are on the static fallback — say so, rather
  // than showing two dead buttons and letting the visitor wonder.
  const plansUnavailable = loaded && !templates.some((t) => t.id);

  const allTags = [...new Set(templates.flatMap((t) => t.tags))].sort();

  const filtered = templates.filter((t) => {
    const matchesFilter = filter === 'all' || t.tags.includes(filter);
    const matchesSearch = !search || t.destination.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleUseTemplate = async (template) => {
    if (!user) {
      // Browsing and reading a plan needs no account. Creating a trip does,
      // because a trip needs an owner. No return-to parameter: the signup page
      // does not read one, and a link that claims to come back here when it
      // will not is worse than an honest one.
      toast.info('Sign up to save this plan as your own trip', 'Account Required');
      router.push('/auth/signup');
      return;
    }

    // Two weeks out — far enough to be plannable, near enough to feel real.
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 14);

    setCreating(template.id);
    try {
      // One transaction that writes the trip, its days AND its activities.
      // create_trip_with_days, which this used to call, writes no activities —
      // so a template arrived as an empty calendar and the plan was lost.
      const { data: trip, error } = await withTimeout(
        supabase.rpc('create_trip_from_template', {
          p_template_id: template.id,
          p_start_date: startDate.toISOString().split('T')[0],
        }),
        'Creating your trip'
      );

      if (error) throw error;
      if (!trip?.id) throw new Error('The trip was not created. Please try again.');

      toast.success(
        `${template.duration} days in ${template.destination}, planned and ready to edit.`,
        'Trip Created 🎉'
      );
      router.push(`/trip/${trip.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(null);
    }
  };

  return (
    <>
      <div className="explore">
        <div className="explore__hero">
          <div className="container">
            <span className="explore__emoji">🗺️</span>
            <h1 className="explore__title">Explore Destinations</h1>
            <p className="explore__subtitle">
              {/* These really are hand-built itineraries now — every day
                  titled, every stop timed and costed. Read any of them without
                  an account; you only need one to save a copy you can edit. */}
              {templates.length}{' '}complete itineraries, written day by day —
              read one free, then make it yours in a click
            </p>

            <div className="explore__search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search destinations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="explore__search-input"
              />
            </div>

            <div className="explore__filters">
              <button
                className={`filter-btn ${filter === 'all' ? 'filter-btn--active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  className={`filter-btn ${filter === tag ? 'filter-btn--active' : ''}`}
                  onClick={() => setFilter(tag)}
                >
                  {tag.charAt(0).toUpperCase() + tag.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="explore__grid">
          <div className="container">
            {plansUnavailable && (
              <p className="explore__notice">
                The itineraries could not be loaded, so these are destinations only.
                Try again in a moment.
              </p>
            )}

            <div className="templates-grid">
              {filtered.map((t, i) => (
                <div
                  key={t.destination}
                  className="template-card animate-fade-in-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="template-card__cover" style={{ background: t.cover }}>
                    <span className="template-card__icon">{t.icon}</span>
                    <span className="template-card__duration">{t.duration} Days</span>
                  </div>
                  <div className="template-card__body">
                    <h3 className="template-card__title">{t.destination}</h3>
                    <p className="template-card__desc">{t.desc}</p>
                    <div className="template-card__tags">
                      {t.tags.map((tag) => (
                        <span key={tag} className="template-card__tag">{tag}</span>
                      ))}
                    </div>
                    <div className="template-card__actions">
                      {/* The preview is a plain link, so it works with no
                          session and search engines can read the plan. */}
                      {t.id && (
                        <Link href={`/explore/${t.id}`} className="template-card__view">
                          View plan
                        </Link>
                      )}
                      <Button
                        variant="primary"
                        size="sm"
                        fullWidth
                        disabled={!t.id || creating === t.id}
                        onClick={() => handleUseTemplate(t)}
                      >
                        {creating === t.id ? 'Creating…' : 'Use Template →'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="explore__empty">
                <span>🔍</span>
                <h3>No destinations found</h3>
                <p>Try a different search or filter</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />

      <style jsx>{`
        .explore__hero {
          text-align: center;
          padding: var(--space-12) 0 var(--space-8);
          background: var(--color-bg-secondary);
        }

        .explore__emoji { font-size: 56px; display: block; margin-bottom: var(--space-4); }
        .explore__title { font-size: var(--text-4xl); margin-bottom: var(--space-2); }
        .explore__subtitle { color: var(--color-text-secondary); font-size: var(--text-lg); margin-bottom: var(--space-8); }

        .explore__search {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          max-width: 480px;
          margin: 0 auto var(--space-6);
          padding: var(--space-3) var(--space-5);
          background: var(--color-surface);
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-full);
          color: var(--color-text-tertiary);
        }

        .explore__search:focus-within {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.1);
        }

        .explore__search-input {
          flex: 1;
          border: none;
          background: none;
          font-family: var(--font-body);
          font-size: var(--text-base);
          color: var(--color-text);
          outline: none;
        }

        .explore__search-input::placeholder {
          color: var(--color-text-tertiary);
        }

        .explore__filters {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: var(--space-2);
        }

        .filter-btn {
          padding: 6px 16px;
          border-radius: var(--radius-full);
          border: 1.5px solid var(--color-border);
          background: var(--color-surface);
          font-family: var(--font-body);
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .filter-btn:hover {
          border-color: var(--color-primary-light);
          color: var(--color-text);
        }

        .filter-btn--active {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.1);
          color: var(--color-primary);
        }

        .explore__grid { padding: var(--space-10) 0; }

        .explore__notice {
          margin-bottom: var(--space-6);
          padding: var(--space-3) var(--space-5);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          background: var(--color-bg-secondary);
          color: var(--color-text-secondary);
          font-size: var(--text-sm);
          text-align: center;
        }

        .templates-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: var(--space-6);
        }

        .template-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: var(--radius-xl);
          overflow: hidden;
          transition: all var(--transition-base);
        }

        .template-card:hover {
          border-color: var(--color-primary-light);
          box-shadow: var(--shadow-lg);
          transform: translateY(-4px);
        }

        .template-card__cover {
          height: 160px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .template-card__icon {
          font-size: 56px;
          opacity: 0.8;
        }

        .template-card__duration {
          position: absolute;
          top: 12px;
          right: 12px;
          padding: 4px 12px;
          background: rgba(0, 0, 0, 0.5);
          color: white;
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          font-weight: 600;
          backdrop-filter: blur(4px);
        }

        .template-card__body {
          padding: var(--space-5);
        }

        .template-card__title {
          font-size: var(--text-lg);
          font-family: var(--font-heading);
          margin-bottom: var(--space-2);
        }

        .template-card__desc {
          font-size: var(--text-sm);
          color: var(--color-text-secondary);
          line-height: 1.5;
          margin-bottom: var(--space-3);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .template-card__tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: var(--space-4);
        }

        .template-card__actions {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .template-card__view {
          flex-shrink: 0;
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-text-secondary);
          text-decoration: none;
          border-bottom: 1px solid var(--color-border);
          padding-bottom: 1px;
          transition: all var(--transition-fast);
        }

        .template-card__view:hover {
          color: var(--color-primary);
          border-bottom-color: var(--color-primary);
        }

        .template-card__tag {
          padding: 2px 10px;
          border-radius: var(--radius-full);
          background: var(--color-bg-secondary);
          color: var(--color-text-tertiary);
          font-size: var(--text-xs);
          font-weight: 500;
          text-transform: capitalize;
        }

        .explore__empty {
          text-align: center;
          padding: var(--space-16) var(--space-8);
          color: var(--color-text-tertiary);
        }

        .explore__empty span { font-size: 56px; display: block; margin-bottom: var(--space-4); }
        .explore__empty h3 { font-size: var(--text-xl); color: var(--color-text); margin-bottom: var(--space-2); }

        @media (max-width: 768px) {
          .templates-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
