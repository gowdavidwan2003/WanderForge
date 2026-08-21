'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { groupByDay, headlineFor, isHardConflict } from '@/lib/conflictView';

/**
 * Itinerary Check.
 *
 * This was a "Coming soon" modal sitting on top of a checker that already
 * worked. It now shows the live result of checkItinerary over whatever is
 * currently in the editor — recomputed on every edit, no network, no AI — split
 * into what cannot work and what is merely worth a look.
 *
 * The panel is not the only place conflicts appear: activities carry their own
 * marks in the day view and days carry a badge in the sidebar, so a problem is
 * visible where it is, not only in a modal somebody has to think to open. What
 * the panel adds is the whole-trip picture and a per-day fix button.
 *
 * Travel times come from the checker's road model (great-circle distance scaled
 * for road sinuosity), not from a routing call — the same basis the generate
 * route checks against, and free to recompute on every keystroke.
 */

const SEVERITY_ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' };

const TYPE_LABEL = {
  overlap: 'Overlapping',
  'invalid-duration': 'Impossible duration',
  'travel-time': 'Not enough travel time',
  'long-hop': 'Long haul',
  'odd-hours': 'Opening hours',
  'over-budget': 'Over budget',
  'long-day': 'Long day',
  'missing-times': 'No times set',
  'missing-coords': 'Not on the map',
};

function IssueRow({ issue }) {
  return (
    <div className={`cc__item cc__item--${issue.severity}`}>
      <span className="cc__item-icon">{SEVERITY_ICON[issue.severity] || 'ℹ️'}</span>
      <div>
        <span className="cc__item-title">{TYPE_LABEL[issue.type] || issue.type}</span>
        <p className="cc__item-text">{issue.message}</p>
      </div>
    </div>
  );
}

function DaySection({ group, onFixDay, fixingDay, disabled }) {
  return (
    <section className="cc__day">
      <header className="cc__day-head">
        <span className="cc__day-title">
          Day {group.day}
          {group.impossible && <span className="cc__pill cc__pill--bad">Impossible as written</span>}
        </span>

        {/* Only offered where it helps. Replan rebuilds a day's order and
            timings around everything on it; it cannot fix a museum's opening
            hours, so offering it for a soft warning would be a false promise. */}
        {group.impossible && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onFixDay(group.day)}
            loading={fixingDay === group.day}
            disabled={disabled || fixingDay != null}
            title="Rebuild this day around everything on it: order, timings and travel"
          >
            🔄 Fix this day
          </Button>
        )}
      </header>

      {group.hard.map((issue, i) => <IssueRow key={`h${i}`} issue={issue} />)}
      {group.soft.map((issue, i) => <IssueRow key={`s${i}`} issue={issue} />)}
    </section>
  );
}

export default function ConflictCheckPanel({
  isOpen,
  onClose,
  report,
  trip,
  onFixDay,
  fixingDay = null,
  locked = false,
  onMeasureRoads,
  measuringRoads = false,
  measuredLegs = 0,
}) {
  const issues = report?.issues || [];
  const summary = report?.summary || {};
  const headline = headlineFor(report);
  const groups = groupByDay(issues);
  const hardCount = issues.filter(isHardConflict).length;

  // What the check found when the itinerary was generated. Shown only when it
  // disagrees with the live result, because that is the only time it tells the
  // reader something: the plan has been edited since.
  const stored = trip?.conflicts;
  const storedDiffers =
    stored && typeof stored.achievable === 'boolean' && stored.achievable !== (hardCount === 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Itinerary Check" size="lg">
      <div className="cc">
        <div className={`cc__badge cc__badge--${headline.tone}`}>{headline.title}</div>
        <p className="cc__intro">{headline.detail}</p>

        <div className="cc__stats">
          <span className="cc__stat">{summary.checkedDays ?? 0} days checked</span>
          <span className="cc__stat">{summary.checkedActivities ?? 0} activities</span>
          <span className="cc__stat">{summary.errors ?? 0} errors</span>
          <span className="cc__stat">{summary.warnings ?? 0} warnings</span>
        </div>

        {storedDiffers && (
          <p className="cc__note">
            This differs from the check stored when the itinerary was generated —
            the plan has been edited since. The result above is the current one.
          </p>
        )}

        {locked && hardCount > 0 && (
          <p className="cc__note">
            The itinerary is locked, so it cannot be fixed until the trip owner
            unlocks it.
          </p>
        )}

        {groups.length === 0 ? (
          <p className="cc__note">Nothing to flag.</p>
        ) : (
          groups.map((group) => (
            <DaySection
              key={group.day}
              group={group}
              onFixDay={onFixDay}
              fixingDay={fixingDay}
              disabled={locked}
            />
          ))
        )}

        {/* The difference between an estimate and a measurement is the single
            biggest factor in whether these findings are trustworthy, so it is
            stated rather than left for the reader to assume. */}
        <div className="cc__roads">
          {measuredLegs > 0 ? (
            <p className="cc__note">
              <strong>{measuredLegs} journey{measuredLegs === 1 ? '' : 's'} measured</strong>{' '}
              against real road distances and driving times. Anything not on that
              list is estimated from straight-line distance, which is optimistic
              on winding mountain roads.
            </p>
          ) : (
            <p className="cc__note">
              Travel times here are <strong>estimated</strong> from straight-line
              distance — roughly right in towns, and measured 1.6x optimistic on
              the hill road this was tested against.
            </p>
          )}
          {onMeasureRoads && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onMeasureRoads}
              loading={measuringRoads}
              disabled={measuringRoads}
              title="Look up the real road distance and driving time for every journey on this trip"
            >
              🛣️ Measure the real roads
            </Button>
          )}
        </div>

        <p className="cc__foot">
          Opening hours are judged by category rather than looked up, so those
          warnings are worth confirming rather than obeying. Anything marked{' '}
          <strong>impossible</strong> is arithmetic: the journey does not fit the
          gap left for it.
        </p>

        <div className="cc__actions">
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>

      {/* `global`, not scoped: styled-jsx scopes to the JSX of the component the
          block sits in, and IssueRow / DaySection are separate components.
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
        .cc__badge--warn { background: var(--color-warning-bg, var(--color-info-bg)); color: var(--color-warning); }
        .cc__badge--bad { background: var(--color-error-bg); color: var(--color-error); }
        .cc__intro { font-size: var(--text-sm); color: var(--color-text-secondary); }
        .cc__stats { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .cc__stat {
          padding: 2px 10px; border-radius: 999px;
          background: var(--color-bg-secondary);
          font-size: var(--text-xs); color: var(--color-text-secondary);
        }
        .cc__note { font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .cc__roads {
          display: flex; align-items: center; justify-content: space-between;
          gap: var(--space-3); flex-wrap: wrap;
          padding: var(--space-3); border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
        }
        .cc__roads p { flex: 1 1 260px; margin: 0; line-height: 1.5; }
        .cc__day { display: flex; flex-direction: column; gap: var(--space-2); }
        .cc__day-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: var(--space-2);
          border-bottom: 1px solid var(--color-border-light); padding-bottom: 4px;
        }
        .cc__day-title {
          display: flex; align-items: center; gap: var(--space-2);
          font-size: var(--text-sm); font-weight: 600;
        }
        .cc__pill {
          padding: 2px 8px; border-radius: 999px;
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .cc__pill--bad { background: var(--color-error-bg); color: var(--color-error); }
        .cc__item {
          display: flex; gap: var(--space-3);
          padding: var(--space-3); border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
          border-left: 3px solid transparent;
        }
        .cc__item--error { border-left-color: var(--color-error); }
        .cc__item--warning { border-left-color: var(--color-warning); }
        .cc__item-icon { flex-shrink: 0; font-size: 18px; }
        .cc__item-title { font-size: var(--text-sm); font-weight: 600; }
        .cc__item-text {
          font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 2px;
        }
        .cc__foot {
          font-size: var(--text-xs); color: var(--color-text-tertiary);
          border-top: 1px solid var(--color-border-light); padding-top: var(--space-3);
        }
        .cc__actions { display: flex; justify-content: flex-end; }
      `}</style>
    </Modal>
  );
}
