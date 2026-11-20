// Your car, from odometer readings: how far you drive, when, how many miles a gallon,
// and what that costs a month.
import { addDays, diffDays } from './dates';
import { round2 } from './money';
import type { DriveEntry, ISODate } from './types';

export interface DrivingStats {
  readings: number;
  days: number; // span of the readings used
  milesPerDay: number;
  milesPerMonth: number;
  mpg: number | null;
  mpgFrom: 'fillups' | 'dash' | null;
  fillups: number;
  byWeekday: { day: string; miles: number }[]; // average miles on each weekday
  work: { perDay: number; days: number } | null; // average on days you worked
  off: { perDay: number; days: number } | null; // average on days off
  lastOdometer: number | null;
  lastDate: ISODate | null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Miles per day, spread evenly over the days between two readings. */
function dailyMiles(entries: DriveEntry[]): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1];
    const b = entries[i];
    const miles = b.odometer - a.odometer;
    const span = Math.max(1, diffDays(b.date, a.date));
    if (miles < 0 || miles > 2000 * span) continue; // a typo, not a road trip
    // a reading taken the same day as the last one adds to that day
    if (b.date === a.date) {
      out.set(b.date, (out.get(b.date) ?? 0) + miles);
      continue;
    }
    for (let k = 1; k <= span; k++) {
      const d = addDays(a.date, k);
      out.set(d, (out.get(d) ?? 0) + miles / span);
    }
  }
  return out;
}

/** MPG between full fill-ups: miles driven ÷ gallons that refilled them. */
export function fillupMpg(entries: DriveEntry[]): { mpg: number; fillups: number } | null {
  const full = entries.filter((e) => e.gallons && e.gallons > 0 && e.full !== false);
  let miles = 0;
  let gallons = 0;
  let n = 0;
  for (let i = 1; i < full.length; i++) {
    const m = full[i].odometer - full[i - 1].odometer;
    if (m <= 0 || m > 1200) continue;
    // gallons of every fill-up after the last full one, up to and including this one
    const between = entries.filter((e) => e.odometer > full[i - 1].odometer && e.odometer <= full[i].odometer && e.gallons);
    miles += m;
    gallons += between.reduce((s, e) => s + (e.gallons ?? 0), 0);
    n++;
  }
  return n && gallons > 0 ? { mpg: round2(miles / gallons), fillups: n } : null;
}

export function drivingStats(all: DriveEntry[], today: ISODate, workDates: Set<ISODate> = new Set(), windowDays = 120): DrivingStats | null {
  const entries = [...all].filter((e) => e.odometer > 0).sort((a, b) => a.odometer - b.odometer || a.at - b.at);
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  const recent = entries.filter((e) => diffDays(today, e.date) <= windowDays);
  const use = recent.length >= 2 ? recent : entries;
  const days = Math.max(1, diffDays(use[use.length - 1].date, use[0].date));
  const miles = use[use.length - 1].odometer - use[0].odometer;
  const perDay = use.length >= 2 && miles >= 0 ? miles / days : 0;

  const fu = fillupMpg(entries);
  const dash = entries.filter((e) => e.dashMpg && e.dashMpg > 5 && e.dashMpg < 80).slice(-5);
  const mpg = fu ? fu.mpg : dash.length ? round2(dash.reduce((s, e) => s + (e.dashMpg ?? 0), 0) / dash.length) : null;

  const daily = dailyMiles(use);
  const wd = DOW.map(() => ({ miles: 0, n: 0 }));
  let work = { miles: 0, n: 0 };
  let off = { miles: 0, n: 0 };
  for (const [d, m] of daily) {
    const i = new Date(`${d}T12:00:00`).getDay();
    wd[i].miles += m;
    wd[i].n++;
    if (workDates.size) {
      if (workDates.has(d)) work = { miles: work.miles + m, n: work.n + 1 };
      else off = { miles: off.miles + m, n: off.n + 1 };
    }
  }
  return {
    readings: entries.length,
    days,
    milesPerDay: round2(perDay),
    milesPerMonth: Math.round(perDay * 30.4),
    mpg,
    mpgFrom: fu ? 'fillups' : mpg ? 'dash' : null,
    fillups: fu?.fillups ?? 0,
    byWeekday: wd.map((x, i) => ({ day: DOW[i], miles: x.n ? round2(x.miles / x.n) : 0 })),
    work: work.n ? { perDay: round2(work.miles / work.n), days: work.n } : null,
    off: off.n ? { perDay: round2(off.miles / off.n), days: off.n } : null,
    lastOdometer: last.odometer,
    lastDate: last.date,
  };
}

/** Enough to trust over the numbers you typed in Settings: two weeks and a few readings. */
export const trustworthy = (s: DrivingStats | null): s is DrivingStats => !!s && s.readings >= 3 && s.days >= 14 && s.milesPerMonth > 0;

export function monthlyFuelCost(milesPerMonth: number, mpg: number, perGallon: number): number {
  return round2((milesPerMonth / mpg) * perGallon);
}

