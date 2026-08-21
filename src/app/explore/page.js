'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Footer from '@/components/layout/Footer';
import { ALL_TAGS, TEMPLATE_DATA, templateInterests } from '@/lib/templates';
import { withTimeout } from '@/lib/withTimeout';
import { inferCurrency } from '@/lib/currency';

export default function ExplorePage() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const supabase = getSupabaseBrowserClient();

  const filtered = TEMPLATE_DATA.filter((t) => {
    const matchesFilter = filter === 'all' || t.tags.includes(filter);
    const matchesSearch = !search || t.destination.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleUseTemplate = async (template) => {
    if (!user) {
      toast.info('Please sign up to use templates', 'Account Required');
      router.push('/auth/signup');
      return;
    }

    // Create a trip from template
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 14); // 2 weeks from now
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + template.duration - 1);

    try {
      const days = Array.from({ length: template.duration }, (_, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        return { day_number: i + 1, date: d.toISOString().split('T')[0] };
      });

      // One transaction, like the wizard. This was an insert of the trip
      // followed by an insert of its days, so a failure on the second left a
      // trip the editor cannot open.
      const { data: trip, error } = await withTimeout(
        supabase.rpc('create_trip_with_days', {
          p_trip: {
            title: `Trip to ${template.destination}`,
            destination: template.destination,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
            status: 'planned',
            currency: inferCurrency(template.destination) || 'USD',
            ai_preferences: {
              // `interests`, not `tags`. The generate route reads
              // ai_preferences.interests, so writing `tags` here meant every
              // template produced the same generic trip and the destination's
              // whole character was thrown away.
              interests: templateInterests(template),
              from_template: true,
            },
          },
          p_days: days,
        }),
        'Creating your trip'
      );

      if (error) throw error;
      if (!trip?.id) throw new Error('The trip was not created. Please try again.');

      toast.success(
        `${template.duration} days in ${template.destination} are ready to plan.`,
        'Trip Created 🎉'
      );
      router.push(`/trip/${trip.id}`);
    } catch (err) {
      toast.error(err.message);
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
              {/* Not "curated templates": nothing here is a hand-built
                  itinerary. Each one is a destination, a sensible length and a
                  few interests, which the AI then plans for you. */}
              {TEMPLATE_DATA.length}{' '}starting points for the world&apos;s most visited destinations —
              pick one and the AI plans the days
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
              {ALL_TAGS.map((tag) => (
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
                    <Button variant="primary" size="sm" fullWidth onClick={() => handleUseTemplate(t)}>
                      Use Template →
                    </Button>
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
