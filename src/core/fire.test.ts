import { describe, expect, it } from 'vitest';
import { fiNumber, firePlan, monthsToTarget, realReturn, yearsToFiFromSavingsRate } from './fire';

describe('FIRE math', () => {
  it('uses 25x spending at a 4% withdrawal rate', () => {
    expect(fiNumber(40000, 4)).toBe(1_000_000);
  });
  it('matches the classic savings-rate table', () => {
    // with 5% real returns and 4% withdrawals: ~66 years at 5%, ~37 at 20%, ~17 at 50%
    expect(yearsToFiFromSavingsRate(5)).toBeGreaterThan(60);
    expect(yearsToFiFromSavingsRate(20)).toBeCloseTo(37, -1);
    expect(yearsToFiFromSavingsRate(50)).toBeGreaterThan(15.5);
    expect(yearsToFiFromSavingsRate(50)).toBeLessThan(17.5);
    expect(yearsToFiFromSavingsRate(0)).toBeNull();
  });
  it('projects a plan in today’s dollars', () => {
    const p = firePlan({ age: 28, retireAge: 60, invested: 5000, monthlyInvest: 600, annualSpending: 36000, returnPct: 7, inflationPct: 3, withdrawalPct: 4 }, 24000);
    expect(p.fi).toBe(900000);
    expect(p.leanFi).toBe(600000);
    expect(realReturn({ returnPct: 7, inflationPct: 3 })).toBeCloseTo(0.0388, 3);
    expect(p.fiAge).toBeGreaterThan(50);
    expect(p.coastFi).toBeLessThan(p.fi);
    expect(p.projection[0]).toEqual({ age: 28, balance: 5000 });
    expect(monthsToTarget(100, 0, 0.05, 50)).toBe(0);
  });
});
