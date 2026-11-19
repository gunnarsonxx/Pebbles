// U.S. federal holidays (5 U.S.C. 6103) plus a few days many employers also pay as holidays.
import { addDays, dayOfWeek, makeDate, parts } from './dates';
import type { ISODate } from './types';

export interface HolidayDef {
  id: string;
  name: string;
  federal: boolean;
  date: (y: number) => ISODate;
}

/** The nth weekday (0=Sun) of a month; n = -1 for the last one. */
function nthWeekday(y: number, m: number, dow: number, n: number): ISODate {
  if (n > 0) {
    const first = makeDate(y, m, 1);
    const shift = (dow - dayOfWeek(first) + 7) % 7;
    return addDays(first, shift + (n - 1) * 7);
  }
  const last = makeDate(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return addDays(last, -((dayOfWeek(last) - dow + 7) % 7));
}

export const HOLIDAYS: HolidayDef[] = [
  { id: 'new_year', name: 'New Year’s Day', federal: true, date: (y) => makeDate(y, 1, 1) },
  { id: 'mlk', name: 'Martin Luther King Jr. Day', federal: true, date: (y) => nthWeekday(y, 1, 1, 3) },
  { id: 'presidents', name: 'Presidents’ Day', federal: true, date: (y) => nthWeekday(y, 2, 1, 3) },
  { id: 'memorial', name: 'Memorial Day', federal: true, date: (y) => nthWeekday(y, 5, 1, -1) },
  { id: 'juneteenth', name: 'Juneteenth', federal: true, date: (y) => makeDate(y, 6, 19) },
  { id: 'independence', name: 'Independence Day', federal: true, date: (y) => makeDate(y, 7, 4) },
  { id: 'labor', name: 'Labor Day', federal: true, date: (y) => nthWeekday(y, 9, 1, 1) },
  { id: 'columbus', name: 'Columbus Day', federal: true, date: (y) => nthWeekday(y, 10, 1, 2) },
  { id: 'veterans', name: 'Veterans Day', federal: true, date: (y) => makeDate(y, 11, 11) },
  { id: 'thanksgiving', name: 'Thanksgiving', federal: true, date: (y) => nthWeekday(y, 11, 4, 4) },
  { id: 'christmas', name: 'Christmas Day', federal: true, date: (y) => makeDate(y, 12, 25) },
  // common employer holidays that aren't federal
  { id: 'black_friday', name: 'Day after Thanksgiving', federal: false, date: (y) => addDays(nthWeekday(y, 11, 4, 4), 1) },
  { id: 'christmas_eve', name: 'Christmas Eve', federal: false, date: (y) => makeDate(y, 12, 24) },
  { id: 'new_years_eve', name: 'New Year’s Eve', federal: false, date: (y) => makeDate(y, 12, 31) },
  { id: 'easter', name: 'Easter Sunday', federal: false, date: (y) => easter(y) },
];

/** Gregorian Easter (anonymous algorithm). */
function easter(y: number): ISODate {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeDate(y, month, day);
}

export const DEFAULT_HOLIDAYS = HOLIDAYS.filter((h) => h.federal).map((h) => h.id);

/** Weekend holidays move to Friday/Monday (how offices observe them). */
export function observedDate(d: ISODate): ISODate {
  const w = dayOfWeek(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, 1) : d;
}

export interface HolidayPrefs {
  ids: string[];
  observed: boolean; // use the Friday/Monday observed date instead of the actual date
}

/** The holiday (if any) that falls on a date, under your employer's list. */
export function holidayOn(date: ISODate, prefs: HolidayPrefs): HolidayDef | null {
  const y = parts(date).y;
  for (const yy of [y, y + 1]) {
    for (const h of HOLIDAYS) {
      if (!prefs.ids.includes(h.id)) continue;
      const actual = h.date(yy);
      const d = prefs.observed && h.federal ? observedDate(actual) : actual;
      if (d === date) return h;
    }
  }
  return null;
}

/** Upcoming holidays from a date (for the settings list). */
export function holidaysInYear(y: number, prefs: HolidayPrefs): { def: HolidayDef; date: ISODate }[] {
  return HOLIDAYS.map((def) => {
    const actual = def.date(y);
    return { def, date: prefs.observed && def.federal ? observedDate(actual) : actual };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
