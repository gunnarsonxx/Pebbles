// Date helpers working on local calendar dates as 'YYYY-MM-DD' strings.
// Calendar math is done in UTC to avoid DST surprises.
import type { ISODate } from './types';

const DAY = 86_400_000;

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): ISODate {
  return toISO(new Date());
}

function utc(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): ISODate {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromUtc(utc(iso) + n * DAY);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utc(a) - utc(b)) / DAY);
}

export function dayOfWeek(iso: ISODate): number {
  return new Date(utc(iso)).getUTCDay();
}

export function parts(iso: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function makeDate(y: number, m: number, d: number): ISODate {
  // clamps the day into the month (e.g. due day 31 in February -> 28/29)
  const dd = Math.min(d, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function addMonths(monthKeyStr: string, n: number): string {
  const [y, m] = monthKeyStr.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function rangeDays(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function dowShort(iso: ISODate): string {
  return DOW[dayOfWeek(iso)];
}
export function dowLong(iso: ISODate): string {
  return DOW_LONG[dayOfWeek(iso)];
}
export function dowName(n: number): string {
  return DOW[n];
}

/** "Fri, Dec 5" */
export function fmtDay(iso: ISODate): string {
  const { m, d } = parts(iso);
  return `${dowShort(iso)}, ${MON[m - 1]} ${d}`;
}

/** "1st", "2nd", "20th" */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "Fri, Nov 20th" */
export function fmtDayOrd(iso: ISODate): string {
  const { m, d } = parts(iso);
  return `${dowShort(iso)}, ${MON[m - 1]} ${ordinal(d)}`;
}

/** "Dec 5" */
export function fmtShort(iso: ISODate): string {
  const { m, d } = parts(iso);
  return `${MON[m - 1]} ${d}`;
}

/** "Dec 5, 2026" */
export function fmtLong(iso: ISODate): string {
  const { y, m, d } = parts(iso);
  return `${MON[m - 1]} ${d}, ${y}`;
}

/** "November 2026" */
export function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MON_LONG[m - 1]} ${y}`;
}

export function fmtMonthShort(key: string): string {
  const [, m] = key.split('-').map(Number);
  return MON[m - 1];
}

export function relativeDays(target: ISODate, from: ISODate = today()): string {
  const n = diffDays(target, from);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 1) return `in ${n} days`;
  return `${-n} days ago`;
}

/** Parse many common bank date formats into ISO. Returns null when unparseable. */
export function parseLooseDate(raw: string, fallbackYear?: number): ISODate | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return safe(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})/); // OFX 20261105...
  if (m) return safe(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return safe(y, +m[1], +m[2]);
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})\b/);
  if (m && fallbackYear) return safe(fallbackYear, +m[1], +m[2]);
  m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})/);
  if (m) {
    const mi = MON.findIndex((x) => m![1].toLowerCase().startsWith(x.toLowerCase()));
    if (mi >= 0) return safe(+m[3], mi + 1, +m[2]);
  }
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})/);
  if (m) {
    const mi = MON.findIndex((x) => m![2].toLowerCase().startsWith(x.toLowerCase()));
    if (mi >= 0) return safe(+m[3], mi + 1, +m[1]);
  }
  m = s.match(/^([A-Za-z]{3})\.? (\d{1,2})\b/);
  if (m && fallbackYear) {
    const mi = MON.findIndex((x) => m![1].toLowerCase() === x.toLowerCase());
    if (mi >= 0) return safe(fallbackYear, mi + 1, +m[2]);
  }
  return null;
}

function safe(y: number, m: number, d: number): ISODate | null {
  if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  if (d > daysInMonth(y, m)) return null;
  return makeDate(y, m, d);
}

/** '21:30' → '9:30p', '06:00' → '6a' (compact clock times for shift labels). */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`;
}
