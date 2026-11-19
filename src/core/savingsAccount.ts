// High-yield savings (e.g. Marcus): interest projections and keeping goals in step
// with the real account.
import { round2 } from './money';
import type { Account, Contribution, Goal, ISODate, Transaction } from './types';

/** Monthly growth rate from an APY (interest compounds daily, so APY already includes it). */
export function monthlyRate(apyPct: number): number {
  return Math.pow(1 + apyPct / 100, 1 / 12) - 1;
}

export function interestNextMonth(balance: number, apyPct: number | null | undefined): number {
  if (!apyPct || balance <= 0) return 0;
  return round2(balance * monthlyRate(apyPct));
}

export interface ProjectionPoint {
  month: number; // 0 = now
  balance: number;
  interestTotal: number;
}

/** Balance over the next months with regular deposits (deposits land mid-month on average). */
export function projectSavings(balance: number, apyPct: number, monthlyDeposit: number, months = 12): ProjectionPoint[] {
  const r = monthlyRate(apyPct || 0);
  const pts: ProjectionPoint[] = [{ month: 0, balance: round2(balance), interestTotal: 0 }];
  let b = balance;
  let interest = 0;
  for (let m = 1; m <= months; m++) {
    const i = b * r + monthlyDeposit * (r / 2);
    interest += i;
    b += i + monthlyDeposit;
    pts.push({ month: m, balance: round2(b), interestTotal: round2(interest) });
  }
  return pts;
}

export function goalsAccount(accounts: Account[]): Account | null {
  return (
    accounts.find((a) => a.holdsGoals) ??
    accounts.find((a) => a.type === 'savings' && /marcus|goldman/i.test(`${a.name} ${a.institution ?? ''}`)) ??
    null
  );
}

/** Split an amount across goals in proportion to what each holds (equally if all empty). */
export function splitAcrossGoals(amount: number, goals: Goal[], balances: Map<string, number>): { goalId: string; amount: number }[] {
  const active = goals.filter((g) => !g.archived);
  if (!active.length || Math.abs(amount) < 0.005) return [];
  const total = active.reduce((s, g) => s + Math.max(0, balances.get(g.id) ?? 0), 0);
  const raw = active.map((g) => ({ goalId: g.id, amount: total > 0 ? (amount * Math.max(0, balances.get(g.id) ?? 0)) / total : amount / active.length }));
  // round to cents, keeping the exact total
  const out = raw.map((r) => ({ ...r, amount: Math.floor(r.amount * 100) / 100 }));
  let left = Math.round((amount - out.reduce((s, r) => s + r.amount, 0)) * 100);
  for (const r of out.sort((a, b) => b.amount - a.amount)) {
    if (left <= 0) break;
    r.amount = round2(r.amount + 0.01);
    left--;
  }
  return out.filter((r) => Math.abs(r.amount) >= 0.01);
}

export function isInterest(t: Transaction): boolean {
  return t.amount > 0 && /INTEREST|DIVIDEND/i.test(t.description);
}

/** Interest paid into the goals account becomes pebbles in your goals (once per payment). */
export function interestContributions(
  txns: Transaction[],
  account: Account | null,
  goals: Goal[],
  contributions: Contribution[],
  balances: Map<string, number>,
): Contribution[] {
  if (!account) return [];
  const done = new Set(contributions.filter((c) => c.kind === 'interest').map((c) => c.id.split('|')[1]));
  const out: Contribution[] = [];
  for (const t of txns) {
    if (t.accountId !== account.id || !isInterest(t) || t.pending || done.has(t.id)) continue;
    for (const s of splitAcrossGoals(t.amount, goals, balances)) {
      out.push({ id: `int|${t.id}|${s.goalId}`, goalId: s.goalId, amount: s.amount, date: t.date, note: 'Interest earned', paycheckId: null, kind: 'interest' });
    }
  }
  return out;
}

export interface Reconcile {
  bank: number;
  goals: number;
  difference: number; // + means the bank holds more than your goals track
  asOf: ISODate | null;
}

export function reconcile(account: Account | null, goalsTotal: number): Reconcile | null {
  if (!account || account.balance == null) return null;
  return { bank: account.balance, goals: round2(goalsTotal), difference: round2(account.balance - goalsTotal), asOf: account.balanceDate ?? null };
}

/** Pull "Annual Percentage Yield Earned 3.65%" or "APY 3.65%" out of a statement. */
export function apyFromText(lines: string[]): number | null {
  const text = lines.join(' ');
  const m = text.match(/(?:annual percentage yield(?: earned)?|APY)[^0-9]{0,30}(\d{1,2}\.\d{1,3})\s*%/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return v > 0 && v < 20 ? v : null;
}
