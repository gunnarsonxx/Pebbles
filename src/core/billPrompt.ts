// Bills whose amount changes every month (utilities): on a set day and time Pebbles asks for this
// month's amount. "Not posted" snoozes it 24 hours; saving the amount is done until next month.
import { toISO } from './dates';
import { matchesBill } from './analytics';
import type { Bill, Transaction } from './types';

export interface AmountReminder {
  day: number; // day of the month, e.g. 9
  time: string; // "10:00", local time
  doneMonth?: string | null; // "2026-11" once this month's amount is in
  snoozeUntil?: number | null; // ms timestamp
}

export const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** When this month's (or another month's) prompt is set for, in local time. */
export function promptAt(r: AmountReminder, year: number, month0: number): Date {
  const last = new Date(year, month0 + 1, 0).getDate();
  const [h, m] = (r.time || '10:00').split(':').map(Number);
  return new Date(year, month0, Math.min(Math.max(1, r.day), last), h || 0, m || 0, 0, 0);
}

/** Does this bill want its amount checked right now? */
export function promptDue(b: Bill, now: Date): boolean {
  const r = b.amountReminder;
  if (!r || !b.active) return false;
  if (r.doneMonth === ym(now)) return false;
  if (r.snoozeUntil && r.snoozeUntil > now.getTime()) return false;
  return now.getTime() >= promptAt(r, now.getFullYear(), now.getMonth()).getTime();
}

export function duePrompts(bills: Bill[], now: Date): Bill[] {
  return bills.filter((b) => promptDue(b, now));
}

/** The next time to notify (for a phone notification), or null. */
export function nextPromptTime(b: Bill, now: Date): Date | null {
  const r = b.amountReminder;
  if (!r || !b.active) return null;
  const thisMonth = promptAt(r, now.getFullYear(), now.getMonth());
  if (r.doneMonth !== ym(now)) {
    if (r.snoozeUntil && r.snoozeUntil > now.getTime()) return new Date(r.snoozeUntil);
    if (thisMonth.getTime() > now.getTime()) return thisMonth;
  }
  return promptAt(r, now.getFullYear(), now.getMonth() + 1);
}

/** The bill as it posted, if the bank already shows it (last 40 days). */
export function postedAmount(b: Bill, txns: Transaction[], now: Date): { amount: number; date: string } | null {
  const since = toISO(new Date(now.getTime() - 40 * 86_400_000));
  const hit = txns.filter((t) => t.date >= since && !t.excluded && matchesBill(t, b)).sort((a, c) => c.date.localeCompare(a.date))[0];
  return hit ? { amount: Math.abs(hit.amount), date: hit.date } : null;
}

export const saveAmount = (b: Bill, amount: number, now: Date): Bill => ({
  ...b,
  amount,
  amountReminder: { ...b.amountReminder!, doneMonth: ym(now), snoozeUntil: null },
});

export const snooze = (b: Bill, now: Date, hours = 24): Bill => ({
  ...b,
  amountReminder: { ...b.amountReminder!, snoozeUntil: now.getTime() + hours * 3_600_000 },
});

/** Bills that look like utilities (their amount changes every month), by name. */
export const looksVariable = (b: Bill) => /utilit|electric|energy|water|sewer|xcel|natural gas|trash/i.test(b.name);
