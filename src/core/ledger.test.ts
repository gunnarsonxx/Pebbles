import { describe, expect, it } from 'vitest';
import { billsLedger } from './coverage';
import type { Bill } from './types';

const bill = (id: string, amount: number, dueDay: number): Bill => ({
  id,
  name: id,
  amount,
  dueDay,
  dueMonth: null,
  anchorDate: null,
  frequency: 'monthly',
  category: 'utilities',
  autopay: true,
  active: true,
  matchPattern: '',
});

describe('the Bills account, paycheck by paycheck', () => {
  it('replays the example: $705 every check starting from $1.46 on Dec 4', () => {
    const bills = [
      bill('Rent (after roommate share)', 875.95, 1),
      bill('Amazon Prime', 16.22, 2),
      bill('Crunchyroll', 10.8, 9),
      bill('Insurance', 166.83, 13),
      bill('Internet', 106.78, 14),
      bill('Late-December bills', 171.67, 26),
    ];
    const l = billsLedger({ balance: 1.46, bills, txns: [], today: '2026-12-03', paydays: ['2026-12-04', '2026-12-18', '2027-01-01', '2027-01-15'], mode: 'even', perCheck: 705, fixed: true });
    // Dec 4: 1.46 + 705 − 284.41 = 422.05
    expect(l[0]).toMatchObject({ before: 1.46, deposit: 705, paid: 284.41, after: 422.05 });
    // Dec 18: the deposit that's easy to miss: 422.05 + 705 − 171.67 = 955.38
    expect(l[1]).toMatchObject({ before: 422.05, deposit: 705, paid: 171.67, after: 955.38 });
    // Jan 1: 955.38 + 705 − rent 875.95 − 300.63 = 483.80, never below zero
    expect(l[2]).toMatchObject({ before: 955.38, deposit: 705, paid: 1176.58, after: 483.8 });
    expect(l[2].lowest).toBeGreaterThan(0);
  });

  it('works the amount out again each payday, so a growing buffer brings it down', async () => {
    const { steadyBillsPlan } = await import('./coverage');
    const bills = [bill('Rent', 875.95, 1), bill('Prime', 16.22, 2), bill('Crunchyroll', 10.8, 9), bill('Insurance', 166.83, 13), bill('Internet', 106.78, 14), bill('Other', 171.67, 26)];
    const paydays = Array.from({ length: 30 }, (_, k) => new Date(Date.UTC(2026, 11, 4) + k * 14 * 86_400_000).toISOString().slice(0, 10));
    const st = steadyBillsPlan({ balance: 1.46, bills, txns: [], today: '2026-12-03', paydays });
    const l = billsLedger({ balance: 1.46, bills, txns: [], today: '2026-12-03', paydays, mode: 'even', perCheck: st.perCheck });
    expect(l[0].deposit).toBe(st.perCheck);
    for (const c of l) expect(c.lowest).toBeGreaterThanOrEqual(0);
    // later checks never need more than the first, and the buffer doesn't keep piling up
    expect(Math.max(...l.map((c) => c.deposit))).toBeLessThanOrEqual(st.perCheck);
    expect(l[l.length - 1].after).toBeLessThan(l.reduce((t, c) => t + c.deposit, 0) - l.reduce((t, c) => t + c.paid, 0) + 1.46 + 1);
    // the breakdown: the tightest stretch is what sets the amount
    if (st.tight && st.tight.need > st.average) expect(Math.ceil(st.tight.need / 5) * 5).toBe(st.perCheck);
  });
});
