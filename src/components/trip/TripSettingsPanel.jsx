'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { MAX_TRIP_DAYS } from '@/lib/tripLimits';
import { describeDayChanges, planDayChanges, validateTripEdit } from '@/lib/tripDates';

/**
 * Edit or delete a trip.
 *
 * A trip used to be immutable and permanent — no way to fix a title, move dates,
 * correct a destination, or get rid of one. This is the panel that changes that.
 *
 * The date fields are the reason this is more than a form. Moving the range
 * re-dates every day, and shortening it removes days off the end along with
 * every activity on them. That consequence is worked out live (planDayChanges)
 * and shown before the save button is ever pressed, because a destructive edit
 * the user did not expect is worse than one they cannot make.
 */

const TRANSPORT_MODES = [
  { id: 'mixed', icon: '🔀', label: 'Mixed' },
  { id: 'car', icon: '🚗', label: 'Car' },
  { id: 'public_transit', icon: '🚌', label: 'Transit' },
  { id: 'walking', icon: '🚶', label: 'Walking' },
  { id: 'bike', icon: '🚴', label: 'Bike' },
  { id: 'flight', icon: '✈️', label: 'Flight' },
];

export default function TripSettingsPanel({
  isOpen,
  onClose,
  trip,
  days = [],
  activities = {},
  onSave,
  onDelete,
  saving = false,
  deleting = false,
  canDelete = false,
}) {
  // Seeded once, on mount. The parent only renders this panel while it is open,
  // so opening it is a mount and an abandoned edit cannot reappear — which is
  // also why there is no effect here syncing state to props. Effects that call
  // setState synchronously cascade renders, and this needs to happen before the
  // first paint, not after it.
  const [form, setForm] = useState(() => ({
    title: trip?.title || '',
    destination: trip?.destination || '',
    startDate: trip?.start_date || '',
    endDate: trip?.end_date || '',
    totalBudget: trip?.total_budget ?? '',
    transportMode: trip?.transport_mode || 'mixed',
  }));
  const [confirmDelete, setConfirmDelete] = useState('');
  const [errors, setErrors] = useState([]);

  if (!trip) return null;

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const validation = validateTripEdit(form, MAX_TRIP_DAYS);
  const plan = validation.ok
    ? planDayChanges(days, { startDate: form.startDate, endDate: form.endDate }, activities)
    : null;
  const dayWarning = plan ? describeDayChanges(plan) : null;

  const destinationChanged =
    form.destination.trim() && form.destination.trim() !== (trip.destination || '').trim();

  const handleSave = () => {
    if (!validation.ok) return setErrors(validation.errors);
    setErrors([]);
    onSave({ form, plan });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Trip Settings" size="lg">
      <div className="ts">
        <Input
          label="Trip title"
          value={form.title}
          onChange={set('title')}
          placeholder="Trip to Chikmagaluru"
        />

        <Input
          label="Destination"
          value={form.destination}
          onChange={set('destination')}
          placeholder="Chikmagaluru, Karnataka"
        />

        {destinationChanged && (
          <p className="ts__note">
            Changing the destination clears the saved map centre, so the map and
            weather move with it. Activities already on the itinerary keep their
            own locations — they are not re-planned.
          </p>
        )}

        <div className="ts__row">
          <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} />
          <Input label="End date" type="date" value={form.endDate} onChange={set('endDate')} />
        </div>

        {plan && !plan.unchanged && (
          <div className={`ts__plan ${plan.removed.length ? 'ts__plan--bad' : ''}`}>
            <strong className="ts__plan-title">What this does to your days</strong>
            <ul className="ts__plan-list">
              {plan.shifted > 0 && (
                <li>{plan.shifted} existing day{plan.shifted === 1 ? '' : 's'} move to a new date, keeping their activities.</li>
              )}
              {plan.added > 0 && (
                <li>{plan.added} empty day{plan.added === 1 ? '' : 's'} added to the end.</li>
              )}
              {dayWarning && <li className="ts__plan-danger">{dayWarning}</li>}
            </ul>
          </div>
        )}

        <div className="ts__row">
          <Input
            label="Total budget"
            type="number"
            min="0"
            value={form.totalBudget}
            onChange={set('totalBudget')}
            placeholder="Leave empty for no budget"
          />
          <div>
            <label className="ts__label">Getting around</label>
            <div className="ts__modes">
              {TRANSPORT_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={`ts__mode ${form.transportMode === mode.id ? 'ts__mode--on' : ''}`}
                  onClick={() => setForm((p) => ({ ...p, transportMode: mode.id }))}
                >
                  <span>{mode.icon}</span> {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="ts__errors">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="ts__actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={saving || !validation.ok}
          >
            {plan?.removed.length ? 'Save and remove those days' : 'Save changes'}
          </Button>
        </div>

        {canDelete && (
          <div className="ts__danger">
            <strong className="ts__danger-title">Delete this trip</strong>
            <p className="ts__note">
              Everything goes with it: {days.length} day{days.length === 1 ? '' : 's'},{' '}
              {Object.values(activities).flat().length} activities, and any bookings,
              expenses and collaborators. This cannot be undone.
            </p>
            {/* Typing the title is deliberate friction. A trip is weeks of
                planning, and a delete button next to a save button is one
                mis-click away from all of it. */}
            <Input
              label={`Type "${trip.title}" to confirm`}
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder={trip.title}
            />
            <Button
              variant="danger"
              onClick={onDelete}
              loading={deleting}
              disabled={deleting || confirmDelete.trim() !== (trip.title || '').trim()}
            >
              Delete trip permanently
            </Button>
          </div>
        )}
      </div>

      <style jsx>{`
        .ts { display: flex; flex-direction: column; gap: var(--space-4); }
        .ts__row {
          display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);
        }
        @media (max-width: 640px) { .ts__row { grid-template-columns: 1fr; } }
        .ts__label {
          display: block; font-size: var(--text-sm); font-weight: 600;
          margin-bottom: var(--space-1);
        }
        .ts__note { font-size: var(--text-xs); color: var(--color-text-tertiary); line-height: 1.5; }
        .ts__modes { display: flex; flex-wrap: wrap; gap: 6px; }
        .ts__mode {
          padding: 6px 10px; border-radius: var(--radius-full); cursor: pointer;
          border: 1px solid var(--color-border);
          background: var(--color-bg-secondary); color: var(--color-text-secondary);
          font-size: var(--text-xs);
        }
        .ts__mode--on {
          border-color: var(--color-primary); color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.08); font-weight: 600;
        }
        .ts__plan {
          padding: var(--space-3); border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
          border-left: 3px solid var(--color-info);
        }
        .ts__plan--bad { border-left-color: var(--color-error); background: var(--color-error-bg); }
        .ts__plan-title { font-size: var(--text-sm); }
        .ts__plan-list {
          margin: var(--space-1) 0 0; padding-left: var(--space-4);
          font-size: var(--text-xs); color: var(--color-text-secondary); line-height: 1.6;
        }
        .ts__plan-danger { color: var(--color-error); font-weight: 500; }
        .ts__errors {
          margin: 0; padding-left: var(--space-4);
          font-size: var(--text-sm); color: var(--color-error);
        }
        .ts__actions {
          display: flex; justify-content: flex-end; gap: var(--space-2);
        }
        .ts__danger {
          display: flex; flex-direction: column; gap: var(--space-2);
          border-top: 1px solid var(--color-border-light);
          padding-top: var(--space-4); margin-top: var(--space-2);
        }
        .ts__danger-title { font-size: var(--text-sm); color: var(--color-error); }
      `}</style>
    </Modal>
  );
}
