'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/currency';
import { nightsBetween, accommodationTotal } from '@/lib/bookings';

const TRANSPORT_TYPES = [
  { id: 'flight', icon: '✈️', label: 'Flight' },
  { id: 'train', icon: '🚆', label: 'Train' },
  { id: 'bus', icon: '🚌', label: 'Bus' },
  { id: 'car_rental', icon: '🚗', label: 'Car rental' },
  { id: 'bike_rental', icon: '🚲', label: 'Bike rental' },
  { id: 'ferry', icon: '⛴️', label: 'Ferry' },
  { id: 'taxi', icon: '🚕', label: 'Taxi' },
  { id: 'other', icon: '📦', label: 'Other' },
];

const describe = (err) =>
  [err?.code, err?.message, err?.details].filter(Boolean).join(' — ') || 'Unknown error';

const fmtDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

const fmtDateTime = (t) =>
  t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const EMPTY_STAY = {
  name: '', address: '', check_in: '', check_out: '',
  cost_per_night: '', booking_link: '', notes: '',
};
const EMPTY_TRANSPORT = {
  type: 'flight', from_location: '', to_location: '',
  departure_time: '', arrival_time: '', cost: '', booking_link: '', notes: '',
};

export default function BookingsPanel({ tripId, trip, isOpen, onClose, onChanged }) {
  const [tab, setTab] = useState('stays');
  const [stays, setStays] = useState([]);
  const [transport, setTransport] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // { kind, data }

  const toast = useToast();
  const supabase = getSupabaseBrowserClient();
  const currency = trip?.currency || 'USD';

  const load = useCallback(async () => {
    if (!tripId || !isOpen) return;
    setLoading(true);
    const [a, t] = await Promise.all([
      supabase.from('accommodations').select('*').eq('trip_id', tripId).order('check_in'),
      supabase.from('transport_bookings').select('*').eq('trip_id', tripId).order('departure_time'),
    ]);
    if (a.error) console.error('[WanderForge] accommodations:', describe(a.error));
    if (t.error) console.error('[WanderForge] transport:', describe(t.error));
    setStays(a.data || []);
    setTransport(t.data || []);
    setLoading(false);
  }, [tripId, isOpen]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    const { kind, data } = editing;

    if (kind === 'stay' && !data.name.trim()) return toast.error('Give the stay a name');
    if (kind === 'transport' && !data.from_location.trim() && !data.to_location.trim()) {
      return toast.error('Add at least a from or to location');
    }

    setSaving(true);
    try {
      const table = kind === 'stay' ? 'accommodations' : 'transport_bookings';
      const payload = kind === 'stay'
        ? {
            trip_id: tripId,
            name: data.name.trim(),
            address: data.address || null,
            check_in: data.check_in || null,
            check_out: data.check_out || null,
            cost_per_night: data.cost_per_night ? parseFloat(data.cost_per_night) : null,
            currency,
            booking_link: data.booking_link || null,
            notes: data.notes || null,
          }
        : {
            trip_id: tripId,
            type: data.type,
            from_location: data.from_location || null,
            to_location: data.to_location || null,
            departure_time: data.departure_time || null,
            arrival_time: data.arrival_time || null,
            cost: data.cost ? parseFloat(data.cost) : null,
            currency,
            booking_link: data.booking_link || null,
            notes: data.notes || null,
          };

      const { error } = data.id
        ? await supabase.from(table).update(payload).eq('id', data.id)
        : await supabase.from(table).insert(payload);
      if (error) throw error;

      toast.success(data.id ? 'Booking updated' : 'Booking added');
      setEditing(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(describe(err), 'Could not save booking');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind, id) => {
    const table = kind === 'stay' ? 'accommodations' : 'transport_bookings';
    const { error } = await supabase.from(table).delete().eq('id', id).select();
    if (error) return toast.error(describe(error), 'Delete failed');
    toast.success('Booking removed');
    load();
    onChanged?.();
  };

  const staysTotal = stays.reduce((s, a) => s + accommodationTotal(a), 0);
  const transportTotal = transport.reduce((s, t) => s + (Number(t.cost) || 0), 0);

  const field = (key, value) => setEditing((e) => ({ ...e, data: { ...e.data, [key]: value } }));

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Bookings" size="lg">
        <div className="bk">
          <div className="bk__totals">
            <div>
              <span className="bk__total">{formatMoney(staysTotal + transportTotal, currency)}</span>
              <span className="bk__muted"> booked</span>
            </div>
            <span className="bk__muted">
              {formatMoney(staysTotal, currency)} stays · {formatMoney(transportTotal, currency)} transport
            </span>
          </div>

          <div className="bk__tabs">
            <button className={`bk-tab ${tab === 'stays' ? 'bk-tab--on' : ''}`} onClick={() => setTab('stays')}>
              🏨 Stays ({stays.length})
            </button>
            <button className={`bk-tab ${tab === 'transport' ? 'bk-tab--on' : ''}`} onClick={() => setTab('transport')}>
              ✈️ Transport ({transport.length})
            </button>
          </div>

          {loading ? (
            <p className="bk__muted">Loading bookings...</p>
          ) : tab === 'stays' ? (
            <>
              <Button variant="primary" size="sm"
                onClick={() => setEditing({ kind: 'stay', data: { ...EMPTY_STAY } })}>
                + Add Stay
              </Button>
              {stays.length === 0 ? (
                <p className="bk__muted">No accommodation added yet.</p>
              ) : (
                <div className="bk__list">
                  {stays.map((s) => {
                    const nights = nightsBetween(s.check_in, s.check_out);
                    return (
                      <div key={s.id} className="bk-item">
                        <div className="bk-item__body">
                          <span className="bk-item__name">{s.name}</span>
                          <span className="bk__muted">
                            {fmtDate(s.check_in)} → {fmtDate(s.check_out)}
                            {nights ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
                            {s.address ? ` · ${s.address}` : ''}
                          </span>
                          {s.booking_link && (
                            <a className="bk-item__link" href={s.booking_link} target="_blank" rel="noreferrer">
                              Booking link ↗
                            </a>
                          )}
                        </div>
                        <span className="bk-item__cost">{formatMoney(accommodationTotal(s), currency)}</span>
                        <button className="bk-item__btn" onClick={() => setEditing({ kind: 'stay', data: { ...s, cost_per_night: s.cost_per_night ?? '' } })}>✏️</button>
                        <button className="bk-item__btn" onClick={() => remove('stay', s.id)}>🗑️</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <Button variant="primary" size="sm"
                onClick={() => setEditing({ kind: 'transport', data: { ...EMPTY_TRANSPORT } })}>
                + Add Transport
              </Button>
              {transport.length === 0 ? (
                <p className="bk__muted">No flights, trains or transfers added yet.</p>
              ) : (
                <div className="bk__list">
                  {transport.map((t) => {
                    const meta = TRANSPORT_TYPES.find((x) => x.id === t.type);
                    return (
                      <div key={t.id} className="bk-item">
                        <span className="bk-item__icon">{meta?.icon || '📦'}</span>
                        <div className="bk-item__body">
                          <span className="bk-item__name">
                            {t.from_location || '?'} → {t.to_location || '?'}
                          </span>
                          <span className="bk__muted">
                            {meta?.label || t.type} · {fmtDateTime(t.departure_time)} → {fmtDateTime(t.arrival_time)}
                          </span>
                          {t.booking_link && (
                            <a className="bk-item__link" href={t.booking_link} target="_blank" rel="noreferrer">
                              Booking link ↗
                            </a>
                          )}
                        </div>
                        <span className="bk-item__cost">{formatMoney(t.cost || 0, currency)}</span>
                        <button className="bk-item__btn" onClick={() => setEditing({ kind: 'transport', data: { ...t, cost: t.cost ?? '', departure_time: t.departure_time?.slice(0, 16) || '', arrival_time: t.arrival_time?.slice(0, 16) || '' } })}>✏️</button>
                        <button className="bk-item__btn" onClick={() => remove('transport', t.id)}>🗑️</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Add / edit */}
      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.kind === 'stay' ? 'Accommodation' : 'Transport'}
      >
        {editing && (
          <div className="bk">
            {editing.kind === 'stay' ? (
              <>
                <Input label="Name" placeholder="The Planters Court"
                  value={editing.data.name} onChange={(e) => field('name', e.target.value)} />
                <Input label="Address" placeholder="MG Road, Chikmagaluru"
                  value={editing.data.address} onChange={(e) => field('address', e.target.value)} />
                <div className="bk__row">
                  <Input label="Check-in" type="date"
                    value={editing.data.check_in} onChange={(e) => field('check_in', e.target.value)} />
                  <Input label="Check-out" type="date"
                    value={editing.data.check_out} onChange={(e) => field('check_out', e.target.value)} />
                </div>
                <Input label={`Cost per night (${currency})`} type="number" placeholder="3500"
                  value={editing.data.cost_per_night} onChange={(e) => field('cost_per_night', e.target.value)} />
                {nightsBetween(editing.data.check_in, editing.data.check_out) > 0 && editing.data.cost_per_night && (
                  <p className="bk__muted">
                    {nightsBetween(editing.data.check_in, editing.data.check_out)} nights ={' '}
                    {formatMoney(accommodationTotal(editing.data), currency)} total
                  </p>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="bk__label">Type</label>
                  <select className="bk__select" value={editing.data.type}
                    onChange={(e) => field('type', e.target.value)}>
                    {TRANSPORT_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="bk__row">
                  <Input label="From" placeholder="Bengaluru"
                    value={editing.data.from_location} onChange={(e) => field('from_location', e.target.value)} />
                  <Input label="To" placeholder="Manali"
                    value={editing.data.to_location} onChange={(e) => field('to_location', e.target.value)} />
                </div>
                <div className="bk__row">
                  <Input label="Departs" type="datetime-local"
                    value={editing.data.departure_time} onChange={(e) => field('departure_time', e.target.value)} />
                  <Input label="Arrives" type="datetime-local"
                    value={editing.data.arrival_time} onChange={(e) => field('arrival_time', e.target.value)} />
                </div>
                <Input label={`Cost (${currency})`} type="number" placeholder="4500"
                  value={editing.data.cost} onChange={(e) => field('cost', e.target.value)} />
              </>
            )}

            <Input label="Booking link" placeholder="https://..."
              value={editing.data.booking_link} onChange={(e) => field('booking_link', e.target.value)} />
            <Input label="Notes" placeholder="Confirmation number, contact..."
              value={editing.data.notes} onChange={(e) => field('notes', e.target.value)} />

            <div className="bk__actions">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={save} loading={saving} disabled={saving}>Save</Button>
            </div>
          </div>
        )}
      </Modal>

      <style jsx>{`
        .bk { display: flex; flex-direction: column; gap: var(--space-4); }
        .bk__muted { font-size: var(--text-sm); color: var(--color-text-tertiary); }
        .bk__totals {
          display: flex; justify-content: space-between; align-items: baseline;
          gap: var(--space-3); flex-wrap: wrap;
        }
        .bk__total { font-size: var(--text-2xl); font-weight: 700; }
        .bk__tabs { display: flex; gap: var(--space-2); }
        .bk-tab {
          flex: 1; padding: 8px 12px;
          border: 1px solid var(--color-border); border-radius: var(--radius-md);
          background: var(--color-surface); color: var(--color-text-secondary);
          font-family: var(--font-body); font-size: var(--text-sm); cursor: pointer;
        }
        .bk-tab--on {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.12);
          color: var(--color-primary); font-weight: 600;
        }
        .bk__list { display: flex; flex-direction: column; gap: var(--space-2); }
        .bk-item {
          display: flex; align-items: center; gap: var(--space-3);
          padding: var(--space-3); border-radius: var(--radius-md);
          background: var(--color-bg-secondary);
        }
        .bk-item__icon { font-size: 20px; flex-shrink: 0; }
        .bk-item__body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .bk-item__name { font-size: var(--text-sm); font-weight: 600; }
        .bk-item__link { font-size: var(--text-xs); color: var(--color-primary); }
        .bk-item__cost { font-size: var(--text-sm); font-weight: 700; }
        .bk-item__btn {
          border: none; background: none; cursor: pointer; font-size: 13px;
          width: 26px; height: 26px; border-radius: 50%;
        }
        .bk-item__btn:hover { background: var(--color-bg-tertiary); }
        .bk__row { display: flex; gap: var(--space-3); }
        .bk__row > :global(*) { flex: 1; }
        .bk__label { display: block; margin-bottom: var(--space-2); font-size: var(--text-sm); font-weight: 500; }
        .bk__select {
          width: 100%; padding: var(--space-3);
          border: 1px solid var(--color-border); border-radius: var(--radius-md);
          background: var(--color-surface); color: var(--color-text);
          font-family: var(--font-body); font-size: var(--text-sm);
        }
        .bk__actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
      `}</style>
    </>
  );
}
