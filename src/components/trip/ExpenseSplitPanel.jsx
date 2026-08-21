'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthProvider';
import { formatMoney, currencySymbol } from '@/lib/currency';
import { computeBalances, settle } from '@/lib/settlement';

// Emails are no longer readable by client roles (migration 007), so display_name
// is the only label available. handle_new_user always sets one at signup.
const nameOf = (m) => m?.display_name || 'Unknown';
const avatarHue = (label) => ((label?.charCodeAt(0) || 0) * 40) % 360;

/**
 * Supabase error objects carry their detail on non-enumerable-ish fields, so
 * logging them directly prints "{}". Pull out what actually identifies the fault.
 */
const describe = (err) =>
  [err?.code, err?.message, err?.details, err?.hint].filter(Boolean).join(' — ') ||
  'Unknown error';

export default function ExpenseSplitPanel({ tripId, trip, collaborators = [], isOpen, onClose }) {
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simplify, setSimplify] = useState(trip?.simplify_balances ?? true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    description: '', amount: '', paid_by: '', participants: [],
    splitMode: 'equal', custom: {},
  });

  const { user } = useAuth();
  const toast = useToast();
  const supabase = getSupabaseBrowserClient();
  const currency = trip?.currency || 'USD';

  const load = useCallback(async () => {
    if (!tripId || !isOpen) return;
    setLoading(true);
    setSetupNeeded(false);

    // Members first. Prefer the RPC, but fall back to the tables the editor
    // already reads so the participant picker still works before migration 005.
    let memberList = [];
    const { data: memberRows, error: mErr } = await supabase.rpc('get_trip_members', {
      p_trip_id: tripId,
    });

    if (!mErr && memberRows?.length) {
      memberList = memberRows;
    } else {
      if (mErr) console.warn('[WanderForge] get_trip_members unavailable:', describe(mErr));
      const ids = [trip?.user_id, ...(collaborators || []).filter(c => c.accepted).map(c => c.user_id)]
        .filter(Boolean);
      if (ids.length) {
        // email is not selectable by client roles after migration 007.
        const { data: people } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', ids);
        memberList = (people || []).map(p => ({
          user_id: p.id,
          display_name: p.display_name,
          role: p.id === trip?.user_id ? 'owner' : 'editor',
        }));
      }
    }

    // The owner can also appear as a collaborator row; keep one entry each.
    const unique = [];
    for (const m of memberList) {
      if (!unique.some((x) => x.user_id === m.user_id)) unique.push(m);
    }
    setMembers(unique);

    // Expenses require migration 005; without it the feature is read-only-empty.
    const { data: expenseRows, error: eErr } = await supabase
      .from('trip_expenses')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false });

    if (eErr) {
      // PGRST205 = table missing from schema cache, PGRST202 = function missing.
      if (eErr.code === 'PGRST205' || eErr.code === 'PGRST202') {
        setSetupNeeded(true);
      } else {
        console.error('[WanderForge] Failed to load expenses:', describe(eErr));
        toast.error(describe(eErr), 'Expenses');
      }
      setExpenses([]);
    } else {
      setExpenses(expenseRows || []);
    }

    setLoading(false);
  }, [tripId, isOpen, trip?.user_id, collaborators]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    if (members.length === 0) {
      toast.error('No trip members found to split between.', 'Expenses');
      return;
    }
    setForm({
      description: '',
      amount: '',
      paid_by: user?.id || members[0]?.user_id || '',
      participants: members.map((m) => m.user_id),
      splitMode: 'equal',
      custom: {},
    });
    setShowAdd(true);
  };

  const toggleParticipant = (id) =>
    setForm((f) => ({
      ...f,
      participants: f.participants.includes(id)
        ? f.participants.filter((p) => p !== id)
        : [...f.participants, id],
    }));

  /**
   * Turns the custom inputs into concrete per-person amounts, and reports whether
   * they add up. Percentages are converted to amounts here so everything stored
   * (and every settlement calculation) speaks in money.
   */
  const buildCustomShares = () => {
    const amount = parseFloat(form.amount) || 0;
    const entries = members
      .map((m) => [m.user_id, parseFloat(form.custom[m.user_id]) || 0])
      .filter(([, v]) => v > 0);

    if (form.splitMode === 'percent') {
      const pct = entries.reduce((s, [, v]) => s + v, 0);
      return {
        shares: Object.fromEntries(entries.map(([id, v]) => [id, (amount * v) / 100])),
        total: pct,
        ok: Math.abs(pct - 100) < 0.01,
        message:
          entries.length === 0
            ? 'Enter a percentage for at least one person.'
            : Math.abs(pct - 100) < 0.01
              ? 'Adds up to 100%.'
              : `${pct.toFixed(2)}% assigned — ${pct > 100 ? 'over' : 'under'} by ${Math.abs(100 - pct).toFixed(2)}%.`,
      };
    }

    const sum = entries.reduce((s, [, v]) => s + v, 0);
    const diff = amount - sum;
    return {
      shares: Object.fromEntries(entries),
      total: sum,
      ok: amount > 0 && Math.abs(diff) < 0.01,
      message:
        entries.length === 0
          ? 'Enter an amount for at least one person.'
          : Math.abs(diff) < 0.01
            ? `Adds up to ${formatMoney(amount, currency, { decimals: 2 })}.`
            : diff > 0
              ? `${formatMoney(diff, currency, { decimals: 2 })} still unassigned.`
              : `${formatMoney(-diff, currency, { decimals: 2 })} over the total.`,
    };
  };

  const splitStatus =
    form.splitMode === 'equal'
      ? { ok: form.participants.length > 0, message: '' }
      : buildCustomShares();

  const distributeEvenly = () => {
    const amount = parseFloat(form.amount) || 0;
    if (!amount || members.length === 0) return;
    const each = Math.floor((amount / members.length) * 100) / 100;
    const custom = Object.fromEntries(members.map((m) => [m.user_id, String(each)]));
    // Give any rounding remainder to the first person so the total matches exactly.
    const remainder = Math.round((amount - each * members.length) * 100) / 100;
    if (remainder !== 0) {
      custom[members[0].user_id] = String(Math.round((each + remainder) * 100) / 100);
    }
    setForm((f) => ({ ...f, custom }));
  };

  const saveExpense = async () => {
    const amount = parseFloat(form.amount);
    if (!form.description.trim()) return toast.error('Add a description');
    if (!amount || amount <= 0) return toast.error('Enter an amount greater than zero');
    if (!form.paid_by) return toast.error('Select who paid');

    let participants = form.participants;
    let shares = {};

    if (form.splitMode === 'equal') {
      if (participants.length === 0) {
        return toast.error('Select at least one person to split between');
      }
    } else {
      const built = buildCustomShares();
      if (!built.ok) return toast.error(built.message, 'Split does not add up');
      shares = built.shares;
      participants = Object.keys(shares);
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('trip_expenses').insert({
        trip_id: tripId,
        description: form.description.trim(),
        amount,
        currency,
        paid_by: form.paid_by,
        participants,
        split_mode: form.splitMode,
        shares,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success('Expense added');
      setShowAdd(false);
      load();
    } catch (err) {
      toast.error(describe(err), 'Could not add expense');
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async (id) => {
    const { error } = await supabase.from('trip_expenses').delete().eq('id', id).select();
    if (error) return toast.error(describe(error), 'Delete failed');
    toast.success('Expense removed');
    load();
  };

  const toggleSimplify = async (next) => {
    setSimplify(next);
    // Persist per trip so everyone sees the same view.
    await supabase.from('trips').update({ simplify_balances: next }).eq('id', tripId);
  };

  const memberIds = members.map((m) => m.user_id);
  const balances = computeBalances(expenses, memberIds);
  const transfers = settle(expenses, memberIds, { simplify });
  const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const label = (id) => nameOf(members.find((m) => m.user_id === id));

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Split Expenses" size="lg">
        {loading ? (
          <p className="split__muted">Loading expenses...</p>
        ) : setupNeeded ? (
          <div className="split">
            {/* This used to tell the traveler to run
                `supabase/migrations/005_expenses_and_currency.sql` in the
                Supabase SQL Editor. That is an instruction for whoever deployed
                the app, shown to someone who wants to split a dinner bill and
                has no Supabase account, no SQL editor and no idea what a
                migration is. The person who can fix it is not in the room, so
                say what is true and get out of the way. */}
            <div className="split__setup">
              <span className="split__setup-icon">🛠️</span>
              <h4>Bill splitting isn&apos;t switched on</h4>
              <p className="split__muted">
                This feature isn&apos;t available on this WanderForge yet — it needs
                to be enabled by whoever set the app up. Everything else on your
                trip works normally.
              </p>
              <Button variant="ghost" size="sm" onClick={load}>Check again</Button>
            </div>
          </div>
        ) : (
          <div className="split">
            {/* Summary */}
            <div className="split__summary">
              <div>
                <span className="split__total">{formatMoney(total, currency, { decimals: 2 })}</span>
                <span className="split__muted"> across {expenses.length} expense{expenses.length === 1 ? '' : 's'}</span>
              </div>
              <Button variant="primary" size="sm" onClick={openAdd}>+ Add Expense</Button>
            </div>

            {members.length < 2 && (
              <p className="split__hint">
                Only you are on this trip. Invite collaborators to split costs between people.
              </p>
            )}

            {/* Balances */}
            <div className="split__section">
              <h4 className="split__heading">Balances</h4>
              <div className="split__balances">
                {members.map((m) => {
                  const b = balances[m.user_id] || { paid: 0, owed: 0, net: 0 };
                  const state = b.net > 0.01 ? 'positive' : b.net < -0.01 ? 'negative' : 'even';
                  return (
                    <div key={m.user_id} className="bal-row">
                      <span className="bal-row__avatar" style={{ background: `hsl(${avatarHue(nameOf(m))}, 60%, 50%)` }}>
                        {nameOf(m)[0].toUpperCase()}
                      </span>
                      <span className="bal-row__name">
                        {nameOf(m)}{m.user_id === user?.id ? ' (you)' : ''}
                      </span>
                      <span className="split__muted">paid {formatMoney(b.paid, currency, { decimals: 2 })}</span>
                      <span className={`bal-row__net bal-row__net--${state}`}>
                        {state === 'even'
                          ? 'settled up'
                          : state === 'positive'
                            ? `gets back ${formatMoney(b.net, currency, { decimals: 2 })}`
                            : `owes ${formatMoney(-b.net, currency, { decimals: 2 })}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Settlements */}
            <div className="split__section">
              <div className="split__section-top">
                <h4 className="split__heading">Who pays whom</h4>
                <label className="split__toggle">
                  <input type="checkbox" checked={simplify} onChange={(e) => toggleSimplify(e.target.checked)} />
                  <span>Simplify balances</span>
                </label>
              </div>

              <p className="split__muted split__note">
                {simplify
                  ? 'Debts are netted out into the fewest possible transfers.'
                  : 'Showing every debt exactly as it arose, without netting across people.'}
              </p>

              {transfers.length === 0 ? (
                <p className="split__muted">Everyone is settled up. 🎉</p>
              ) : (
                <div className="split__transfers">
                  {transfers.map((t, i) => (
                    <div key={i} className="transfer">
                      <span className="transfer__from">{label(t.from)}</span>
                      <span className="transfer__arrow">pays →</span>
                      <span className="transfer__to">{label(t.to)}</span>
                      <span className="transfer__amount">{formatMoney(t.amount, currency, { decimals: 2 })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Expense list */}
            <div className="split__section">
              <h4 className="split__heading">Expenses</h4>
              {expenses.length === 0 ? (
                <p className="split__muted">No expenses yet. Add the first one above.</p>
              ) : (
                <div className="split__list">
                  {expenses.map((e) => (
                    <div key={e.id} className="exp">
                      <div className="exp__body">
                        <span className="exp__desc">{e.description}</span>
                        <span className="split__muted">
                          {label(e.paid_by)} paid · {(e.participants || []).length} people
                          {e.split_mode && e.split_mode !== 'equal' ? ' · unequal' : ' · equal'}
                        </span>
                      </div>
                      <span className="exp__amount">{formatMoney(e.amount, e.currency || currency, { decimals: 2 })}</span>
                      {(e.created_by === user?.id || trip?.user_id === user?.id) && (
                        <button className="exp__del" onClick={() => deleteExpense(e.id)} title="Remove">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Add expense */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Expense">
        <div className="split">
          <Input
            label="Description"
            placeholder="Dinner at Town Canteen"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Input
            label={`Amount (${currency})`}
            type="number"
            placeholder="1200"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />

          <div>
            <label className="split__label">Paid by</label>
            <select
              className="split__select"
              value={form.paid_by}
              onChange={(e) => setForm({ ...form, paid_by: e.target.value })}
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {nameOf(m)}{m.user_id === user?.id ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="split__label">How to split</label>
            <div className="split__modes">
              {[
                ['equal', 'Equally'],
                ['exact', 'By amount'],
                ['percent', 'By percentage'],
              ].map(([mode, text]) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode ${form.splitMode === mode ? 'mode--on' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, splitMode: mode }))}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          {form.splitMode === 'equal' ? (
            <div>
              <label className="split__label">Split between ({form.participants.length})</label>
              <div className="split__people">
                {members.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    className={`person ${form.participants.includes(m.user_id) ? 'person--on' : ''}`}
                    onClick={() => toggleParticipant(m.user_id)}
                  >
                    {nameOf(m)}{m.user_id === user?.id ? ' (you)' : ''}
                  </button>
                ))}
              </div>
              {form.participants.length > 0 && parseFloat(form.amount) > 0 && (
                <p className="split__muted split__note">
                  {formatMoney(parseFloat(form.amount) / form.participants.length, currency, { decimals: 2 })} each
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="split__label">
                {form.splitMode === 'exact'
                  ? `Amount per person (${currency})`
                  : 'Percentage per person'}
              </label>
              <div className="split__rows">
                {members.map((m) => (
                  <div key={m.user_id} className="share-row">
                    <span className="share-row__name">
                      {nameOf(m)}{m.user_id === user?.id ? ' (you)' : ''}
                    </span>
                    <input
                      className="share-row__input"
                      type="number"
                      min="0"
                      step={form.splitMode === 'percent' ? '1' : '0.01'}
                      placeholder="0"
                      value={form.custom[m.user_id] ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          custom: { ...f.custom, [m.user_id]: e.target.value },
                        }))
                      }
                    />
                    <span className="share-row__unit">
                      {form.splitMode === 'percent' ? '%' : currencySymbol(currency)}
                    </span>
                  </div>
                ))}
              </div>

              <div className={`split__tally ${splitStatus.ok ? 'split__tally--ok' : 'split__tally--off'}`}>
                {splitStatus.message}
              </div>

              {form.splitMode === 'exact' && parseFloat(form.amount) > 0 && (
                <button type="button" className="split__link" onClick={distributeEvenly}>
                  Fill evenly, then adjust
                </button>
              )}
            </div>
          )}

          <div className="split__actions">
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveExpense} loading={saving} disabled={saving}>
              Add Expense
            </Button>
          </div>
        </div>
      </Modal>

      <style jsx>{`
        .split { display: flex; flex-direction: column; gap: var(--space-5); }
        .split__muted { color: var(--color-text-tertiary); font-size: var(--text-sm); }
        .split__note { margin-top: var(--space-1); }
        .split__hint {
          padding: var(--space-3);
          border-radius: var(--radius-md);
          background: var(--color-info-bg);
          color: var(--color-info);
          font-size: var(--text-sm);
        }
        .split__summary {
          display: flex; align-items: center; justify-content: space-between;
          gap: var(--space-4); flex-wrap: wrap;
        }
        .split__total { font-size: var(--text-2xl); font-weight: 700; }
        .split__section { display: flex; flex-direction: column; gap: var(--space-2); }
        .split__section-top {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        }
        .split__heading {
          font-size: var(--text-sm); font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--color-text-secondary);
        }
        .split__toggle {
          display: flex; align-items: center; gap: var(--space-2);
          font-size: var(--text-sm); cursor: pointer; user-select: none;
        }
        .split__balances, .split__transfers, .split__list {
          display: flex; flex-direction: column; gap: var(--space-2);
        }
        .bal-row {
          display: flex; align-items: center; gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md); background: var(--color-bg-secondary);
          flex-wrap: wrap;
        }
        .bal-row__avatar {
          width: 26px; height: 26px; border-radius: 50%; color: #fff;
          font-size: 12px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .bal-row__name { font-weight: 600; font-size: var(--text-sm); }
        .bal-row__net { margin-left: auto; font-size: var(--text-sm); font-weight: 600; }
        .bal-row__net--positive { color: var(--color-success); }
        .bal-row__net--negative { color: var(--color-error); }
        .bal-row__net--even { color: var(--color-text-tertiary); }
        .transfer {
          display: flex; align-items: center; gap: var(--space-2);
          padding: var(--space-3);
          border: 1px solid var(--color-border-light); border-radius: var(--radius-md);
          font-size: var(--text-sm); flex-wrap: wrap;
        }
        .transfer__from, .transfer__to { font-weight: 600; }
        .transfer__arrow { color: var(--color-text-tertiary); }
        .transfer__amount { margin-left: auto; font-weight: 700; color: var(--color-primary); }
        .exp {
          display: flex; align-items: center; gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md); background: var(--color-bg-secondary);
        }
        .exp__body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .exp__desc { font-size: var(--text-sm); font-weight: 500; }
        .exp__amount { font-weight: 600; font-size: var(--text-sm); }
        .exp__del {
          border: none; background: none; cursor: pointer;
          color: var(--color-text-tertiary); font-size: 12px;
          width: 24px; height: 24px; border-radius: 50%;
        }
        .exp__del:hover { background: var(--color-error-bg); color: var(--color-error); }
        .split__label {
          display: block; margin-bottom: var(--space-2);
          font-size: var(--text-sm); font-weight: 500;
        }
        .split__select {
          width: 100%; padding: var(--space-3);
          border: 1px solid var(--color-border); border-radius: var(--radius-md);
          background: var(--color-surface); color: var(--color-text);
          font-family: var(--font-body); font-size: var(--text-sm);
        }
        .split__people { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .person {
          padding: 6px 12px; border-radius: 999px;
          border: 1px solid var(--color-border); background: var(--color-surface);
          color: var(--color-text-secondary);
          font-family: var(--font-body); font-size: var(--text-sm); cursor: pointer;
        }
        .person--on {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.12);
          color: var(--color-primary);
          font-weight: 600;
        }
        .split__actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
        .split__modes { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .mode {
          flex: 1; min-width: 92px; padding: 8px 10px;
          border: 1px solid var(--color-border); border-radius: var(--radius-md);
          background: var(--color-surface); color: var(--color-text-secondary);
          font-family: var(--font-body); font-size: var(--text-sm); cursor: pointer;
        }
        .mode--on {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.12);
          color: var(--color-primary); font-weight: 600;
        }
        .split__rows { display: flex; flex-direction: column; gap: var(--space-2); }
        .share-row {
          display: flex; align-items: center; gap: var(--space-3);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md); background: var(--color-bg-secondary);
        }
        .share-row__name { flex: 1; font-size: var(--text-sm); font-weight: 500; }
        .share-row__input {
          width: 110px; padding: 6px 10px; text-align: right;
          border: 1px solid var(--color-border); border-radius: var(--radius-sm);
          background: var(--color-surface); color: var(--color-text);
          font-family: var(--font-body); font-size: var(--text-sm);
        }
        .share-row__unit {
          width: 26px; font-size: var(--text-sm); color: var(--color-text-tertiary);
        }
        .split__tally {
          margin-top: var(--space-2); padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md); font-size: var(--text-sm); font-weight: 500;
        }
        .split__tally--ok { background: var(--color-success-bg); color: var(--color-success); }
        .split__tally--off { background: var(--color-warning-bg); color: var(--color-warning); }
        .split__link {
          margin-top: var(--space-2); border: none; background: none; padding: 0;
          color: var(--color-primary); font-family: var(--font-body);
          font-size: var(--text-sm); cursor: pointer; text-decoration: underline;
        }
        .split__setup { text-align: center; padding: var(--space-6) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); align-items: center; }
        .split__setup-icon { font-size: 40px; }
        .split__code {
          display: block; padding: var(--space-3);
          background: var(--color-bg-secondary); border-radius: var(--radius-md);
          font-family: var(--font-mono, monospace); font-size: var(--text-xs);
          word-break: break-all; width: 100%;
        }
      `}</style>
    </>
  );
}
