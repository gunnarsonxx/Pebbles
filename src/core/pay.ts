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
import { holidayOn, type HolidayDef } from './holidays';

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

/**
 * The next paycheck you haven't been paid yet. On (or a few days before) payday it's that day's check until
 * the deposit shows up; once it has, or once payday is over at midnight, it's the following one.
 */
export function nextUnpaidPeriod(pay: PaySettings, date: ISODate, received: (periodStart: ISODate) => boolean): Period {
  const p = upcomingPayPeriod(pay, date);
  return received(p.start) && diffDays(p.payday, date) <= 4 ? periodByIndex(pay, p.index + 1) : p;
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
  preShare?: number; // share of this shift's hours before midnight, when the shift has its own times
  holiday?: HolidayDef | null; // a paid holiday falls on this calendar day
  countedHours?: number; // hours counted on this calendar day (overnight shifts)
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

export function resolveDay(date: ISODate, pay: PaySettings, rates: PayRate[], override: WorkDay | undefined): ResolvedDay {
  const scheduled = pay.workDays.includes(dayOfWeek(date));
  const defaultPay = scheduled ? pay.hoursPerDay * pay.baseRate : 0;
  const base = { date, scheduled, defaultPay, holidayPremium: 0, note: override?.note ?? '' };
  if (!override) {
    if (!scheduled) return { ...base, edited: false, status: 'off', segments: [], workedHours: 0, paidLeaveHours: 0, straightPay: 0, leavePay: 0 };
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
    const own = override.start && override.end ? splitTimes(override.start, override.end, pay) : null;
    return {
      ...base,
      preShare: own ? (own.overnight ? (hours > 0 ? Math.min(hours, own.pre) / hours : 1) : 1) : undefined,
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

// ---------------- overnight shifts ----------------
// A shift belongs to the night it starts, but its hours count on the calendar day they
// are worked (that's how payroll splits them between days, weeks and pay periods).

function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Paid hours before and after midnight for a shift from `start` to `end` (break taken off one side). */
export function splitTimes(start: string, end: string, pay: Pick<PaySettings, 'breakMinutes' | 'breakAfterMidnight'>): { overnight: boolean; pre: number; post: number } {
  const s = minutes(start);
  const e = minutes(end);
  const b = (pay.breakMinutes || 0) / 60;
  if (e > s) return { overnight: false, pre: round2(Math.max(0, (e - s) / 60 - b)), post: 0 };
  // a break on the side of midnight that has no time at all comes off the other side
  let pre = (1440 - s) / 60;
  let post = e / 60;
  if (pay.breakAfterMidnight && post >= b) post -= b;
  else if (!pay.breakAfterMidnight && pre >= b) pre -= b;
  else if (post >= b) post -= b;
  else pre -= b;
  return { overnight: true, pre: round2(Math.max(0, pre)), post: round2(Math.max(0, post)) };
}

/** Normal paid hours before and after midnight for one shift. */
export function shiftSplit(pay: PaySettings): { overnight: boolean; pre: number; post: number } {
  if (!pay.shiftStart || !pay.shiftEnd) return { overnight: false, pre: pay.hoursPerDay, post: 0 };
  const sp = splitTimes(pay.shiftStart, pay.shiftEnd, pay);
  if (!sp.overnight) return { overnight: false, pre: pay.hoursPerDay, post: 0 };
  return sp;
}

/** Hours for a shift with its own start/end times. */
export function hoursForTimes(start: string, end: string, pay: PaySettings): number {
  const sp = splitTimes(start, end, pay);
  return round2(sp.pre + sp.post);
}

/** Paid hours for one shift, normally. */
export function shiftHours(pay: PaySettings): number {
  const sp = shiftSplit(pay);
  return sp.overnight ? round2(sp.pre + sp.post) : pay.hoursPerDay;
}

/** How much of a shift of `hours` falls before midnight (leaving early trims the morning part). */
export function preMidnightShare(hours: number, pay: PaySettings): number {
  const sp = shiftSplit(pay);
  if (!sp.overnight || hours <= 0) return 1;
  return Math.min(hours, sp.pre) / hours;
}

export function computeGross(period: Period, pay: PaySettings, rateList: PayRate[], overrides: Map<ISODate, WorkDay> | Record<string, WorkDay>): GrossResult {
  const rates = allRates(pay.baseRate, rateList);
  const get = (d: ISODate) => (overrides instanceof Map ? overrides.get(d) : overrides[d]);
  const sp = shiftSplit(pay);
  const normalShift = sp.overnight ? sp.pre + sp.post : pay.hoursPerDay;
  const normalPre = sp.overnight ? sp.pre / normalShift : 1;
  // include the shift that starts the night before the period: its morning hours count here
  const allShifts = rangeDays(addDays(period.start, -1), period.end).map((d) => resolveDay(d, { ...pay, hoursPerDay: normalShift }, rates, get(d)));
  const days = allShifts.slice(1);
  const inPeriod = (d: ISODate) => d >= period.start && d <= period.end;

  // hours and pay per calendar day
  const cal = new Map<ISODate, { hours: number; straight: number; leave: number; defaultHours: number; defaultPay: number }>();
  const add = (d: ISODate, k: 'hours' | 'straight' | 'leave' | 'defaultHours' | 'defaultPay', v: number) => {
    const c = cal.get(d) ?? { hours: 0, straight: 0, leave: 0, defaultHours: 0, defaultPay: 0 };
    c[k] += v;
    cal.set(d, c);
  };
  const actualPay = (x: ResolvedDay) => x.straightPay + x.leavePay + x.holidayPremium;
  const fracOf = (x: ResolvedDay) => x.preShare ?? preMidnightShare(x.workedHours || x.paidLeaveHours, pay);
  // paid holidays: Pebbles adds the premium itself, so a manual "worked a holiday" doesn't double it
  const hol = (d: ISODate) => (pay.holidays?.ids?.length ? holidayOn(d, pay.holidays) : null);
  const holidayMult = Math.max(0, pay.holidayMultiplier - 1);
  for (const x of allShifts) {
    const touches = pay.holidays?.rule === 'shiftStart' ? hol(x.date) : hol(x.date) || (fracOf(x) < 1 ? hol(addDays(x.date, 1)) : null);
    if (touches && x.holidayPremium) x.holidayPremium = 0;
  }
  for (const x of allShifts) {
    const next = addDays(x.date, 1);
    const f = fracOf(x);
    add(x.date, 'hours', x.workedHours * f);
    add(next, 'hours', x.workedHours * (1 - f));
    add(x.date, 'straight', x.straightPay * f);
    add(next, 'straight', x.straightPay * (1 - f));
    add(x.date, 'leave', x.paidLeaveHours * f);
    add(next, 'leave', x.paidLeaveHours * (1 - f));
    if (x.scheduled) {
      add(x.date, 'defaultHours', normalShift * normalPre);
      add(next, 'defaultHours', normalShift * (1 - normalPre));
      add(x.date, 'defaultPay', x.defaultPay * normalPre);
      add(next, 'defaultPay', x.defaultPay * (1 - normalPre));
    }
  }
  const periodDates = rangeDays(period.start, period.end);
  const sum = (k: 'hours' | 'straight' | 'leave' | 'defaultHours' | 'defaultPay', dates = periodDates) => dates.reduce((s, d) => s + (cal.get(d)?.[k] ?? 0), 0);
  const scheduledHours = round2(sum('defaultHours'));
  const basePay = round2(sum('defaultPay'));
  for (const d of days) {
    d.countedHours = round2(cal.get(d.date)?.hours ?? 0);
    d.holiday = hol(d.date);
  }

  const unit = sp.overnight ? 'Shift' : 'Day';
  const adjustments: Adjustment[] = [];
  for (const d of allShifts) {
    if (!d.edited) continue;
    const next = addDays(d.date, 1);
    const fa = fracOf(d);
    const actual = actualPay(d);
    const diffIn = round2(
      actual * fa * (inPeriod(d.date) ? 1 : 0) +
        actual * (1 - fa) * (inPeriod(next) ? 1 : 0) -
        (d.defaultPay * normalPre * (inPeriod(d.date) ? 1 : 0) + d.defaultPay * (1 - normalPre) * (inPeriod(next) ? 1 : 0)),
    );
    if (!inPeriod(d.date) && !inPeriod(next)) continue;
    const partial = sp.overnight && (!inPeriod(d.date) || !inPeriod(next));
    const when = sp.overnight ? `${fmtDay(d.date)} night` : fmtDay(d.date);
    const part = partial ? ' (part of it on this check)' : '';
    if (d.status === 'missed' || (d.status === 'off' && d.scheduled)) {
      const hrsHere = round2(normalShift * ((inPeriod(d.date) ? normalPre : 0) + (inPeriod(next) ? 1 - normalPre : 0)));
      const detail = partial ? `${when} · ${hrsHere} h unpaid on this check (the rest is on the ${inPeriod(d.date) ? 'next' : 'previous'} one)` : `${when} · ${normalShift} h unpaid`;
      adjustments.push({ date: d.date, label: `Missed ${unit}`, detail, amount: diffIn, kind: 'missed' });
    } else if (d.status === 'pto' || d.status === 'sick' || d.status === 'holiday') {
      const name = d.status === 'pto' ? 'Paid Time Off' : d.status === 'sick' ? 'Sick Leave' : 'Paid Holiday';
      adjustments.push({ date: d.date, label: name, detail: `${when} · ${d.paidLeaveHours} h at base${part}`, amount: diffIn, kind: 'leave' });
    } else if (d.status === 'worked') {
      const rateDesc = d.segments.map((s) => `${s.hours} h ${s.rateName === 'Custom' ? `@ $${s.rate.toFixed(2)}` : s.rateName}`).join(' + ');
      let label = 'Different Pay';
      let kind: Adjustment['kind'] = 'rate';
      if (!d.scheduled) {
        label = `Extra ${unit}`;
        kind = 'extra';
      } else if (d.workedHours > normalShift) {
        label = d.segments.some((s) => s.rate !== pay.baseRate) ? `Longer ${unit}, Different Pay` : 'Extra Hours';
        kind = 'extra';
      } else if (d.workedHours < normalShift) {
        label = `Shorter ${unit}`;
        kind = 'short';
      }
      if (d.holidayPremium > 0) {
        label = 'Worked Holiday';
        kind = 'holiday';
      }
      if (Math.abs(diffIn) >= 0.005 || label !== 'Different Pay') adjustments.push({ date: d.date, label, detail: `${when} · ${rateDesc}${part}`, amount: diffIn, kind });
    }
  }

  // Holiday pay: worked hours on a paid holiday earn the holiday multiplier
  if (holidayMult > 0 && pay.holidays?.ids?.length) {
    if (pay.holidays.rule === 'shiftStart') {
      for (const x of allShifts) {
        const h = hol(x.date);
        if (!h || x.workedHours <= 0) continue;
        const f = fracOf(x);
        const share = (inPeriod(x.date) ? f : 0) + (inPeriod(addDays(x.date, 1)) ? 1 - f : 0);
        const amount = round2(x.straightPay * holidayMult * share);
        if (amount > 0)
          adjustments.push({
            date: x.date,
            label: `Holiday Pay · ${h.name}`,
            detail: `${round2(x.workedHours * share)} h × ${pay.holidayMultiplier} for the shift starting ${fmtDay(x.date)}`,
            amount,
            kind: 'holiday',
          });
      }
    } else {
      for (const d of periodDates) {
        const h = hol(d);
        const c = cal.get(d);
        if (!h || !c || c.hours <= 0) continue;
        const amount = round2(c.straight * holidayMult);
        adjustments.push({ date: d, label: `Holiday Pay · ${h.name}`, detail: `${round2(c.hours)} h worked on ${fmtDay(d)} × ${pay.holidayMultiplier}`, amount, kind: 'holiday' });
      }
    }
  }

  // Overtime by workweek (weeks start on the period's first day), on hours as counted by day
  const weeks: WeekOvertime[] = [];
  for (let w = 0; w < 2; w++) {
    const wdates = periodDates.slice(w * 7, w * 7 + 7);
    const hours = sum('hours', wdates);
    const straight = sum('straight', wdates);
    // long shifts: hours past the daily limit, counted on the day the shift ends
    const daily = pay.overtime.dailyThreshold
      ? allShifts.reduce((s, x) => {
          const extra = Math.max(0, x.workedHours - (pay.overtime.dailyThreshold as number));
          const endDay = sp.overnight && fracOf(x) < 1 ? addDays(x.date, 1) : x.date;
          return s + (wdates.includes(endDay) ? extra : 0);
        }, 0)
      : 0;
    const weekly = Math.max(0, hours - daily - pay.overtime.weeklyThreshold);
    const otHours = round2(daily + weekly);
    const regularRate = hours > 0 ? straight / hours : pay.baseRate;
    const rateForOt = pay.overtime.method === 'weighted' ? regularRate : pay.baseRate;
    const premium = round2(otHours * rateForOt * (pay.overtime.multiplier - 1));
    weeks.push({ weekStart: wdates[0], hours: round2(hours), otHours, regularRate: round2(regularRate), premium });
    if (otHours > 0) {
      adjustments.push({
        date: null,
        label: 'Overtime Premium',
        detail: `Week of ${fmtDay(wdates[0])} · ${otHours} h × ${(pay.overtime.multiplier - 1).toFixed(1)} × $${rateForOt.toFixed(2)}`,
        amount: premium,
        kind: 'overtime',
      });
    }
  }

  const workedHours = round2(sum('hours'));
  const leaveHours = round2(sum('leave'));
  const otHours = round2(weeks.reduce((s, w) => s + w.otHours, 0));
  const otPremium = round2(weeks.reduce((s, w) => s + w.premium, 0));
  const gross = round2(basePay + adjustments.reduce((s, a) => s + a.amount, 0));
  return { period, days, scheduledHours, basePay, adjustments, weeks, workedHours, leaveHours, otHours, otPremium, gross };
}

export function newWorkDay(date: ISODate, status: DayStatus, pay: PaySettings): WorkDay {
  const h = shiftHours(pay);
  return {
    id: date,
    date,
    status,
    segments: status === 'worked' ? [{ hours: h, rateId: BASE_RATE_ID, rate: null }] : [],
    paidHours: status === 'missed' || status === 'worked' ? 0 : h,
    note: '',
  };
}
