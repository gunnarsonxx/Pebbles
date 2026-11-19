// Pay periods, the default schedule, and gross pay with overtime.
//
// Gross pay is presented the way you think about it: "base pay" for a normal
// two weeks (e.g. 80 h x base rate), then adjustments for days that differ
// (different rate, missed day, extra day, PTO...) and any overtime premium.
//
// Overtime follows the FLSA "regular rate" method by default: all hours are
// paid at their own rate (straight time) and each overtime hour adds a 0.5x
// premium of the week's weighted-average rate. Colorado also requires overtime
// for hours over 12 in a workday, which is the default daily threshold.
import { addDays, dayOfWeek, diffDays, fmtDay, rangeDays } from './dates';
import { BASE_RATE_ID } from './defaults';
import { round2 } from './money';
import type { DayStatus, ISODate, PayRate, PaySettings, WorkDay, WorkSegment } from './types';

export interface Period {
  index: number;
  start: ISODate;
  end: ISODate;
  payday: ISODate;
}

export function periodByIndex(pay: PaySettings, index: number): Period {
  const start = addDays(pay.periodAnchor, index * 14);
  const end = addDays(start, 13);
  return { index, start, end, payday: addDays(end, pay.paydayOffset) };
}

/** The pay period whose work dates include `date`. */
export function periodContaining(pay: PaySettings, date: ISODate): Period {
  const idx = Math.floor(diffDays(date, pay.periodAnchor) / 14);
  return periodByIndex(pay, idx);
}

/** The next period that has not been paid yet as of `date` (payday >= date). */
export function upcomingPayPeriod(pay: PaySettings, date: ISODate): Period {
  let p = periodContaining(pay, date);
  // walk back while the previous period's payday is still upcoming
  for (let i = 0; i < 4; i++) {
    const prev = periodByIndex(pay, p.index - 1);
    if (prev.payday >= date) p = prev;
    else break;
  }
  while (p.payday < date) p = periodByIndex(pay, p.index + 1);
  return p;
}

export function paydaysBetween(pay: PaySettings, from: ISODate, to: ISODate): Period[] {
  const out: Period[] = [];
  let p = upcomingPayPeriod(pay, from);
  while (p.payday <= to) {
    out.push(p);
    p = periodByIndex(pay, p.index + 1);
  }
  return out;
}

export function allRates(baseRate: number, rates: PayRate[]): PayRate[] {
  const base: PayRate = { id: BASE_RATE_ID, name: 'Base', rate: baseRate, gem: 'quartz', isBase: true };
  return [base, ...rates.filter((r) => r.id !== BASE_RATE_ID)];
}

export interface ResolvedSegment {
  hours: number;
  rate: number;
  rateName: string;
  rateId: string | null;
}

export interface ResolvedDay {
  date: ISODate;
  scheduled: boolean; // part of the normal schedule
  edited: boolean; // has an override
  status: DayStatus | 'off';
  segments: ResolvedSegment[];
  workedHours: number;
  paidLeaveHours: number;
  straightPay: number; // hours x rates (no overtime)
  leavePay: number;
  holidayPremium: number;
  defaultPay: number; // what this day contributes to "base pay"
  note: string;
}

function resolveSegments(segments: WorkSegment[], rates: PayRate[], baseRate: number): ResolvedSegment[] {
  return segments
    .filter((s) => s.hours > 0)
    .map((s) => {
      const preset = s.rateId ? rates.find((r) => r.id === s.rateId) : null;
      const rate = preset ? preset.rate : (s.rate ?? baseRate);
      return { hours: s.hours, rate, rateName: preset ? preset.name : 'Custom', rateId: preset ? preset.id : null };
    });
}

export function resolveDay(
  date: ISODate,
  pay: PaySettings,
  rates: PayRate[],
  override: WorkDay | undefined,
): ResolvedDay {
  const scheduled = pay.workDays.includes(dayOfWeek(date));
  const defaultPay = scheduled ? pay.hoursPerDay * pay.baseRate : 0;
  const base = { date, scheduled, defaultPay, holidayPremium: 0, note: override?.note ?? '' };
  if (!override) {
    if (!scheduled)
      return { ...base, edited: false, status: 'off', segments: [], workedHours: 0, paidLeaveHours: 0, straightPay: 0, leavePay: 0 };
    const segs = [{ hours: pay.hoursPerDay, rate: pay.baseRate, rateName: 'Base', rateId: BASE_RATE_ID }];
    return {
      ...base,
      edited: false,
      status: 'worked',
      segments: segs,
      workedHours: pay.hoursPerDay,
      paidLeaveHours: 0,
      straightPay: pay.hoursPerDay * pay.baseRate,
      leavePay: 0,
    };
  }
  if (override.status === 'worked') {
    const segs = resolveSegments(override.segments, rates, pay.baseRate);
    const hours = segs.reduce((s, x) => s + x.hours, 0);
    const straight = segs.reduce((s, x) => s + x.hours * x.rate, 0);
    const holidayPremium = override.workedHoliday ? straight * Math.max(0, pay.holidayMultiplier - 1) : 0;
    return {
      ...base,
      edited: true,
      status: hours > 0 ? 'worked' : 'off',
      segments: segs,
      workedHours: hours,
      paidLeaveHours: 0,
      straightPay: straight,
      leavePay: 0,
      holidayPremium,
    };
  }
  if (override.status === 'missed') {
    return { ...base, edited: true, status: 'missed', segments: [], workedHours: 0, paidLeaveHours: 0, straightPay: 0, leavePay: 0 };
  }
  const paid = override.paidHours ?? pay.hoursPerDay;
  return {
    ...base,
    edited: true,
    status: override.status,
    segments: [],
    workedHours: 0,
    paidLeaveHours: paid,
    straightPay: 0,
    leavePay: paid * pay.baseRate,
  };
}

export interface Adjustment {
  date: ISODate | null;
  label: string;
  detail: string;
  amount: number;
  kind: 'rate' | 'missed' | 'extra' | 'short' | 'leave' | 'holiday' | 'overtime';
}

export interface WeekOvertime {
  weekStart: ISODate;
  hours: number;
  otHours: number;
  regularRate: number;
  premium: number;
}

export interface GrossResult {
  period: Period;
  days: ResolvedDay[];
  scheduledHours: number;
  basePay: number;
  adjustments: Adjustment[];
  weeks: WeekOvertime[];
  workedHours: number;
  leaveHours: number;
  otHours: number;
  otPremium: number;
  gross: number;
}

export function computeGross(
  period: Period,
  pay: PaySettings,
  rateList: PayRate[],
  overrides: Map<ISODate, WorkDay> | Record<string, WorkDay>,
): GrossResult {
  const rates = allRates(pay.baseRate, rateList);
  const get = (d: ISODate) => (overrides instanceof Map ? overrides.get(d) : overrides[d]);
  const days = rangeDays(period.start, period.end).map((d) => resolveDay(d, pay, rates, get(d)));
  const scheduledHours = days.filter((d) => d.scheduled).length * pay.hoursPerDay;
  const basePay = round2(scheduledHours * pay.baseRate);

  const adjustments: Adjustment[] = [];
  for (const d of days) {
    const actual = d.straightPay + d.leavePay + d.holidayPremium;
    const diff = round2(actual - d.defaultPay);
    if (!d.edited) continue;
    const when = fmtDay(d.date);
    if (d.status === 'missed' || (d.status === 'off' && d.scheduled)) {
      adjustments.push({ date: d.date, label: 'Missed day', detail: `${when} · ${pay.hoursPerDay} h unpaid`, amount: diff, kind: 'missed' });
    } else if (d.status === 'pto' || d.status === 'sick' || d.status === 'holiday') {
      const name = d.status === 'pto' ? 'Paid time off' : d.status === 'sick' ? 'Sick leave' : 'Paid holiday';
      adjustments.push({ date: d.date, label: name, detail: `${when} · ${d.paidLeaveHours} h at base`, amount: diff, kind: 'leave' });
    } else if (d.status === 'worked') {
      const rateDesc = d.segments.map((s) => `${s.hours} h ${s.rateName === 'Custom' ? `@ $${s.rate.toFixed(2)}` : s.rateName}`).join(' + ');
      let label = 'Different pay';
      let kind: Adjustment['kind'] = 'rate';
      if (!d.scheduled) {
        label = 'Extra day';
        kind = 'extra';
      } else if (d.workedHours > pay.hoursPerDay) {
        label = d.segments.some((s) => s.rate !== pay.baseRate) ? 'Longer day, different pay' : 'Extra hours';
        kind = 'extra';
      } else if (d.workedHours < pay.hoursPerDay) {
        label = 'Shorter day';
        kind = 'short';
      }
      if (d.holidayPremium > 0) {
        label = 'Worked holiday';
        kind = 'holiday';
      }
      if (Math.abs(diff) >= 0.005 || label !== 'Different pay')
        adjustments.push({ date: d.date, label, detail: `${when} · ${rateDesc}`, amount: diff, kind });
    }
  }

  // Overtime by workweek (weeks start on the period's first day)
  const weeks: WeekOvertime[] = [];
  for (let w = 0; w < 2; w++) {
    const wd = days.slice(w * 7, w * 7 + 7);
    const hours = wd.reduce((s, d) => s + d.workedHours, 0);
    const straight = wd.reduce((s, d) => s + d.straightPay, 0);
    const daily = pay.overtime.dailyThreshold
      ? wd.reduce((s, d) => s + Math.max(0, d.workedHours - (pay.overtime.dailyThreshold as number)), 0)
      : 0;
    const weekly = Math.max(0, hours - daily - pay.overtime.weeklyThreshold);
    const otHours = round2(daily + weekly);
    const regularRate = hours > 0 ? straight / hours : pay.baseRate;
    const rateForOt = pay.overtime.method === 'weighted' ? regularRate : pay.baseRate;
    const premium = round2(otHours * rateForOt * (pay.overtime.multiplier - 1));
    weeks.push({ weekStart: wd[0].date, hours, otHours, regularRate: round2(regularRate), premium });
    if (otHours > 0) {
      adjustments.push({
        date: null,
        label: 'Overtime premium',
        detail: `Week of ${fmtDay(wd[0].date)} · ${otHours} h × ${(pay.overtime.multiplier - 1).toFixed(1)} × $${rateForOt.toFixed(2)}`,
        amount: premium,
        kind: 'overtime',
      });
    }
  }

  const workedHours = days.reduce((s, d) => s + d.workedHours, 0);
  const leaveHours = days.reduce((s, d) => s + d.paidLeaveHours, 0);
  const otHours = round2(weeks.reduce((s, w) => s + w.otHours, 0));
  const otPremium = round2(weeks.reduce((s, w) => s + w.premium, 0));
  const gross = round2(basePay + adjustments.reduce((s, a) => s + a.amount, 0));
  return { period, days, scheduledHours, basePay, adjustments, weeks, workedHours, leaveHours, otHours, otPremium, gross };
}

export function newWorkDay(date: ISODate, status: DayStatus, pay: PaySettings): WorkDay {
  return {
    id: date,
    date,
    status,
    segments: status === 'worked' ? [{ hours: pay.hoursPerDay, rateId: BASE_RATE_ID, rate: null }] : [],
    paidHours: status === 'missed' || status === 'worked' ? 0 : pay.hoursPerDay,
    note: '',
  };
}
