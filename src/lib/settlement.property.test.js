import { describe, expect, it } from 'vitest';
import {
  computeBalances,
  detailedSettlements,
  sharesFor,
  simplifiedSettlements,
} from '@/lib/settlement';

/**
 * Rounding and reconciliation properties for settlement.
 *
 * settlement.test.js pins specific behaviours. This file asserts the invariants
 * that must hold for *every* input, because the failure mode that matters with
 * money is not a wrong answer on a case someone thought of — it is a balance
 * that quietly does not add up.
 *
 * Seeded PRNG rather than Math.random so a failure is reproducible: the seed is
 * printed with the case, and re-running gives the identical sequence.
 */
function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEMBERS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** One random but plausible expense set. */
function generateCase(rand) {
  const memberCount = 2 + Math.floor(rand() * 5);
  const members = MEMBERS.slice(0, memberCount);
  const expenseCount = 1 + Math.floor(rand() * 12);
  const expenses = [];

  for (let i = 0; i < expenseCount; i++) {
    // Amounts with real cents, including awkward ones.
    const amount = Math.round((1 + rand() * 5000) * 100) / 100;
    const paid_by = members[Math.floor(rand() * members.length)];

    const participants = members.filter(() => rand() > 0.25);
    if (participants.length === 0) participants.push(paid_by);

    const expense = { amount, paid_by, participants };

    // A third of the time, an explicit split — sometimes partial, sometimes
    // over-summing, sometimes exact. All three are states sharesFor must handle.
    const roll = rand();
    if (roll < 0.33) {
      const shares = {};
      const shape = rand();
      if (shape < 0.4) {
        // Partial: name only some participants. This is the S0-2 bug's shape.
        for (const p of participants) {
          if (rand() > 0.5) shares[p] = Math.round(rand() * amount * 0.4 * 100) / 100;
        }
      } else if (shape < 0.7) {
        // Over-sum: names add up to more than the bill.
        for (const p of participants) {
          shares[p] = Math.round(amount * 0.8 * 100) / 100;
        }
      } else {
        // Exact-ish: split evenly with the remainder on the first person.
        const each = Math.floor((amount / participants.length) * 100) / 100;
        participants.forEach((p) => { shares[p] = each; });
        const drift = Math.round((amount - each * participants.length) * 100) / 100;
        if (drift !== 0) shares[participants[0]] = Math.round((each + drift) * 100) / 100;
      }
      if (Object.values(shares).some((v) => v > 0)) expense.shares = shares;
    }

    expenses.push(expense);
  }

  return { members, expenses };
}

const sum = (xs) => xs.reduce((s, x) => s + x, 0);

describe('sharesFor — cent handling', () => {
  it('splits an indivisible amount without losing or inventing money', () => {
    // 100 / 3 cannot be represented exactly in cents.
    const shares = sharesFor({ amount: 100, paid_by: 'a', participants: ['a', 'b', 'c'] });
    expect(sum(Object.values(shares))).toBeCloseTo(100, 10);
  });

  it('handles the smallest representable amount', () => {
    const shares = sharesFor({ amount: 0.01, paid_by: 'a', participants: ['a', 'b'] });
    expect(sum(Object.values(shares))).toBeCloseTo(0.01, 10);
  });

  it('does not truncate when scaling an over-summed split', () => {
    const shares = sharesFor({
      amount: 33.33,
      paid_by: 'a',
      participants: ['a', 'b', 'c'],
      shares: { a: 50, b: 50, c: 50 },
    });
    expect(sum(Object.values(shares))).toBeCloseTo(33.33, 10);
  });

  it('keeps large amounts exact', () => {
    const shares = sharesFor({ amount: 999999.99, paid_by: 'a', participants: ['a', 'b', 'c', 'd'] });
    expect(sum(Object.values(shares))).toBeCloseTo(999999.99, 6);
  });

  // The invariant every caller depends on.
  it('always produces shares summing to the amount, across 500 random expenses', () => {
    const rand = mulberry32(20260817);
    for (let i = 0; i < 500; i++) {
      const { expenses } = generateCase(rand);
      for (const e of expenses) {
        const shares = sharesFor(e);
        if (Object.keys(shares).length === 0) continue;
        expect(sum(Object.values(shares))).toBeCloseTo(e.amount, 6);
      }
    }
  });
});

describe('reconciliation properties', () => {
  const SEEDS = [1, 7, 42, 1337, 20260817, 99999];

  it('nets the group to zero for every generated case', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      for (let i = 0; i < 120; i++) {
        const { members, expenses } = generateCase(rand);
        const balances = computeBalances(expenses, members);
        // Exact, not approximate. Balances are accumulated in integer cents, so
        // the group must net to zero to the cent — a tolerance here would hide
        // exactly the leak this file was written to catch.
        const netCents = sum(Object.values(balances).map((b) => Math.round(b.net * 100)));
        expect(netCents, `seed ${seed} case ${i}: net ${netCents} cents`).toBe(0);
      }
    }
  });

  it('settles every member to their computed balance', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      for (let i = 0; i < 120; i++) {
        const { members, expenses } = generateCase(rand);
        const balances = computeBalances(expenses, members);
        const transfers = simplifiedSettlements(expenses, members);

        for (const id of members) {
          const cents = (t) => Math.round(t.amount * 100);
          const paidOut = sum(transfers.filter((t) => t.from === id).map(cents));
          const received = sum(transfers.filter((t) => t.to === id).map(cents));
          const settled = received - paidOut;
          const owedNet = Math.round((balances[id]?.net ?? 0) * 100);
          // To the cent. This assertion is what caught the settle-up leak: a
          // member whose balance said 323.55 was only sent 323.53.
          expect(
            settled,
            `seed ${seed} case ${i} member ${id}: settled ${settled} vs net ${owedNet} cents`
          ).toBe(owedNet);
        }
      }
    }
  });

  it('never emits a self-transfer, a zero or a negative amount', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      for (let i = 0; i < 120; i++) {
        const { members, expenses } = generateCase(rand);
        for (const transfers of [
          simplifiedSettlements(expenses, members),
          detailedSettlements(expenses),
        ]) {
          for (const t of transfers) {
            expect(t.from, `seed ${seed} case ${i}`).not.toBe(t.to);
            expect(t.amount, `seed ${seed} case ${i}`).toBeGreaterThan(0);
            expect(Number.isFinite(t.amount)).toBe(true);
          }
        }
      }
    }
  });

  it('moves the same total in simplified and detailed mode', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      for (let i = 0; i < 60; i++) {
        const { members, expenses } = generateCase(rand);
        const simple = sum(simplifiedSettlements(expenses, members).map((t) => t.amount));
        const detailed = sum(detailedSettlements(expenses).map((t) => t.amount));
        // Simplification can only reduce the money moved, never increase it.
        expect(simple, `seed ${seed} case ${i}`).toBeLessThanOrEqual(detailed + 0.02);
      }
    }
  });

  it('emits no transfers when everyone paid exactly their own share', () => {
    const rand = mulberry32(555);
    for (let i = 0; i < 50; i++) {
      const { members } = generateCase(rand);
      const expenses = members.map((m) => ({
        amount: Math.round((10 + rand() * 500) * 100) / 100,
        paid_by: m,
        participants: [m],
      }));
      expect(simplifiedSettlements(expenses, members)).toEqual([]);
    }
  });
});
