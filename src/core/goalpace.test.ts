import { describe, expect, it } from 'vitest';
import { mustHitPlan, checksUntil } from './goalpace';
import { buildPlan } from './budget';
import { defaultSettings } from './defaults';
import type { Goal } from './types';

const goal = (id: string, target: number, date: string, extra: Partial<Goal> = {}): Goal =>
  ({ id, name: id, target, targetDate: date, image: null, gem: 'jade', priority: 2, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '', mustHit: true, ...extra }) as Goal;

const visits = [goal('feb', 600, '2027-02-12'), goal('may', 600, '2027-05-14'), goal('aug', 600, '2027-08-13'), goal('move', 2000, '2027-11-26')];
const payday = '2026-12-04';

describe('must be ready by the date', () => {
  it('saves the least per check that gets every goal there on time, soonest first', () => {
    const p = mustHitPlan(visits, () => 0, payday);
    // the tightest stretch decides: here everything ($3,800) has to be in by the move
    const stretches = [600 / checksUntil('2027-02-12', payday), 1200 / checksUntil('2027-05-14', payday), 1800 / checksUntil('2027-08-13', payday), 3800 / checksUntil('2027-11-26', payday)];
    expect(p.perCheck).toBeCloseTo(Math.max(...stretches), 1);
    expect(p.thisCheck.get('feb')).toBeCloseTo(p.perCheck, 2);
    expect(p.thisCheck.get('may') ?? 0).toBe(0);
    for (const l of p.lines) expect(l.ready && l.ready <= l.date).toBe(true);
  });
  it('ignores goals without the toggle, without a date, or already full', () => {
    const p = mustHitPlan([goal('a', 500, '2027-03-01', { mustHit: false }), goal('b', 500, '2027-03-01'), goal('c', 100, '2027-03-01')], (id) => (id === 'c' ? 100 : 0), payday);
    expect(p.lines.map((l) => l.goalId)).toEqual(['b']);
  });
  it('raises this check’s savings to cover them, and says when it can’t', () => {
    const settings = defaultSettings();
    const base = { settings, payday, nextPayday: '2026-12-18', bills: [], essentials: { perPaycheck: 200, totalMonthly: 430 } as any, contributions: [] };
    const plan = buildPlan({ ...base, net: 1450, goals: visits });
    expect(plan.savings).toBeGreaterThanOrEqual(Math.ceil(plan.mustHit!.perCheck));
    expect(plan.allocations.find((a) => a.goalId === 'feb')!.amount).toBeGreaterThanOrEqual(Math.floor(plan.mustHit!.perCheck));
    expect(plan.mustHit!.short).toBe(0);
    const tight = buildPlan({ ...base, net: 1450, goals: [goal('soon', 3000, '2026-12-20')] });
    expect(tight.mustHit!.short).toBeGreaterThan(0);
    expect(tight.personal).toBeGreaterThanOrEqual(0);
    expect(tight.notes.join(' ')).toMatch(/must-be-ready/);
  });
});

describe('pace after each goal is spent', () => {
  it('asks only for what the later goals still need, so each finishes near its own date', () => {
    const goals = [goal('t1', 1000, '2027-02-11'), goal('t2', 1000, '2027-05-13'), goal('t3', 1000, '2027-08-19'), goal('mv', 1000, '2027-11-27'), goal('ring', 2100, '2028-12-15')];
    const p = mustHitPlan(goals, () => 0, '2026-12-04');
    for (const l of p.lines) {
      expect(l.ready! <= l.date).toBe(true);
      // not months early: ready within a month of the date
      expect((Date.parse(l.date) - Date.parse(l.ready!)) / 86_400_000).toBeLessThan(31);
    }
    // the ring, due much later, gets a smaller amount each check than the first trip
    expect(p.lines.find((l) => l.goalId === 'ring')!.perCheck).toBeLessThan(p.lines[0].perCheck);
  });
});
