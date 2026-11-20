import { describe, expect, it } from 'vitest';

describe('Reach It Sooner boost', () => {
  it('adds the boost to savings out of spending money and gives it to that goal first', async () => {
    const { buildPlan } = await import('./budget');
    const { defaultSettings } = await import('./defaults');
    const settings = defaultSettings();
    const goals = [
      { id: 'a', name: 'Car', target: 5000, targetDate: null, image: null, gem: 'jade', priority: 2, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '' },
      { id: 'b', name: 'Trip', target: 2000, targetDate: null, image: null, gem: 'jade', priority: 2, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '' },
    ] as any[];
    const essentials = { perPaycheck: 100, totalMonthly: 200 } as any;
    const args = { settings, net: 1500, payday: '2026-12-04', nextPayday: '2026-12-18', bills: [], essentials, goals, contributions: [] };
    const plain = buildPlan(args);
    const boosted = buildPlan({ ...args, goals: [{ ...goals[0], boost: 50 }, goals[1]] });
    expect(boosted.savings).toBeCloseTo(plain.savings + 50, 2);
    expect(boosted.personal).toBeCloseTo(plain.personal - 50, 2);
    const a0 = plain.allocations.find((x) => x.goalId === 'a')!.amount;
    const a1 = boosted.allocations.find((x) => x.goalId === 'a')!.amount;
    expect(a1).toBeGreaterThanOrEqual(a0 + 50);
  });
});
