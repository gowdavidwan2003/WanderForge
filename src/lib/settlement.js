/**
 * Expense settlement for trip collaborators.
 *
 * Two modes:
 *  - Detailed  : who owes whom, derived directly from each expense. Preserves the
 *                real chain of debts (A→B, B→C, C→A).
 *  - Simplified: nets everyone out and produces the fewest transfers that settle
 *                the group. The classic example — A owes B 1000, B owes C 2000,
 *                C owes A 1000 — collapses to a single transfer: B pays C 1000.
 */

// Money is stored as a decimal; compare in whole units to avoid float dust
// leaving behind ₹0.0000001 "debts".
const EPSILON = 0.01;
const round = (n) => Math.round(n * 100) / 100;

/**
 * What each person owes for one expense, as { userId: amount }.
 *
 * An expense either carries explicit `shares` (an unequal split entered by the
 * user) or splits its amount equally across `participants`. Everything
 * downstream works off this, so equal and unequal splits share one code path.
 *
 * The returned shares always sum to the expense amount — every caller relies on
 * that to keep the group's balances netting to zero. When explicit shares do not
 * already sum correctly, the shortfall is resolved in this order:
 *
 *  1. Over-assigned (shares exceed the amount): scale down proportionally. The
 *     group is never billed more in total than was actually spent, and the
 *     relative split the user entered is preserved.
 *  2. Under-assigned with participants left unnamed: those participants split
 *     the remainder equally. Naming one person's portion of a bill says what
 *     they owe, not that everyone else owes nothing.
 *  3. Under-assigned with the payer unnamed: the payer absorbs the remainder.
 *  4. Under-assigned with everyone already named: scale up proportionally. Here
 *     the split really is stale relative to the amount — the case this guard was
 *     originally written for — so keeping the entered ratio is the best guess.
 *
 * Only case 4 rescales an under-assigned split. Applying it to case 2 charged a
 * partial share the entire bill: assigning 30 of a 100 expense to one friend
 * billed them 100.
 */
export function sharesFor(expense) {
  const amount = Number(expense?.amount) || 0;
  if (!amount) return {};

  const participants = (expense?.participants || []).filter(Boolean);
  const explicit =
    expense?.shares && typeof expense.shares === 'object' ? expense.shares : null;

  if (explicit) {
    const entries = Object.entries(explicit)
      .map(([id, v]) => [id, Number(v) || 0])
      .filter(([, v]) => v > 0);

    if (entries.length) {
      const named = new Set(entries.map(([id]) => id));
      const sum = entries.reduce((s, [, v]) => s + v, 0);
      const scaled = () => Object.fromEntries(entries.map(([id, v]) => [id, (v * amount) / sum]));

      // 1. Over-assigned.
      if (sum - amount > EPSILON) return scaled();

      const remainder = amount - sum;
      if (remainder <= EPSILON) return Object.fromEntries(entries);

      // 2. Participants who were not given a share cover what is left.
      const unnamed = participants.filter((p) => !named.has(p));
      if (unnamed.length) {
        const each = remainder / unnamed.length;
        return Object.fromEntries([...entries, ...unnamed.map((p) => [p, each])]);
      }

      // 3. Nobody left but the payer.
      if (expense?.paid_by && !named.has(expense.paid_by)) {
        return Object.fromEntries([...entries, [expense.paid_by, remainder]]);
      }

      // 4. Everyone is named and the total drifted.
      return scaled();
    }
  }

  if (!participants.length) return {};

  const each = amount / participants.length;
  return Object.fromEntries(participants.map((p) => [p, each]));
}

/**
 * Per-person totals.
 * @param expenses [{ amount, paid_by, participants: [userId] }]
 * @returns { [userId]: { paid, owed, net } }  net > 0 means the group owes them.
 */
export function computeBalances(expenses = [], memberIds = []) {
  const balances = {};
  const ensure = (id) => (balances[id] ??= { paid: 0, owed: 0, net: 0 });

  memberIds.forEach(ensure);

  for (const e of expenses) {
    const amount = Number(e.amount) || 0;
    const shares = sharesFor(e);
    if (!amount || !e.paid_by || Object.keys(shares).length === 0) continue;

    ensure(e.paid_by).paid += amount;
    for (const [userId, owed] of Object.entries(shares)) {
      ensure(userId).owed += owed;
    }
  }

  for (const id of Object.keys(balances)) {
    const b = balances[id];
    b.paid = round(b.paid);
    b.owed = round(b.owed);
    b.net = round(b.paid - b.owed);
  }

  return balances;
}

/**
 * Detailed debts: every expense creates a debt from each participant to the payer.
 * Aggregated per pair, then offset in both directions so a pair never shows two
 * opposing debts at once.
 */
export function detailedSettlements(expenses = []) {
  const pairs = new Map(); // "debtor->creditor" -> amount

  for (const e of expenses) {
    if (!e.paid_by) continue;
    for (const [userId, owed] of Object.entries(sharesFor(e))) {
      if (userId === e.paid_by || owed <= 0) continue;
      const key = `${userId}->${e.paid_by}`;
      pairs.set(key, (pairs.get(key) || 0) + owed);
    }
  }

  // Offset mutual debts: if A owes B 500 and B owes A 200, keep only A owes B 300.
  const seen = new Set();
  const result = [];

  for (const [key, amount] of pairs.entries()) {
    if (seen.has(key)) continue;
    const [from, to] = key.split('->');
    const reverseKey = `${to}->${from}`;
    const reverse = pairs.get(reverseKey) || 0;

    seen.add(key);
    seen.add(reverseKey);

    const netAmount = amount - reverse;
    if (Math.abs(netAmount) < EPSILON) continue;

    result.push(
      netAmount > 0
        ? { from, to, amount: round(netAmount) }
        : { from: to, to: from, amount: round(-netAmount) }
    );
  }

  return result.sort((a, b) => b.amount - a.amount);
}

/**
 * Simplified settlements: minimise the number of transfers.
 *
 * Greedy max-debtor/max-creditor matching. This is not guaranteed to be the
 * theoretical minimum (that problem is NP-hard), but it always settles everyone
 * and in practice produces the minimum for realistic group sizes.
 */
export function simplifiedSettlements(expenses = [], memberIds = []) {
  const balances = computeBalances(expenses, memberIds);

  const debtors = [];   // owe money  (net < 0)
  const creditors = []; // are owed   (net > 0)

  for (const [id, b] of Object.entries(balances)) {
    if (b.net < -EPSILON) debtors.push({ id, amount: -b.net });
    else if (b.net > EPSILON) creditors.push({ id, amount: b.net });
  }

  // Largest first, so big debts are cleared in single transfers.
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);

    if (pay > EPSILON) {
      transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: round(pay) });
    }

    debtors[i].amount -= pay;
    creditors[j].amount -= pay;

    if (debtors[i].amount < EPSILON) i++;
    if (creditors[j].amount < EPSILON) j++;
  }

  return transfers.sort((a, b) => b.amount - a.amount);
}

/** Convenience wrapper used by the UI toggle. */
export function settle(expenses, memberIds, { simplify = true } = {}) {
  return simplify
    ? simplifiedSettlements(expenses, memberIds)
    : detailedSettlements(expenses);
}
