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
 * Balances and transfers are computed in integer cents, not decimals.
 *
 * Working in decimals meant the settle-up list did not actually settle. A
 * property test over generated expense sets found a member whose balance said
 * they owed 323.55 while the transfers moved 323.53. Three separate leaks, all
 * bounded by a cent and all able to compound across pairings: a transfer of a
 * cent or less was skipped while the running ledger was still decremented, the
 * emitted amount was rounded but the ledger was not, and a residual under a cent
 * was abandoned when moving to the next debtor.
 *
 * Integers remove all three. Cents are exact, so "does this reconcile?" has a
 * yes/no answer instead of a tolerance.
 */
const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => c / 100;

/**
 * One expense's shares as integer cents that sum to the amount exactly.
 *
 * sharesFor works in decimals and legitimately returns repeating values — an
 * equal three-way split of 100 gives 33.333… each. Rounding those independently
 * loses or gains a cent, so the remainder is handed out by largest fractional
 * part: the people rounded down hardest get the spare cents. Deterministic, and
 * the total always lands on the amount.
 */
function shareCents(expense) {
  const shares = sharesFor(expense);
  const ids = Object.keys(shares);
  if (ids.length === 0) return {};

  const totalCents = toCents(expense?.amount);
  const parts = ids.map((id) => {
    const exact = shares[id] * 100;
    return { id, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });

  let remainder = totalCents - parts.reduce((s, p) => s + p.cents, 0);

  // Largest fractional part first, then by id so the result never depends on
  // object key order.
  parts.sort((a, b) => b.fraction - a.fraction || (a.id < b.id ? -1 : 1));

  for (let k = 0; remainder > 0 && parts.length > 0; k++, remainder--) {
    parts[k % parts.length].cents += 1;
  }
  for (let k = 0; remainder < 0 && parts.length > 0; k++, remainder++) {
    parts[parts.length - 1 - (k % parts.length)].cents -= 1;
  }

  return Object.fromEntries(parts.map((p) => [p.id, p.cents]));
}

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
  // Accumulated in cents so the totals are exact; converted back on the way out
  // because every caller and every stored value speaks decimals.
  const cents = {};
  const ensure = (id) => (cents[id] ??= { paid: 0, owed: 0 });

  memberIds.forEach(ensure);

  for (const e of expenses) {
    const amountCents = toCents(e?.amount);
    const shares = shareCents(e);
    if (!amountCents || !e.paid_by || Object.keys(shares).length === 0) continue;

    ensure(e.paid_by).paid += amountCents;
    for (const [userId, owed] of Object.entries(shares)) {
      ensure(userId).owed += owed;
    }
  }

  const balances = {};
  for (const id of Object.keys(cents)) {
    const c = cents[id];
    balances[id] = {
      paid: fromCents(c.paid),
      owed: fromCents(c.owed),
      net: fromCents(c.paid - c.owed),
    };
  }

  return balances;
}

/** Per-person net in integer cents. Internal to the settlement functions. */
function netCents(expenses, memberIds) {
  const balances = computeBalances(expenses, memberIds);
  return Object.fromEntries(
    Object.entries(balances).map(([id, b]) => [id, toCents(b.net)])
  );
}

/**
 * Detailed debts: every expense creates a debt from each participant to the payer.
 * Aggregated per pair, then offset in both directions so a pair never shows two
 * opposing debts at once.
 */
export function detailedSettlements(expenses = []) {
  const pairs = new Map(); // "debtor->creditor" -> cents

  for (const e of expenses) {
    if (!e.paid_by) continue;
    for (const [userId, owedCents] of Object.entries(shareCents(e))) {
      if (userId === e.paid_by || owedCents <= 0) continue;
      const key = `${userId}->${e.paid_by}`;
      pairs.set(key, (pairs.get(key) || 0) + owedCents);
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

    // Cents, so an exactly-offsetting pair is exactly zero. A tolerance here
    // would silently drop up to a cent of real debt.
    const netCentsForPair = amount - reverse;
    if (netCentsForPair === 0) continue;

    result.push(
      netCentsForPair > 0
        ? { from, to, amount: fromCents(netCentsForPair) }
        : { from: to, to: from, amount: fromCents(-netCentsForPair) }
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
  const nets = netCents(expenses, memberIds);

  const debtors = [];   // owe money  (net < 0)
  const creditors = []; // are owed   (net > 0)

  for (const [id, net] of Object.entries(nets)) {
    if (net < 0) debtors.push({ id, cents: -net });
    else if (net > 0) creditors.push({ id, cents: net });
  }

  // Largest first, so big debts are cleared in single transfers. Tie-break on id
  // so the output is stable rather than dependent on object key order.
  debtors.sort((a, b) => b.cents - a.cents || (a.id < b.id ? -1 : 1));
  creditors.sort((a, b) => b.cents - a.cents || (a.id < b.id ? -1 : 1));

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].cents, creditors[j].cents);

    // Every cent is emitted. Skipping a small transfer while still decrementing
    // the ledger is what left members short of their stated balance.
    if (pay > 0) {
      transfers.push({
        from: debtors[i].id,
        to: creditors[j].id,
        amount: fromCents(pay),
      });
    }

    debtors[i].cents -= pay;
    creditors[j].cents -= pay;

    if (debtors[i].cents === 0) i++;
    if (creditors[j].cents === 0) j++;
  }

  return transfers.sort((a, b) => b.amount - a.amount);
}

/** Convenience wrapper used by the UI toggle. */
export function settle(expenses, memberIds, { simplify = true } = {}) {
  return simplify
    ? simplifiedSettlements(expenses, memberIds)
    : detailedSettlements(expenses);
}
