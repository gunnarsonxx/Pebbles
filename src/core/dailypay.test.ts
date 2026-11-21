import { describe, expect, it } from 'vitest';
import { dailyPayAdvances, minimumAdvance } from './dailypay';
import { paydayMoves } from './moves';
import type { Transaction } from './types';

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  accountId: 'spend',
  date: '2026-11-24',
  description: '',
  merchant: '',
  amount: 0,
  category: 'income',
  importId: null,
  excluded: false,
  note: '',
  ...p,
});

describe('DailyPay', () => {
  it('counts pay taken early since the last payday, and its fees', () => {
    const lines = [
      tx({ description: 'DAILYPAY INSTANT TRANSFER', amount: 80 }),
      tx({ description: 'DAILY PAY FEE', amount: -3.49 }),
      tx({ description: 'DAILYPAY', amount: 50, date: '2026-11-15' }),
      tx({ description: 'KING SOOPERS', amount: -40 }),
    ];
    expect(dailyPayAdvances(lines, '2026-11-20', '2026-11-30')).toMatchObject({ taken: 80, fees: 3.49 });
  });
  it('only ever suggests the minimum, in whole dollars', () => {
    expect(minimumAdvance(37.12)).toBe(38);
    expect(minimumAdvance(0)).toBe(0);
  });
});

describe('leftover money', () => {
  it('becomes a payday step to savings', () => {
    const plan = { savings: 0, allocations: [], bills: 0, billsDue: [], essentials: 300, personal: 200, personalPerDay: 14 } as never;
    const moves = paydayMoves({
      period: { start: '2026-11-07', payday: '2026-11-20' } as never,
      plan,
      goals: [],
      savingsName: 'Marcus',
      states: new Map(),
      bonusMonth: false,
      sweep: { amount: 45, from: 'Spending Account' },
    });
    expect(moves[0]).toMatchObject({ key: 'sweep', title: 'Move $45 Left Over in Spending Account to Marcus', checkable: true });
  });
});
