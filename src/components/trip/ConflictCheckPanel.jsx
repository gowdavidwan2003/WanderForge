'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

/**
 * Itinerary Check — temporarily disabled.
 *
 * The checker and the whole-trip replan behind it are built and working, but the
 * feature is held back for now. The panel explains what it will do rather than
 * silently doing nothing, so the button in the toolbar isn't a dead end.
 *
 * The implementation is still in src/lib/conflictChecker.js and
 * src/lib/replanTrip.js — re-enabling is a UI change, not a rebuild.
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

export default function ConflictCheckPanel({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Itinerary Check" size="lg">
      <div className="cc">
        <div className="cc__badge">Coming soon</div>

        <p className="cc__intro">
          Itinerary Check will scan your plan after manual edits and tell you what
          genuinely will not work — then offer to fix it. It is not switched on yet.
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

        <div className="cc__actions">
          <Button variant="primary" onClick={onClose}>Got it</Button>
        </div>
      </div>

      <style jsx>{`
        .cc { display: flex; flex-direction: column; gap: var(--space-4); }
        .cc__badge {
          align-self: flex-start;
          padding: 4px 12px; border-radius: 999px;
          background: var(--color-info-bg); color: var(--color-info);
          font-size: var(--text-xs); font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .cc__intro { font-size: var(--text-sm); color: var(--color-text-secondary); }
        .cc__list { display: flex; flex-direction: column; gap: var(--space-3); }
        .cc__item {
          display: flex; gap: var(--space-3);
          padding: var(--space-3); border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
        }
        .cc__item-icon { flex-shrink: 0; font-size: 18px; }
        .cc__item-title { font-size: var(--text-sm); font-weight: 600; }
        .cc__item-text {
          font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 2px;
        }
        .cc__foot {
          font-size: var(--text-sm); color: var(--color-text-tertiary);
          border-top: 1px solid var(--color-border-light); padding-top: var(--space-3);
        }
        .cc__actions { display: flex; justify-content: flex-end; }
      `}</style>
    </Modal>
  );
}
