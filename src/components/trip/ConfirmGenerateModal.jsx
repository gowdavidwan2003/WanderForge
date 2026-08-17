'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

/**
 * Asked before AI generation touches an itinerary that already exists.
 *
 * Generation used to insert unconditionally, so a second press — an obvious thing
 * to try after a disappointing result, or after a long silent run that looks
 * stuck — wrote a complete second copy of every activity with colliding
 * order_index values, recoverable only by deleting each one by hand. This is the
 * gate that makes that impossible; the in-flight ref only covers the same-tick
 * case, not the press after a run finishes.
 *
 * Kept out of the trip page so it can be rendered without a session, a trip row
 * or a Groq call.
 *
 * @param pending  null when closed, otherwise { existing: <activity count> }
 */
export default function ConfirmGenerateModal({ pending, onCancel, onReplace, onAppend }) {
  const existing = pending?.existing ?? 0;
  const plural = existing === 1 ? 'activity' : 'activities';

  return (
    <Modal
      isOpen={!!pending}
      onClose={onCancel}
      title="This trip already has an itinerary"
    >
      <div className="confirm-gen">
        <p className="confirm-gen__body">
          There {existing === 1 ? 'is' : 'are'} already{' '}
          <strong>{existing} {plural}</strong> planned. Generating again can either
          start over or add alongside what you have.
        </p>

        <div className="confirm-gen__actions">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="secondary" onClick={onAppend}>Add alongside</Button>
          <Button variant="primary" onClick={onReplace}>Replace everything</Button>
        </div>

        <p className="confirm-gen__warning">
          Replacing deletes the current activities and cannot be undone.
        </p>
      </div>

      <style jsx>{`
        .confirm-gen {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .confirm-gen__body {
          margin: 0;
          font-size: var(--text-sm);
          line-height: 1.6;
          color: var(--color-text-secondary);
        }

        .confirm-gen__body strong {
          color: var(--color-text);
        }

        .confirm-gen__actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: var(--space-3);
        }

        .confirm-gen__warning {
          margin: 0;
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
        }
      `}</style>
    </Modal>
  );
}
