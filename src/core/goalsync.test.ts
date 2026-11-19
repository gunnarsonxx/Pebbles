import { describe, expect, it } from 'vitest';
import { setGoalSplit, splitByWeights, syncGoalsWithAccount, type GoalSyncInput } from './savingsAccount';
import type { Account, Contribution, Goal, Transaction } from './types';

const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, name: id, target: 3000, targetDate: null, image: null, gem: 'jade', priority: 2, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '', ...extra });
const marcus: Account = { id: 'm', name: 'Marcus', type: 'savings', balance: 1000, balanceDate: '2026-11-19', source: 'plaid' };
const tx = (id: string, date: string, amount: number, description = 'TRANSFER FROM CHECKING'): Transaction => ({ id, accountId: 'm', date, description, merchant: '', amount, category: 'savings', importId: null, excluded: true, note: '' });

function apply(contribs: Contribution[], r: { put: Contribution[]; remove: string[] }): Contribution[] {
  const map = new Map(contribs.map((c) => [c.id, c]));
  r.remove.forEach((id) => map.delete(id));
  r.put.forEach((c) => map.set(c.id, c));
  return [...map.values()];
}
const bal = (cs: Contribution[], g: string) => Math.round(cs.filter((c) => c.goalId === g).reduce((s, c) => s + c.amount, 0) * 100) / 100;

describe('goals follow the savings account', () => {
  const goals = [goal('ring'), goal('em', { isEmergency: true })];
  const base: GoalSyncInput = {
    account: marcus,
    txns: [],
    goals,
    contributions: [],
    since: '2026-11-01',
    planWeights: [
      { goalId: 'ring', w: 53 },
      { goalId: 'em', w: 212 },
    ],
    paycheckFor: () => null,
  };

  it('splits to the cent', () => {
    expect(splitByWeights(265, [{ goalId: 'a', w: 53 }, { goalId: 'b', w: 212 }])).toEqual([
      { goalId: 'a', amount: 53 },
      { goalId: 'b', amount: 212 },
    ]);
    expect(splitByWeights(100, [{ goalId: 'a', w: 1 }, { goalId: 'b', w: 1 }, { goalId: 'c', w: 1 }]).reduce((s, x) => s + x.amount, 0)).toBe(100);
  });

  it('spreads money already in Marcus so goals equal the balance', () => {
    const cs = apply([], syncGoalsWithAccount(base));
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(1000);
    expect(bal(cs, 'ring')).toBe(200);
  });

  it('splits a $265 transfer $53 / $212 by that paycheck’s plan', () => {
    let cs = apply([], syncGoalsWithAccount(base));
    const acct = { ...marcus, balance: 1265 };
    cs = apply(cs, syncGoalsWithAccount({ ...base, account: acct, contributions: cs, txns: [tx('t1', '2026-11-20', 265)], paycheckFor: () => ({ periodStart: 'p1', weights: [{ goalId: 'ring', w: 53 }, { goalId: 'em', w: 212 }] }) }));
    expect(cs.filter((c) => c.id.startsWith('dep|t1|')).map((c) => c.amount).sort((a, b) => a - b)).toEqual([53, 212]);
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(1265);
    // running again changes nothing
    const again = syncGoalsWithAccount({ ...base, account: acct, contributions: cs, txns: [tx('t1', '2026-11-20', 265)] });
    expect(again.put).toEqual([]);
    expect(again.remove).toEqual([]);
  });

  it('replaces a manual "moved to savings" with the real deposit', () => {
    const manual: Contribution[] = [
      { id: 'pc|p1|ring', goalId: 'ring', amount: 50, date: '2026-11-20', note: '', paycheckId: 'p1', kind: 'deposit' },
      { id: 'pc|p1|em', goalId: 'em', amount: 200, date: '2026-11-20', note: '', paycheckId: 'p1', kind: 'deposit' },
    ];
    const r = syncGoalsWithAccount({ ...base, account: { ...marcus, balance: 265 }, contributions: manual, txns: [tx('t1', '2026-11-20', 265)], paycheckFor: () => ({ periodStart: 'p1', weights: [] }) });
    const cs = apply(manual, r);
    expect(r.remove.sort()).toEqual(['pc|p1|em', 'pc|p1|ring']);
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(265);
    expect(bal(cs, 'ring')).toBe(53);
  });

  it('keeps a split you set by hand', () => {
    let cs = apply([], syncGoalsWithAccount(base));
    cs = apply(cs, { put: setGoalSplit(marcus, new Map([['ring', 900], ['em', 100]]), cs, '2026-11-19'), remove: [] });
    const r = syncGoalsWithAccount({ ...base, contributions: cs });
    expect(r.put).toEqual([]);
    expect(bal(apply(cs, r), 'ring')).toBe(900);
  });

  it('a withdrawal for a finished goal comes out of that goal', () => {
    const g2 = [goal('ring', { completedAt: 1, target: 500 }), goal('em', { isEmergency: true })];
    let cs = apply([], syncGoalsWithAccount({ ...base, goals: g2, account: { ...marcus, balance: 1000 } }));
    cs = apply(cs, { put: setGoalSplit(marcus, new Map([['ring', 500], ['em', 500]]), cs, '2026-11-19'), remove: [] });
    cs = apply(cs, syncGoalsWithAccount({ ...base, goals: g2, contributions: cs, account: { ...marcus, balance: 510 }, txns: [tx('w1', '2026-11-21', -490, 'TRANSFER TO CHECKING')] }));
    expect(bal(cs, 'ring')).toBeLessThan(15);
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(510);
  });
});
