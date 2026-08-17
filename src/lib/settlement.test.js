import { describe, expect, it } from 'vitest';
import {
  computeBalances,
  detailedSettlements,
  sharesFor,
  simplifiedSettlements,
} from './settlement.js';

const A = 'user-a';
const B = 'user-b';
const C = 'user-c';

/** Sum of one expense's shares — should always equal the expense amount. */
const total = (shares) => Object.values(shares).reduce((s, v) => s + v, 0);

describe('sharesFor', () => {
  it('splits equally when no explicit shares are given', () => {
    const shares = sharesFor({ amount: 90, paid_by: A, participants: [A, B, C] });
    expect(shares).toEqual({ [A]: 30, [B]: 30, [C]: 30 });
  });

  it('honours explicit shares that already cover the total', () => {
    const shares = sharesFor({
      amount: 100,
      paid_by: A,
      participants: [A, B],
      shares: { [A]: 70, [B]: 30 },
    });
    expect(shares).toEqual({ [A]: 70, [B]: 30 });
  });

  // The regression this suite was written for. Assigning part of a bill to one
  // person used to scale their share up to the whole amount.
  it('does not inflate a partial share to the full amount', () => {
    const shares = sharesFor({
      amount: 100,
      paid_by: A,
      participants: [A, B, C],
      shares: { [B]: 30 },
    });
    expect(shares[B]).toBe(30);
  });

  it('gives the unassigned remainder to participants without an explicit share', () => {
    const shares = sharesFor({
      amount: 100,
      paid_by: A,
      participants: [A, B, C],
      shares: { [B]: 30 },
    });
    // 70 left over, split between A and C.
    expect(shares).toEqual({ [A]: 35, [B]: 30, [C]: 35 });
    expect(total(shares)).toBeCloseTo(100, 10);
  });

  it('lets the payer absorb the remainder when every other participant is assigned', () => {
    const shares = sharesFor({
      amount: 100,
      paid_by: A,
      participants: [A, B],
      shares: { [B]: 30 },
    });
    expect(shares).toEqual({ [A]: 70, [B]: 30 });
    expect(total(shares)).toBeCloseTo(100, 10);
  });

  // Everyone already has a share and the total no longer matches — the stale
  // amount case the original scaling guard was written for. Ratios are kept.
  it('scales proportionally when all participants are assigned but the total drifted', () => {
    const shares = sharesFor({
      amount: 100,
      paid_by: A,
      participants: [A, B],
      shares: { [A]: 30, [B]: 30 },
    });
    expect(shares[A]).toBeCloseTo(50, 10);
    expect(shares[B]).toBeCloseTo(50, 10);
    expect(total(shares)).toBeCloseTo(100, 10);
  });

  it('scales down when shares over-sum the total', () => {
    const shares = sharesFor({
      amount: 100,
      paid_by: A,
      participants: [A, B],
      shares: { [A]: 90, [B]: 60 },
    });
    // Never charge the group more in total than was actually spent.
    expect(total(shares)).toBeCloseTo(100, 10);
    expect(shares[A]).toBeCloseTo(60, 10);
    expect(shares[B]).toBeCloseTo(40, 10);
  });

  it('ignores zero and negative share entries', () => {
    const shares = sharesFor({
      amount: 60,
      paid_by: A,
      participants: [A, B, C],
      shares: { [A]: 0, [B]: -10, [C]: 20 },
    });
    // Only C is explicitly assigned; A and B share the remaining 40.
    expect(shares[C]).toBe(20);
    expect(total(shares)).toBeCloseTo(60, 10);
  });

  it('returns nothing for a zero amount or an empty group', () => {
    expect(sharesFor({ amount: 0, participants: [A, B] })).toEqual({});
    expect(sharesFor({ amount: 100, participants: [] })).toEqual({});
    expect(sharesFor(null)).toEqual({});
  });

  it('handles a single participant paying for themselves', () => {
    expect(sharesFor({ amount: 42, paid_by: A, participants: [A] })).toEqual({ [A]: 42 });
  });
});

describe('computeBalances', () => {
  it('nets a partial split without inventing debt', () => {
    const balances = computeBalances(
      [{ amount: 100, paid_by: A, participants: [A, B, C], shares: { [B]: 30 } }],
      [A, B, C]
    );
    expect(balances[B].owed).toBe(30);
    expect(balances[A].paid).toBe(100);
    expect(balances[A].net).toBe(65); // paid 100, owes 35
  });

  it('always nets the group to zero', () => {
    const expenses = [
      { amount: 100, paid_by: A, participants: [A, B, C], shares: { [B]: 30 } },
      { amount: 60, paid_by: B, participants: [A, B, C] },
      { amount: 45, paid_by: C, participants: [B, C] },
    ];
    const balances = computeBalances(expenses, [A, B, C]);
    const sum = Object.values(balances).reduce((s, b) => s + b.net, 0);
    expect(sum).toBeCloseTo(0, 8);
  });
});

describe('simplifiedSettlements', () => {
  it('charges a partial share only what was assigned', () => {
    const transfers = simplifiedSettlements(
      [{ amount: 100, paid_by: A, participants: [A, B, C], shares: { [B]: 30 } }],
      [A, B, C]
    );
    const fromB = transfers.find((t) => t.from === B);
    expect(fromB.amount).toBe(30);
    expect(fromB.to).toBe(A);
  });

  it('collapses a debt cycle into one transfer', () => {
    // A owes B 1000, B owes C 2000, C owes A 1000 → B pays C 1000.
    const expenses = [
      { amount: 2000, paid_by: B, participants: [A, B], shares: { [A]: 1000, [B]: 1000 } },
      { amount: 4000, paid_by: C, participants: [B, C], shares: { [B]: 2000, [C]: 2000 } },
      { amount: 2000, paid_by: A, participants: [A, C], shares: { [A]: 1000, [C]: 1000 } },
    ];
    const transfers = simplifiedSettlements(expenses, [A, B, C]);
    expect(transfers).toEqual([{ from: B, to: C, amount: 1000 }]);
  });

  it('settles every debtor exactly', () => {
    const expenses = [
      { amount: 300, paid_by: A, participants: [A, B, C] },
      { amount: 150, paid_by: B, participants: [A, B, C] },
    ];
    const transfers = simplifiedSettlements(expenses, [A, B, C]);
    const balances = computeBalances(expenses, [A, B, C]);
    for (const [id, b] of Object.entries(balances)) {
      const out = transfers.filter((t) => t.from === id).reduce((s, t) => s + t.amount, 0);
      const inc = transfers.filter((t) => t.to === id).reduce((s, t) => s + t.amount, 0);
      expect(inc - out).toBeCloseTo(b.net, 2);
    }
  });

  it('produces no transfers when everyone paid their own way', () => {
    const expenses = [
      { amount: 50, paid_by: A, participants: [A] },
      { amount: 50, paid_by: B, participants: [B] },
    ];
    expect(simplifiedSettlements(expenses, [A, B])).toEqual([]);
  });
});

describe('detailedSettlements', () => {
  it('offsets mutual debts instead of showing both directions', () => {
    const expenses = [
      { amount: 500, paid_by: A, participants: [B], shares: { [B]: 500 } },
      { amount: 200, paid_by: B, participants: [A], shares: { [A]: 200 } },
    ];
    expect(detailedSettlements(expenses)).toEqual([{ from: B, to: A, amount: 300 }]);
  });

  it('never bills the payer for their own share', () => {
    const transfers = detailedSettlements([
      { amount: 90, paid_by: A, participants: [A, B, C] },
    ]);
    expect(transfers.every((t) => t.from !== A)).toBe(true);
    expect(transfers).toHaveLength(2);
  });
});
