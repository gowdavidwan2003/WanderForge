'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

/**
 * Itinerary Check.
 *
 * Two states, on purpose.
 *
 * When the trip carries a stored check — written by the generate route, which
 * runs conflictChecker server-side against real road distances before anything
 * reaches the database — this shows what survived the model's one chance to fix
 * it. That is the part that must never be silent: an itinerary that cannot be
 * walked has to say so.
 *
 * When it does not (a hand-built trip, or one generated before the check
 * existed), the panel still explains what the check does rather than being a
 * dead button. Re-running it live on demand, and the one-click whole-trip fix
 * behind it, are still held back — the checker and replanTrip are both built, so
 * that is a UI change rather than a rebuild.
 */

const PLANNED = [
  {
    icon: '⛔',
    title: 'Overlapping activities',
    text: 'Spots two things booked at the same time, and by how much they clash.',
  },
  {
    icon: '🚗',
    title: 'Impossible travel times',
    text: 'Uses real road distances and driving times to flag journeys that cannot fit the gap you have left — the kind where a 1h30 ghat road is scheduled in 30 minutes.',
  },
  {
    icon: '🕐',
    title: 'Opening-hour concerns',
    text: 'Flags museums at 06:00 and other slots that are unlikely to be open.',
  },
  {
    icon: '💰',
    title: 'Over-budget days',
    text: 'Highlights days that run well past the daily average implied by your trip budget.',
  },
  {
    icon: '🗺️',
    title: 'Unrealistic distances',
    text: 'Warns when a single day covers more ground than is sensible, or when one hop is a long haul.',
  },
  {
    icon: '🔄',
    title: 'One-click whole-trip fix',
    text: 'Rebuilds the trip around every place you have added — moving them between days where needed — without ever dropping one.',
  },
];

const SEVERITY_ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' };

function checkedAgo(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** What the last server-side check found. */
function StoredReport({ conflicts, checkedAt }) {
  const issues = Array.isArray(conflicts.issues) ? conflicts.issues : [];
  const summary = conflicts.summary || {};
  const when = checkedAgo(checkedAt);

  return (
    <div className="cc">
      <div className={`cc__badge cc__badge--${conflicts.achievable ? 'ok' : 'bad'}`}>
        {conflicts.achievable ? 'Achievable' : 'Not fully achievable'}
      </div>

      <p className="cc__intro">
        {conflicts.achievable
          ? 'Every transition in this itinerary has enough time for the real journey between those two places.'
          : 'Some transitions in this itinerary do not have enough time for the real journey between those two places. The plan was checked against road distances and driving times, and the AI was given one chance to fix these — these are what it could not.'}
        {when ? ` Checked ${when}.` : ''}
      </p>

      <div className="cc__stats">
        <span className="cc__stat">{summary.errors ?? 0} errors</span>
        <span className="cc__stat">{summary.warnings ?? 0} warnings</span>
        <span className="cc__stat">{summary.info ?? 0} notes</span>
        {conflicts.geocoded && (
          <span className="cc__stat">
            {conflicts.geocoded.located}/{conflicts.geocoded.total} located
          </span>
        )}
      </div>

      {conflicts.geocoded && conflicts.geocoded.located < conflicts.geocoded.total && (
        <p className="cc__note">
          {conflicts.geocoded.total - conflicts.geocoded.located} activity(s) could not
          be placed on the map, so travel time to and from them could not be checked.
          An unchecked leg is not the same as one that works.
        </p>
      )}

      {issues.length === 0 ? (
        <p className="cc__note">Nothing to flag.</p>
      ) : (
        <div className="cc__list">
          {issues.map((issue, i) => (
            <div key={`${issue.type}-${issue.day}-${i}`} className={`cc__item cc__item--${issue.severity}`}>
              <span className="cc__item-icon">{SEVERITY_ICON[issue.severity] || 'ℹ️'}</span>
              <div>
                <span className="cc__item-title">Day {issue.day} · {issue.type.replace(/-/g, ' ')}</span>
                <p className="cc__item-text">{issue.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="cc__foot">
        This is what was true when the itinerary was generated. Edit a day and it
        may no longer apply — <strong>Replan Day</strong> rebuilds a day with
        realistic travel times and ordering.
      </p>
    </div>
  );
}

/** What the check will do, for trips that have never had one. */
function ComingSoon() {
  return (
    <div className="cc">
      <div className="cc__badge">Not checked yet</div>

      <p className="cc__intro">
        This trip has no stored check. Itineraries generated with AI are checked
        automatically before they are saved; running the check on demand for a
        hand-built trip is not switched on yet.
      </p>

      <div className="cc__list">
        {PLANNED.map((item) => (
          <div key={item.title} className="cc__item">
            <span className="cc__item-icon">{item.icon}</span>
            <div>
              <span className="cc__item-title">{item.title}</span>
              <p className="cc__item-text">{item.text}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="cc__foot">
        In the meantime, <strong>Replan Day</strong> on any day rebuilds it with
        realistic travel times and ordering.
      </p>
    </div>
  );
}

export default function ConflictCheckPanel({ isOpen, onClose, trip }) {
  const conflicts = trip?.conflicts;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Itinerary Check" size="lg">
      {conflicts
        ? <StoredReport conflicts={conflicts} checkedAt={trip?.conflicts_checked_at} />
        : <ComingSoon />}

      <div className="cc__actions">
        <Button variant="primary" onClick={onClose}>Got it</Button>
      </div>

      {/* `global`, not scoped: styled-jsx scopes to the JSX of the component the
          block sits in, and the markup above lives in StoredReport / ComingSoon.
          Every class is cc-prefixed to keep the leak contained. */}
      <style jsx global>{`
        .cc { display: flex; flex-direction: column; gap: var(--space-4); }
        .cc__badge {
          align-self: flex-start;
          padding: 4px 12px; border-radius: 999px;
          background: var(--color-info-bg); color: var(--color-info);
          font-size: var(--text-xs); font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .cc__badge--ok { background: var(--color-success-bg); color: var(--color-success); }
        .cc__badge--bad { background: var(--color-error-bg); color: var(--color-error); }
        .cc__intro { font-size: var(--text-sm); color: var(--color-text-secondary); }
        .cc__stats { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .cc__stat {
          padding: 2px 10px; border-radius: 999px;
          background: var(--color-bg-secondary);
          font-size: var(--text-xs); color: var(--color-text-secondary);
        }
        .cc__note { font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .cc__list { display: flex; flex-direction: column; gap: var(--space-3); }
        .cc__item {
          display: flex; gap: var(--space-3);
          padding: var(--space-3); border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
          border-left: 3px solid transparent;
        }
        .cc__item--error { border-left-color: var(--color-error); }
        .cc__item--warning { border-left-color: var(--color-warning); }
        .cc__item-icon { flex-shrink: 0; font-size: 18px; }
        .cc__item-title {
          font-size: var(--text-sm); font-weight: 600;
          text-transform: capitalize;
        }
        .cc__item-text {
          font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 2px;
        }
        .cc__foot {
          font-size: var(--text-sm); color: var(--color-text-tertiary);
          border-top: 1px solid var(--color-border-light); padding-top: var(--space-3);
        }
        .cc__actions {
          display: flex; justify-content: flex-end; margin-top: var(--space-4);
        }
      `}</style>
    </Modal>
  );
}
