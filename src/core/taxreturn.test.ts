import { describe, expect, it } from 'vitest';
import { estimateReturn } from './taxreturn';
import { BUNDLED_RULES, rulesForYear } from './taxrules';
import type { Paystub } from './types';

const stub = (payDate: string, gross: number, fed: number, fedYtd: number | null, ytdGross: number | null): Paystub => ({
  id: payDate,
  payDate,
  periodStart: null,
  periodEnd: null,
  gross,
  net: gross - fed,
  lines: [{ label: 'Federal', kind: 'federal', current: fed, ytd: fedYtd }],
  hours: [],
  ytdGross,
  createdAt: 0,
});

describe('a rough tax return from this year’s stubs', () => {
  const rules = rulesForYear(BUNDLED_RULES, 2026).rules;
  it('uses the newest stub’s year-to-date totals and ignores last year', () => {
    const stubs = [stub('2025-12-26', 1700, 150, 3900, 44000), stub('2026-11-06', 1700, 140, 3500, 40000), stub('2026-11-20', 1671.5, 130, 3630, 41671.5)];
    const r = estimateReturn({
      year: 2026,
      stubs,
      remaining: [
        { gross: 1700, federal: 140, state: 0, pretax: 0 },
        { gross: 1700, federal: 140, state: 0, pretax: 0 },
      ],
      rules,
      filing: 'single',
      state: 'TX',
      overtimeDeduction: 0,
    })!;
    expect(r.stubs).toBe(2);
    expect(r.gross).toBe(41671.5 + 3400);
    expect(r.federal.withheld).toBe(3630 + 280);
    expect(r.federal.refund).toBeCloseTo(r.federal.withheld - r.federal.owed, 2);
    expect(r.state).toBeNull();
  });
  it('adds the stubs up when they have no year-to-date column', () => {
    const r = estimateReturn({
      year: 2026,
      stubs: [stub('2026-01-09', 1000, 50, null, null), stub('2026-01-23', 1200, 70, null, null)],
      remaining: [],
      rules,
      filing: 'single',
      state: 'CO',
      overtimeDeduction: 0,
    })!;
    expect(r.gross).toBe(2200);
    expect(r.federal.withheld).toBe(120);
    expect(r.state).not.toBeNull();
  });
});
