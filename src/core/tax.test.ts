import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaults';
import { computeGross, periodByIndex, upcomingPayPeriod, newWorkDay } from './pay';
import { calibrationFrom, estimatePaycheck } from './paycheck';
import { bracketTax, computeWithholding, federalWithholding, overtimeDeductionEstimate } from './tax';
import { BUNDLED_RULES, rulesForYear } from './taxrules';
import type { Settings, WorkDay } from './types';

const r2026 = rulesForYear(BUNDLED_RULES, 2026).rules;
const r2027 = rulesForYear(BUNDLED_RULES, 2027).rules;

function settings(over: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...over };
}

describe('federal withholding (Pub 15-T 2026)', () => {
  it('matches the IRS annual table for $75,000 single, biweekly', () => {
    // $75,000 / 26 per check; 2026 single: (75,000 - 16,100) -> $7,670 / yr
    const res = federalWithholding(75000 / 26, settings(), r2026);
    expect(res.annualTaxable).toBeCloseTo(58900, 0);
    expect(res.amount).toBeCloseTo(7670 / 26, 2);
  });

  it('applies W-4 step 3 credits and step 4(c) extra withholding', () => {
    const s = settings();
    s.w4 = { ...s.w4, childrenUnder17: 1, extraWithholding: 10 };
    const res = federalWithholding(75000 / 26, s, r2026);
    expect(res.amount).toBeCloseTo((7670 - 2200) / 26 + 10, 2);
  });

  it('halves the table for the step 2 checkbox', () => {
    const s = settings();
    s.w4 = { ...s.w4, step2MultipleJobs: true };
    // taxable = 75,000 - 8,050 = 66,950; brackets halved: 6,200 / 25,200 / 52,850 ...
    const expected = bracketTax(66950, r2026.federal.brackets.single, 0.5);
    expect(federalWithholding(75000 / 26, s, r2026).amount).toBeCloseTo(expected / 26, 2);
    expect(expected).toBeCloseTo(620 + 0.12 * 19000 + 0.22 * 27650 + 0.24 * (66950 - 52850), 2);
  });

  it('is zero below the standard deduction', () => {
    expect(federalWithholding(500, settings(), r2026).amount).toBe(0);
  });
});

describe('full paycheck withholding, Colorado Springs', () => {
  it('computes FICA, Colorado 4.4% and FAMLI 0.44% on a $1,760 check', () => {
    const res = computeWithholding(1760, settings(), r2026);
    const by = Object.fromEntries(res.taxes.map((t) => [t.key, t.amount]));
    expect(by.social_security).toBeCloseTo(109.12, 2);
    expect(by.medicare).toBeCloseTo(25.52, 2);
    // CO: (1760*26 - 5500) * 4.4% / 26
    expect(by.state).toBeCloseTo(((1760 * 26 - 5500) * 0.044) / 26, 2);
    expect(by.famli).toBeCloseTo(7.74, 2);
    expect(by.local).toBeUndefined();
    // federal: (45,760 - 16,100) = 29,660 -> 1,240 + 0.12*17,260 = 3,311.20 / 26
    expect(by.federal).toBeCloseTo(127.35, 2);
    expect(res.net).toBeCloseTo(1760 - res.totalTaxes, 2);
  });

  it('handles 401(k) (income-tax only) and section 125 (also FICA) deductions', () => {
    const s = settings({
      deductions: [
        { id: 'k', name: '401(k)', kind: 'traditional_401k', mode: 'percent', amount: 5 },
        { id: 'h', name: 'Health', kind: 'section125', mode: 'fixed', amount: 50 },
        { id: 'u', name: 'Union dues', kind: 'post_tax', mode: 'fixed', amount: 20 },
      ],
    });
    const res = computeWithholding(2000, s, r2026);
    expect(res.federalTaxable).toBeCloseTo(2000 - 100 - 50, 2);
    expect(res.ficaWages).toBeCloseTo(2000 - 50, 2);
    expect(res.totalDeductions).toBeCloseTo(170, 2);
    expect(res.net).toBeCloseTo(2000 - res.totalTaxes - 170, 2);
  });

  it('uses Colorado graduated brackets in 2027 (Amendment 87)', () => {
    const res = computeWithholding(1760, settings(), r2027);
    const state = res.taxes.find((t) => t.key === 'state')!.amount;
    const taxable = 1760 * 26 - 5500; // 40,260
    const expected = (25000 * 0.037 + (taxable - 25000) * 0.042) / 26;
    expect(state).toBeCloseTo(expected, 2);
    const famli = res.taxes.find((t) => t.key === 'famli')!.amount;
    expect(famli).toBeCloseTo(1760 * 0.0043, 2);
  });

  it('applies Denver OPT when selected', () => {
    const s = settings();
    s.stateTax = { ...s.stateTax, localTax: 'Denver' };
    const res = computeWithholding(1760, s, r2026);
    expect(res.taxes.find((t) => t.key === 'local')!.amount).toBeCloseTo((5.75 * 12) / 26, 2);
  });

  it('no state tax in Texas', () => {
    const s = settings();
    s.stateTax = { ...s.stateTax, state: 'TX' };
    const res = computeWithholding(1760, s, r2026);
    expect(res.taxes.find((t) => t.key === 'state')).toBeUndefined();
    expect(res.taxes.find((t) => t.key === 'famli')).toBeUndefined();
  });

  it('caps social security at the wage base', () => {
    const res = computeWithholding(5000, settings(), r2026, { ficaWages: 182000 });
    expect(res.taxes.find((t) => t.key === 'social_security')!.amount).toBeCloseTo(2500 * 0.062, 2);
  });
});

describe('pay periods and gross pay', () => {
  const s = settings();
  s.pay = { ...s.pay, periodAnchor: '2026-11-08', paydayOffset: 6, baseRate: 22, holidays: { ids: [], observed: false, rule: 'calendar', confirmed: true } };

  it('finds the upcoming payday', () => {
    const p = upcomingPayPeriod(s.pay, '2026-11-19');
    // period Oct 25 - Nov 7 pays Nov 13 (past); Nov 8 - 21 pays Nov 27
    expect(p.start).toBe('2026-11-08');
    expect(p.payday).toBe('2026-11-27');
    const p2 = upcomingPayPeriod(s.pay, '2026-11-25');
    expect(p2.payday).toBe('2026-11-27');
    const p3 = upcomingPayPeriod(s.pay, '2026-11-28');
    expect(p3.payday).toBe('2026-12-11');
  });

  it('defaults to 80 hours at base', () => {
    const g = computeGross(periodByIndex(s.pay, 0), s.pay, [], {});
    expect(g.scheduledHours).toBe(80);
    expect(g.basePay).toBe(1760);
    expect(g.gross).toBe(1760);
    expect(g.adjustments).toHaveLength(0);
  });

  it('adds a different-rate day and subtracts a missed day', () => {
    const lead = { id: 'lead', name: 'Lead', rate: 25, gem: 'amethyst' as const };
    const days: Record<string, WorkDay> = {
      '2026-11-10': { ...newWorkDay('2026-11-10', 'worked', s.pay), segments: [{ hours: 8, rateId: 'lead', rate: null }] },
      '2026-11-13': newWorkDay('2026-11-13', 'missed', s.pay),
    };
    const g = computeGross(periodByIndex(s.pay, 0), s.pay, [lead], days);
    expect(g.adjustments.map((a) => a.amount)).toEqual([24, -176]);
    expect(g.gross).toBe(1760 + 24 - 176);
  });

  it('computes weighted overtime for an extra Saturday', () => {
    const lead = { id: 'lead', name: 'Lead', rate: 25, gem: 'amethyst' as const };
    const days: Record<string, WorkDay> = {
      '2026-11-14': { ...newWorkDay('2026-11-14', 'worked', s.pay), segments: [{ hours: 8, rateId: 'lead', rate: null }] },
    };
    const g = computeGross(periodByIndex(s.pay, 0), s.pay, [lead], days);
    // week 1: 40h @22 + 8h @25 = 1080 straight; regular rate = 22.5; OT premium = 8 * 0.5 * 22.5 = 90
    expect(g.weeks[0].otHours).toBe(8);
    expect(g.weeks[0].regularRate).toBe(22.5);
    expect(g.otPremium).toBe(90);
    expect(g.gross).toBe(1760 + 200 + 90);
  });

  it('applies Colorado daily overtime over 12 hours', () => {
    const days: Record<string, WorkDay> = {
      '2026-11-09': { ...newWorkDay('2026-11-09', 'worked', s.pay), segments: [{ hours: 14, rateId: 'base', rate: null }] },
      '2026-11-10': newWorkDay('2026-11-10', 'missed', s.pay),
    };
    const g = computeGross(periodByIndex(s.pay, 0), s.pay, [], days);
    // week hours = 38, daily OT = 2 -> premium 2 * 11 = 22
    expect(g.weeks[0].otHours).toBe(2);
    expect(g.otPremium).toBe(22);
  });

  it('treats PTO as paid at base without counting toward overtime', () => {
    const days: Record<string, WorkDay> = { '2026-11-12': newWorkDay('2026-11-12', 'pto', s.pay) };
    const g = computeGross(periodByIndex(s.pay, 0), s.pay, [], days);
    expect(g.gross).toBe(1760);
    expect(g.leaveHours).toBe(8);
    expect(g.workedHours).toBe(72);
  });

  it('produces a full estimate with taxes for the right year', () => {
    const e = estimatePaycheck(periodByIndex(s.pay, 0), s, [], {}, BUNDLED_RULES);
    expect(e.taxYear).toBe(2026);
    expect(e.net).toBeGreaterThan(1300);
    expect(e.net).toBeLessThan(1500);
    const jan = estimatePaycheck(periodByIndex(s.pay, 4), s, [], {}, BUNDLED_RULES); // paid Jan 2027
    expect(jan.taxYear).toBe(2027);
    expect(jan.rulesExact).toBe(true);
  });
});

describe('no tax on overtime', () => {
  it('estimates the deduction and tax saved', () => {
    const r = overtimeDeductionEstimate(3000, 50000, settings(), r2026);
    expect(r.deduction).toBe(3000);
    expect(r.taxSaved).toBeCloseTo(360, 2);
  });
});

describe('learning from real paychecks', () => {
  const rec = (payday: string, raw: number, shown: number, actual: number) => ({
    id: payday, periodStart: payday, payday, estimatedNet: shown, estimatedNetRaw: raw, estimatedGross: 1760,
    actualNet: actual, actualGross: null, received: true, savingsOverride: null, split: null, goalAllocations: [], note: '',
  });
  it('needs two consistent paychecks', () => {
    expect(calibrationFrom([rec('2026-10-02', 1400, 1400, 1380)])).toBe(0);
    expect(calibrationFrom([rec('2026-10-02', 1400, 1400, 1380), rec('2026-10-16', 1400, 1400, 1381)])).toBeCloseTo(-19.5, 2);
  });
  it('stays stable once the correction is applied', () => {
    // later estimates already show the correction, but the raw estimate is still what's compared
    const list = [rec('2026-10-02', 1400, 1400, 1380), rec('2026-10-16', 1400, 1400, 1380), rec('2026-10-30', 1400, 1380, 1380), rec('2026-11-13', 1400, 1380, 1380)];
    expect(calibrationFrom(list)).toBe(-20);
  });
  it('ignores one-off differences', () => {
    expect(calibrationFrom([rec('2026-10-02', 1400, 1400, 1400), rec('2026-10-16', 1400, 1400, 1250)])).toBe(0);
  });
});

describe('overnight shifts (9:30p–6a, 30 min break after midnight)', () => {
  const s = defaultSettings();
  // shifts start Sat, Sun, Mon, Tue, Wed nights; pay periods run Sun–Sat
  s.pay = { ...s.pay, periodAnchor: '2026-11-08', paydayOffset: 6, baseRate: 20, workDays: [6, 0, 1, 2, 3], shiftStart: '21:30', shiftEnd: '06:00', breakMinutes: 30, breakAfterMidnight: true, holidays: { ids: [], observed: false, rule: 'calendar', confirmed: true } };
  const period = periodByIndex(s.pay, 0); // Sun Nov 8 – Sat Nov 21

  it('splits each shift 2.5 h before midnight and 5.5 h after', async () => {
    const { shiftSplit, shiftHours } = await import('./pay');
    expect(shiftSplit(s.pay)).toEqual({ overnight: true, pre: 2.5, post: 5.5 });
    expect(shiftHours(s.pay)).toBe(8);
  });

  it('counts hours on the day they are worked, across the pay period edges', () => {
    const g = computeGross(period, s.pay, [], {});
    // 10 shifts start inside the period, Saturday Nov 7's morning (5.5 h) comes in,
    // Saturday Nov 21's morning (5.5 h) goes to the next check: still 80 h
    expect(g.scheduledHours).toBe(80);
    const sat = g.days.find((d) => d.date === '2026-11-14') as unknown as { countedHours: number };
    const sun = g.days.find((d) => d.date === '2026-11-15') as unknown as { countedHours: number };
    expect(sat.countedHours).toBe(2.5);
    expect(sun.countedHours).toBe(5.5 + 2.5); // Saturday night's morning + Sunday night's start
  });

  it('calling off a Wednesday shift removes 2.5 h Wednesday and 5.5 h Thursday, not Tuesday night', () => {
    const g = computeGross(period, s.pay, [], { '2026-11-11': newWorkDay('2026-11-11', 'missed', s.pay) });
    expect(g.gross).toBe(1600 - 160);
    const wed = g.days.find((d) => d.date === '2026-11-11') as unknown as { countedHours: number };
    expect(wed.countedHours).toBe(5.5); // Tuesday night's shift still counts on Wednesday
  });

  it('only the part of the last Saturday shift inside the period changes this check', () => {
    const lead = { id: 'lead', name: 'Lead', rate: 24, gem: 'amethyst' as const };
    const g = computeGross(period, s.pay, [lead], { '2026-11-21': { ...newWorkDay('2026-11-21', 'worked', s.pay), segments: [{ hours: 8, rateId: 'lead', rate: null }] } });
    expect(g.adjustments[0].amount).toBeCloseTo(2.5 * 4, 2);
    expect(g.adjustments[0].detail).toContain('part of it on this check');
  });

  it('weekly overtime uses hours by calendar day', () => {
    const extra: Record<string, ReturnType<typeof newWorkDay>> = {
      '2026-11-12': newWorkDay('2026-11-12', 'worked', s.pay), // Thu night extra shift
    };
    const g = computeGross(period, s.pay, [], extra);
    // week 1 (Nov 8–14): 5.5 carry-in + 5 shifts... check OT appears only beyond 40 h
    expect(g.weeks[0].hours).toBeGreaterThan(40);
    expect(g.weeks[0].otHours).toBeCloseTo(g.weeks[0].hours - 40, 2);
  });
});

describe('overnight shift edge cases', () => {
  const s = defaultSettings();
  s.pay = { ...s.pay, periodAnchor: '2026-11-08', paydayOffset: 6, baseRate: 20, workDays: [6, 0, 1, 2, 3], shiftStart: '21:30', shiftEnd: '06:00', breakMinutes: 30, breakAfterMidnight: true, holidays: { ids: [], observed: false, rule: 'calendar', confirmed: true } };
  const p0 = periodByIndex(s.pay, 0);
  const p1 = periodByIndex(s.pay, 1);

  it('calling off the Saturday night shift on the last day takes 2.5 h from this check and 5.5 h from the next', () => {
    const off = { '2026-11-21': newWorkDay('2026-11-21', 'missed', s.pay) };
    expect(computeGross(p0, s.pay, [], off).gross).toBe(1600 - 2.5 * 20);
    expect(computeGross(p1, s.pay, [], off).gross).toBe(1600 - 5.5 * 20);
  });

  it('a shift with its own times (left at 4 a.m.) splits by those times', async () => {
    const { hoursForTimes } = await import('./pay');
    expect(hoursForTimes('21:30', '04:00', s.pay)).toBe(6);
    const day = { ...newWorkDay('2026-11-14', 'worked', s.pay), start: '21:30', end: '04:00', segments: [{ hours: 6, rateId: 'base', rate: null }] };
    const g = computeGross(p0, s.pay, [], { '2026-11-14': day });
    expect(g.gross).toBe(1600 - 2 * 20);
    expect(g.days.find((d) => d.date === '2026-11-15')?.countedHours).toBe(3.5 + 2.5);
  });
});

describe('holidays', () => {
  it('knows the federal dates', async () => {
    const { holidayOn, HOLIDAYS } = await import('./holidays');
    const all = { ids: HOLIDAYS.map((h) => h.id), observed: false };
    expect(holidayOn('2026-11-26', all)?.id).toBe('thanksgiving');
    expect(holidayOn('2026-01-19', all)?.id).toBe('mlk');
    expect(holidayOn('2026-05-25', all)?.id).toBe('memorial');
    expect(holidayOn('2026-04-05', all)?.id).toBe('easter');
    expect(holidayOn('2026-07-03', all)).toBeNull();
    expect(holidayOn('2026-07-03', { ...all, observed: true })?.id).toBe('independence'); // July 4, 2026 is a Saturday
  });

  const s = defaultSettings();
  s.pay = { ...s.pay, periodAnchor: '2026-11-08', paydayOffset: 6, baseRate: 20, workDays: [6, 0, 1, 2, 3], shiftStart: '21:30', shiftEnd: '06:00', breakMinutes: 30, breakAfterMidnight: true, holidayMultiplier: 1.5 };
  const p0 = periodByIndex(s.pay, 0); // includes Veterans Day, Wed Nov 11

  it('pays the hours worked on the holiday date at 1.5×', () => {
    const pay = { ...s.pay, holidays: { ids: ['veterans'], observed: false, rule: 'calendar' as const, confirmed: true } };
    const g = computeGross(p0, pay, [], {});
    const h = g.adjustments.find((a) => a.kind === 'holiday');
    // Tuesday night's 5.5 h after midnight + Wednesday night's 2.5 h before midnight
    expect(h?.amount).toBe(8 * 20 * 0.5);
    expect(g.days.find((d) => d.date === '2026-11-11')?.holiday?.id).toBe('veterans');
  });

  it('or the whole shift that starts on the holiday', () => {
    const pay = { ...s.pay, holidays: { ids: ['veterans'], observed: false, rule: 'shiftStart' as const, confirmed: true } };
    const g = computeGross(p0, pay, [], {});
    expect(g.adjustments.filter((a) => a.kind === 'holiday').reduce((x, a) => x + a.amount, 0)).toBe(8 * 20 * 0.5);
  });

  it('no holiday pay when you are off', () => {
    const pay = { ...s.pay, holidays: { ids: ['veterans'], observed: false, rule: 'calendar' as const, confirmed: true } };
    const off = { '2026-11-10': newWorkDay('2026-11-10', 'missed', pay), '2026-11-11': newWorkDay('2026-11-11', 'missed', pay) };
    expect(computeGross(p0, pay, [], off).adjustments.some((a) => a.kind === 'holiday')).toBe(false);
  });
});

describe('holiday pay is opt-in', () => {
  it('nothing is automatic until you confirm which holidays your job pays', async () => {
    const { normalizeSettings } = await import('./defaults');
    const old = normalizeSettings({ pay: { holidays: { ids: ['veterans', 'thanksgiving'], observed: false, rule: 'calendar' } } } as never);
    expect(old.pay.holidays.ids).toEqual([]);
    const confirmed = normalizeSettings({ pay: { holidays: { ids: ['thanksgiving'], observed: false, rule: 'calendar', confirmed: true } } } as never);
    expect(confirmed.pay.holidays.ids).toEqual(['thanksgiving']);
  });
});
