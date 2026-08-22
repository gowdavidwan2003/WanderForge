import Link from 'next/link';
import { notFound } from 'next/navigation';

import Footer from '@/components/layout/Footer';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fetchTemplateById, templateCost, templateStopCount } from '@/lib/templates';
import UseTemplateButton from './UseTemplateButton';

/**
 * One template, with its whole plan on the page.
 *
 * A server component on purpose. The point of this page is that somebody with
 * no account can read the entire itinerary — so it must render without a
 * session, on the first response, with the plan in the HTML rather than fetched
 * afterwards by script. That is also what lets a search engine index it.
 *
 * getSupabaseServerClient uses the anon key. The read works because migration
 * 015 grants SELECT on trip_templates to anon and the policy allows it.
 */

/** Times are stored as TIME and come back as HH:MM:SS. Nobody wants the seconds. */
function formatTime(value) {
  return value ? value.slice(0, 5) : null;
}

function formatMoney(amount, currency) {
  if (!amount) return null;
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unknown currency code should cost a symbol, not the whole page.
    return `${Math.round(amount)} ${currency}`;
  }
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const template = await fetchTemplateById(supabase, id);

  if (!template) return { title: 'Template not found · WanderForge' };

  return {
    title: `${template.title} · WanderForge`,
    description: template.desc,
  };
}

export default async function TemplatePreviewPage({ params }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const template = await fetchTemplateById(supabase, id);

  if (!template) notFound();

  const stops = templateStopCount(template);
  const cost = templateCost(template);

  return (
    <>
      <article className="preview">
        <header className="preview__hero" style={{ background: template.cover }}>
          <div className="container">
            <Link href="/explore" className="preview__back">← All itineraries</Link>
            <span className="preview__icon">{template.icon}</span>
            <h1 className="preview__title">{template.title}</h1>
            <p className="preview__desc">{template.desc}</p>

            <div className="preview__tags">
              {template.tags.map((tag) => (
                <span key={tag} className="preview__tag">{tag}</span>
              ))}
            </div>
          </div>
        </header>

        <div className="container">
          <div className="preview__stats">
            <div className="preview__stat">
              <strong>{template.duration}</strong>
              <span>days</span>
            </div>
            <div className="preview__stat">
              <strong>{stops}</strong>
              <span>stops planned</span>
            </div>
            {cost > 0 && (
              <div className="preview__stat">
                <strong>{formatMoney(cost, template.currency)}</strong>
                {/* Sums the activity costs and nothing else. Saying "from" and
                    leaving it there would imply flights and beds are in it. */}
                <span>entries &amp; meals, per person</span>
              </div>
            )}
          </div>

          <div className="preview__cta">
            <UseTemplateButton templateId={template.id} destination={template.destination} />
            <p className="preview__cta-note">
              Free to read. Saving your own editable copy needs an account.
            </p>
          </div>

          <div className="preview__days">
            {template.days.map((day) => (
              <section key={day.day_number} className="day">
                <div className="day__marker">
                  <span className="day__num">Day {day.day_number}</span>
                </div>
                <div className="day__body">
                  <h2 className="day__title">{day.title}</h2>

                  <ol className="day__stops">
                    {(day.activities || []).map((a, i) => {
                      const start = formatTime(a.start_time);
                      const end = formatTime(a.end_time);
                      const price = formatMoney(a.cost, template.currency);

                      return (
                        <li key={`${day.day_number}-${i}`} className="stop">
                          <div className="stop__when">
                            {start && <span className="stop__time">{start}</span>}
                            {end && <span className="stop__end">{end}</span>}
                          </div>
                          <div className="stop__what">
                            <div className="stop__head">
                              <h3 className="stop__title">{a.title}</h3>
                              <span className="stop__cat">{a.category}</span>
                            </div>
                            {a.description && <p className="stop__desc">{a.description}</p>}
                            <div className="stop__meta">
                              {a.location_name && (
                                <span className="stop__loc">📍 {a.location_name}</span>
                              )}
                              {price && <span className="stop__cost">{price}</span>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </section>
            ))}
          </div>
        </div>
      </article>

      <Footer />

      <style>{`
        .preview__hero {
          padding: var(--space-8) 0 var(--space-10);
          text-align: center;
          color: #fff;
        }
        .preview__back {
          display: inline-block;
          margin-bottom: var(--space-6);
          color: rgba(255, 255, 255, 0.85);
          text-decoration: none;
          font-size: var(--text-sm);
          font-weight: 500;
        }
        .preview__back:hover { color: #fff; }
        .preview__icon { font-size: 64px; display: block; margin-bottom: var(--space-3); }
        .preview__title {
          font-size: var(--text-4xl);
          font-family: var(--font-heading);
          margin-bottom: var(--space-3);
          color: #fff;
          text-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
        }
        .preview__desc {
          max-width: 620px;
          margin: 0 auto var(--space-5);
          font-size: var(--text-lg);
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 1px 8px rgba(0, 0, 0, 0.25);
        }
        .preview__tags {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: var(--space-2);
        }
        .preview__tag {
          padding: 4px 14px;
          border-radius: var(--radius-full);
          background: rgba(0, 0, 0, 0.28);
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: capitalize;
          backdrop-filter: blur(4px);
        }

        .preview__stats {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: var(--space-8);
          padding: var(--space-8) var(--space-4);
          margin-top: calc(var(--space-6) * -1);
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          position: relative;
        }
        .preview__stat { text-align: center; }
        .preview__stat strong {
          display: block;
          font-family: var(--font-heading);
          font-size: var(--text-2xl);
          color: var(--color-primary);
        }
        .preview__stat span {
          font-size: var(--text-sm);
          color: var(--color-text-secondary);
        }

        .preview__cta {
          text-align: center;
          padding: var(--space-8) 0 var(--space-4);
        }
        .preview__cta-note {
          margin-top: var(--space-3);
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }

        .preview__days {
          padding: var(--space-6) 0 var(--space-12);
          max-width: 780px;
          margin: 0 auto;
        }

        .day {
          display: flex;
          gap: var(--space-5);
          padding-bottom: var(--space-8);
        }
        .day__marker { flex-shrink: 0; position: relative; }
        .day__num {
          display: block;
          padding: 6px 14px;
          border-radius: var(--radius-full);
          background: var(--color-primary);
          color: #fff;
          font-size: var(--text-xs);
          font-weight: 700;
          white-space: nowrap;
        }
        /* The spine linking the days. Drawn from the pill down, and the last
           day's simply runs out of siblings to reach. */
        .day:not(:last-child) .day__marker::after {
          content: '';
          position: absolute;
          top: 34px;
          bottom: calc(var(--space-8) * -1);
          left: 50%;
          width: 2px;
          background: var(--color-border);
        }
        .day__body { flex: 1; min-width: 0; }
        .day__title {
          font-size: var(--text-xl);
          font-family: var(--font-heading);
          margin-bottom: var(--space-4);
        }

        .day__stops { list-style: none; margin: 0; padding: 0; }

        .stop {
          display: flex;
          gap: var(--space-4);
          padding: var(--space-4) 0;
          border-bottom: 1px solid var(--color-border-light);
        }
        .stop:last-child { border-bottom: none; }

        .stop__when {
          flex-shrink: 0;
          width: 52px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .stop__time {
          font-weight: 700;
          font-size: var(--text-sm);
          color: var(--color-text);
          font-variant-numeric: tabular-nums;
        }
        .stop__end {
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
          font-variant-numeric: tabular-nums;
        }

        .stop__what { flex: 1; min-width: 0; }
        .stop__head {
          display: flex;
          align-items: baseline;
          gap: var(--space-3);
          flex-wrap: wrap;
        }
        .stop__title {
          font-size: var(--text-base);
          font-weight: 600;
          margin: 0;
        }
        .stop__cat {
          padding: 1px 9px;
          border-radius: var(--radius-full);
          background: var(--color-bg-secondary);
          color: var(--color-text-tertiary);
          font-size: var(--text-xs);
          font-weight: 500;
          text-transform: capitalize;
        }
        .stop__desc {
          margin: var(--space-2) 0 0;
          font-size: var(--text-sm);
          line-height: 1.55;
          color: var(--color-text-secondary);
        }
        .stop__meta {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-4);
          margin-top: var(--space-2);
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
        }
        .stop__cost { font-weight: 600; color: var(--color-text-secondary); }

        @media (max-width: 640px) {
          .preview__stats { gap: var(--space-5); padding: var(--space-5) var(--space-3); }
          .day { gap: var(--space-3); }
          .stop { flex-direction: column; gap: var(--space-1); }
          .stop__when { flex-direction: row; gap: var(--space-2); width: auto; }
        }
      `}</style>
    </>
  );
}
