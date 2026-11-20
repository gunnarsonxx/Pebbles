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
