import { describe, expect, it } from 'vitest';
import { emergencyGoalUpdate, emergencyLevels, emergencyStatus } from './emergency';
import { allocateSavings } from './budget';
import type { Contribution, Goal } from './types';

const goal = (p: Partial<Goal> = {}): Goal => ({ id: 'bed', name: 'Bedrock Fund', target: 3000, targetDate: null, image: null, gem: 'obsidian', priority: 3, isEmergency: true, createdAt: 0, completedAt: null, archived: false, note: '', ...p });

describe('emergency fund steps', () => {
  it('starter month, then 3 months (and 6 if you aim for 6)', () => {
    expect(emergencyLevels(1810, 3).map((l) => [l.name, l.amount])).toEqual([
      ['Starter Emergency Fund', 1850],
      ['Full Emergency Fund', 5450],
    ]);
    expect(emergencyLevels(1810, 6).map((l) => l.months)).toEqual([1, 3, 6]);
  });
  it('raises the goal when the starter month is reached, and finishes at the full fund', () => {
    const g = goal({ target: 3000 });
    const building = emergencyStatus(g, 900, 1810, 3)!;
    expect(building.step).toBe(0);
    expect(emergencyGoalUpdate(g, building)).toEqual({ target: 1850 });
    const starterDone = emergencyStatus(g, 1860, 1810, 3)!;
    expect(starterDone.step).toBe(1);
    expect(emergencyGoalUpdate({ ...g, target: 1850 }, starterDone)).toEqual({ target: 5450 });
    const full = emergencyStatus(g, 5450, 1810, 3)!;
    expect(full.full).toBe(true);
    expect(emergencyGoalUpdate({ ...g, target: 5450 }, full)?.completedAt).toBeGreaterThan(0);
    // dipped into it: reopened so it gets built back first
    const dipped = emergencyStatus(g, 4000, 1810, 3)!;
    expect(emergencyGoalUpdate({ ...g, target: 5450, completedAt: 1 }, dipped)).toEqual({ completedAt: null });
    // small changes in expenses don't move the goal; turned off, it never moves
    expect(emergencyGoalUpdate({ ...g, target: 5450 }, emergencyStatus(g, 3000, 1820, 3)!)).toBeNull();
    expect(emergencyGoalUpdate({ ...g, autoTarget: false }, building)).toBeNull();
  });
  it('past the starter month it gets a steady share and the rest goes to other goals', () => {
    const car: Goal = { ...goal(), id: 'car', name: 'Car', isEmergency: false, target: 5000, priority: 2 };
    const contribs: Contribution[] = [{ id: 'c', goalId: 'bed', amount: 2000, date: '2026-11-01', note: '', paycheckId: null, kind: 'deposit' }];
    const a = allocateSavings(300, [goal({ target: 5450 }), car], contribs, 1810, '2026-11-20');
    expect(a.find((x) => x.goalId === 'bed')?.amount).toBe(105);
    expect(a.find((x) => x.goalId === 'car')?.amount).toBe(195);
    // once full (completed), everything goes to the other goals
    const done = allocateSavings(300, [goal({ target: 5450, completedAt: 1 }), car], contribs, 1810, '2026-11-20');
    expect(done).toEqual([{ goalId: 'car', amount: 300, reason: expect.any(String) }]);
  });
});

describe('payday steps add up to the paycheck', async () => {
  const { buildPlan, estimateEssentials } = await import('./budget');
  const { paydayMoves } = await import('./moves');
  const { defaultSettings } = await import('./defaults');
  it('save + bills + keep = take-home, in whole dollars', () => {
    const s = defaultSettings();
    s.budget.billsMode = 'due_dates';
    const essentials = estimateEssentials(s, [], null, '2026-11-19');
    for (const [net, topUp] of [[1351.37, 890], [1339.02, 0], [987.55, 455]] as const) {
      const plan = buildPlan({ settings: s, net, payday: '2026-11-20', nextPayday: '2026-12-04', bills: [], essentials, goals: [goal({ target: 5000 })], contributions: [], billsTopUp: topUp });
      const period = { index: 0, start: '2026-11-01', end: '2026-11-14', payday: '2026-11-20' } as never;
      const moves = paydayMoves({ period, plan, goals: [goal()], savingsName: 'Marcus', states: new Map(), bonusMonth: false, billsAccountName: 'Bills Account', billsThrough: '2026-12-04' });
      const total = moves.reduce((t, m) => t + (m.key === 'spend' ? Math.round(m.amount) : m.amount), 0);
      expect(Math.abs(total - net)).toBeLessThan(1);
      const keep = moves.find((m) => m.key === 'spend')!;
      const [a, b] = [...keep.detail.matchAll(/\$([\d,]+)/g)].slice(0, 2).map((x) => Number(x[1].replace(',', '')));
      if (plan.personal > 0) expect(a + b).toBe(Math.round(keep.amount));
    }
  });
});
