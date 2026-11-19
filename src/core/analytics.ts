import { addMonths, diffDays, monthKey } from './dates';
import { categoryOf, type CategoryGroup } from './categories';
import { merchantKey, cleanMerchant } from './statements';
import { round2 } from './money';
import type { Bill, ISODate, Transaction } from './types';

export interface MonthSummary {
  month: string;
  income: number;
  spending: number; // positive number
  saved: number; // moved to savings
  net: number; // income - spending
  byCategory: Record<string, number>; // spending per category (positive)
  byGroup: Record<CategoryGroup, number>;
  count: number;
}

export function countable(t: Transaction): boolean {
  return !t.excluded && categoryOf(t.category).group !== 'transfer';
}

export function summarizeMonth(txns: Transaction[], month: string): MonthSummary {
  const byCategory: Record<string, number> = {};
  const byGroup = { income: 0, bills: 0, essentials: 0, personal: 0, savings: 0, transfer: 0 } as Record<CategoryGroup, number>;
  let income = 0;
  let spending = 0;
  let saved = 0;
  let count = 0;
  for (const t of txns) {
    if (monthKey(t.date) !== month || !countable(t)) continue;
    count++;
    const cat = categoryOf(t.category);
    if (cat.group === 'savings') {
      saved += -t.amount;
      byGroup.savings += -t.amount;
      continue;
    }
    if (t.amount > 0) {
      if (cat.group === 'income') income += t.amount;
      else {
        // a refund/return in a spending category reduces that category
        byCategory[cat.id] = (byCategory[cat.id] ?? 0) - t.amount;
        byGroup[cat.group] -= t.amount;
        spending -= t.amount;
      }
    } else {
      byCategory[cat.id] = (byCategory[cat.id] ?? 0) - t.amount;
      byGroup[cat.group] -= t.amount;
      spending -= t.amount;
    }
  }
  for (const k of Object.keys(byCategory)) byCategory[k] = round2(byCategory[k]);
  return { month, income: round2(income), spending: round2(spending), saved: round2(saved), net: round2(income - spending), byCategory, byGroup, count };
}

export function monthsWithData(txns: Transaction[]): string[] {
  return [...new Set(txns.map((t) => monthKey(t.date)))].sort();
}

/** The last `n` complete months that have data, ending before `current`. */
export function recentFullMonths(txns: Transaction[], current: string, n = 3): string[] {
  const have = new Set(monthsWithData(txns));
  const out: string[] = [];
  for (let i = 1; i <= 12 && out.length < n; i++) {
    const m = addMonths(current, -i);
    if (have.has(m)) out.push(m);
  }
  return out;
}

export function averageCategory(txns: Transaction[], cats: string[], months: string[]): number {
  if (!months.length) return 0;
  const total = months.reduce((s, m) => {
    const sum = summarizeMonth(txns, m);
    return s + cats.reduce((x, c) => x + (sum.byCategory[c] ?? 0), 0);
  }, 0);
  return round2(total / months.length);
}

// ---------------- recurring charges ----------------

export interface RecurringCandidate {
  key: string;
  name: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  lastDate: ISODate;
  count: number;
  category: string;
  dueDay: number;
  pattern: string;
}

export function detectRecurring(txns: Transaction[], bills: Bill[] = [], asOf?: ISODate): RecurringCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.amount >= 0 || !countable(t)) continue;
    const g = categoryOf(t.category).group;
    if (g === 'savings' || g === 'income') continue;
    if (g === 'essentials' && t.category !== 'health' && t.category !== 'transport') continue; // groceries/gas vary by trip
    if (t.category === 'dining' || t.category === 'delivery' || t.category === 'shopping' || t.category === 'cash' || t.category === 'p2p') continue;
    const k = merchantKey(t.description);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  const out: RecurringCandidate[] = [];
  const latest = asOf ?? txns.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = list.slice(1).map((t, i) => diffDays(t.date, list[i].date));
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const amounts = list.map((t) => -t.amount);
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const spread = Math.max(...amounts.map((a) => Math.abs(a - avg))) / avg;
    if (spread > 0.2) continue;
    let frequency: RecurringCandidate['frequency'] | null = null;
    if (gaps.every((g) => g >= 25 && g <= 35)) frequency = 'monthly';
    else if (gaps.every((g) => g >= 12 && g <= 16)) frequency = 'biweekly';
    else if (gaps.every((g) => g >= 6 && g <= 8) && list.length >= 3) frequency = 'weekly';
    else if (gaps.every((g) => g >= 355 && g <= 375)) frequency = 'yearly';
    if (!frequency) continue;
    const last = list[list.length - 1];
    // stale: hasn't happened in 2+ cycles
    if (diffDays(latest, last.date) > avgGap * 2 + 5) continue;
    const name = cleanMerchant(last.description);
    if (bills.some((b) => b.active && b.matchPattern && last.description.toUpperCase().includes(b.matchPattern.toUpperCase()))) continue;
    if (bills.some((b) => b.active && b.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({
      key,
      name,
      amount: round2(avg),
      frequency,
      lastDate: last.date,
      count: list.length,
      category: last.category,
      dueDay: Number(last.date.slice(8, 10)),
      pattern: name.toUpperCase().split(' ').slice(0, 2).join(' '),
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Does a transaction look like a payment of this bill? */
export function matchesBill(t: Transaction, b: Bill): boolean {
  if (t.amount >= 0) return false;
  const pat = (b.matchPattern || b.name).toUpperCase();
  return pat.length >= 3 && t.description.toUpperCase().includes(pat);
}
