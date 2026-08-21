'use client';

import Button from '@/components/ui/Button';

/**
 * What generation looks like while it is happening.
 *
 * Before this, pressing Generate showed a spinner and a label for anywhere from
 * fifteen to forty seconds. There was no way to tell a slow trip from a stuck
 * one, no way to stop it, and nothing to look at — which is why people pressed
 * the button again, and why the duplicate-itinerary guard had to exist.
 *
 * Days appear here as the model writes them, usually the first within two or
 * three seconds. They are a PREVIEW: nothing on screen has been saved, and the
 * panel says so, because a list of days that looks finished but is not yet
 * checked would be a worse lie than the spinner was.
 */

const PHASE_LABEL = {
  planning: 'Planning',
  checking: 'Checking',
  saving: 'Saving',
};

export default function GenerationProgress({
  status,
  phase = 'planning',
  streamedDays = [],
  expected = 0,
  saved,
  onCancel,
  cancelling = false,
}) {
  const seen = streamedDays.length;
  // Saving reports activities; planning reports days. Show whichever is running.
  const pct = saved?.total
    ? Math.round((saved.done / saved.total) * 100)
    : expected
      ? Math.round((seen / expected) * 100)
      : 0;

  return (
    <div className="gen" role="status" aria-live="polite">
      <div className="gen__head">
        <div className="gen__headline">
          <span className="gen__spinner" aria-hidden="true" />
          <div>
            <strong className="gen__phase">{PHASE_LABEL[phase] || 'Working'}</strong>
            <p className="gen__status">{status}</p>
          </div>
        </div>

        {onCancel && phase !== 'saving' && (
          // Not offered during saving: the writes are already in flight, and
          // stopping halfway is the partially-populated trip everything else
          // here exists to prevent.
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={cancelling}>
            {cancelling ? 'Stopping…' : 'Cancel'}
          </Button>
        )}
      </div>

      <div className="gen__bar">
        <div className="gen__bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>

      <p className="gen__count">
        {saved?.total
          ? `Saved ${saved.done} of ${saved.total} activities`
          : expected
            ? `${seen} of ${expected} days planned`
            : `${seen} days planned`}
      </p>

      {streamedDays.length > 0 && (
        <>
          <ul className="gen__days">
            {streamedDays.map((day, i) => (
              <li key={`${day.day}-${i}`} className="gen__day">
                <span className="gen__day-num">Day {day.day}</span>
                <span className="gen__day-theme">{day.theme || 'Planned'}</span>
                <span className="gen__day-count">
                  {day.activities?.length || 0} activities
                </span>
              </li>
            ))}
          </ul>
          <p className="gen__note">
            Nothing is saved yet. Every day is checked against real travel times
            first, and only the checked version is written to your trip.
          </p>
        </>
      )}

      <style jsx>{`
        .gen {
          display: flex; flex-direction: column; gap: var(--space-3);
          padding: var(--space-4);
          margin-bottom: var(--space-4);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
        }
        .gen__head {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: var(--space-3);
        }
        .gen__headline { display: flex; gap: var(--space-3); align-items: flex-start; }
        .gen__spinner {
          width: 16px; height: 16px; margin-top: 3px; flex-shrink: 0;
          border: 2px solid var(--color-border);
          border-top-color: var(--color-primary);
          border-radius: 50%;
          animation: gen-spin 0.8s linear infinite;
        }
        @keyframes gen-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .gen__spinner { animation-duration: 3s; }
        }
        .gen__phase { font-size: var(--text-sm); }
        .gen__status {
          font-size: var(--text-xs); color: var(--color-text-secondary); margin-top: 2px;
        }
        .gen__bar {
          height: 4px; border-radius: 999px; overflow: hidden;
          background: var(--color-border-light);
        }
        .gen__bar-fill {
          height: 100%; background: var(--color-primary);
          transition: width 0.4s ease;
        }
        .gen__count { font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .gen__days {
          display: flex; flex-direction: column; gap: 4px;
          margin: 0; padding: 0; list-style: none;
        }
        .gen__day {
          display: flex; align-items: baseline; gap: var(--space-2);
          padding: 6px var(--space-2); border-radius: var(--radius-sm);
          background: var(--color-bg);
          font-size: var(--text-xs);
          animation: gen-in 0.3s ease;
        }
        @keyframes gen-in { from { opacity: 0; transform: translateY(-3px); } }
        @media (prefers-reduced-motion: reduce) { .gen__day { animation: none; } }
        .gen__day-num { font-weight: 700; color: var(--color-primary); flex-shrink: 0; }
        .gen__day-theme { flex: 1; min-width: 0; color: var(--color-text); }
        .gen__day-count { color: var(--color-text-tertiary); flex-shrink: 0; }
        .gen__note {
          font-size: var(--text-xs); color: var(--color-text-tertiary);
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
