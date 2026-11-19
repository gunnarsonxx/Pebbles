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

// ---------------- keeping goals equal to the real savings account ----------------
// The bank is the source of truth: every deposit into the goals account is split across goals the
// way that paycheck's plan split it, withdrawals come out of goals, and anything else (money saved
// before Pebbles, a deposit Pebbles hasn't seen yet) is spread so the goals always add up to the
// balance. Contribution ids are deterministic so phone and computer agree.

export interface Weight {
  goalId: string;
  w: number;
}

/** Split an amount by weights, to the cent, keeping the exact total. */
export function splitByWeights(amount: number, weights: Weight[]): { goalId: string; amount: number }[] {
  const pos = weights.filter((x) => x.w > 0);
  const total = pos.reduce((s, x) => s + x.w, 0);
  if (!pos.length || total <= 0 || Math.abs(amount) < 0.005) return [];
  const cents = Math.round(amount * 100);
  const raw = pos.map((x) => ({ goalId: x.goalId, c: Math.trunc((cents * x.w) / total) }));
  let left = cents - raw.reduce((s, r) => s + r.c, 0);
  const step = left > 0 ? 1 : -1;
  for (let i = 0; left !== 0; i = (i + 1) % raw.length) {
    raw[i].c += step;
    left -= step;
  }
  return raw.filter((r) => r.c !== 0).map((r) => ({ goalId: r.goalId, amount: r.c / 100 }));
}

export interface GoalSyncInput {
  account: Account;
  txns: Transaction[];
  goals: Goal[];
  contributions: Contribution[];
  since: ISODate; // deposits from this date on are split one by one; earlier money is the starting balance
  planWeights: Weight[]; // how the current plan splits savings
  /** The paycheck a deposit on `date` belongs to, with how its savings were split. */
  paycheckFor: (date: ISODate) => { periodStart: string; weights: Weight[] } | null;
}

export interface GoalSyncResult {
  put: Contribution[];
  remove: string[];
}

const isBankAdj = (c: Contribution, acctId: string) => c.id.startsWith(`bank|${acctId}|`);

export function syncGoalsWithAccount(i: GoalSyncInput): GoalSyncResult {
  const { account, goals } = i;
  const put: Contribution[] = [];
  const remove = new Set<string>();
  const active = goals.filter((g) => !g.archived);
  if (!active.length) return { put, remove: [] };
  const activeIds = new Set(active.map((g) => g.id));
  let contribs = i.contributions.slice();
  const balanceOf = (goalId: string) => round2(contribs.filter((c) => c.goalId === goalId && !remove.has(c.id)).reduce((s, c) => s + c.amount, 0));
  const equal = active.filter((g) => !g.completedAt).map((g) => ({ goalId: g.id, w: 1 }));
  const fallback = (w: Weight[]) => (w.some((x) => x.w > 0 && activeIds.has(x.goalId)) ? w.filter((x) => activeIds.has(x.goalId)) : equal.length ? equal : active.map((g) => ({ goalId: g.id, w: 1 })));
  const add = (c: Contribution) => {
    put.push(c);
    contribs.push(c);
  };

  const seen = (prefix: string) => contribs.some((c) => c.id.startsWith(prefix) && !remove.has(c.id));
  const mine = i.txns
    .filter((t) => t.accountId === account.id && !t.pending && t.date >= i.since && !isInterest(t))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  for (const t of mine) {
    if (t.amount > 0) {
      if (seen(`dep|${t.id}|`)) continue;
      const pc = i.paycheckFor(t.date);
      let weights = fallback(i.planWeights);
      if (pc) {
        // you already checked off "moved to savings" for this paycheck: use the real amount instead
        const manual = contribs.filter((c) => c.id.startsWith(`pc|${pc.periodStart}|`) && !remove.has(c.id));
        if (manual.length) {
          weights = manual.map((c) => ({ goalId: c.goalId, w: c.amount }));
          manual.forEach((c) => remove.add(c.id));
        } else if (pc.weights.some((x) => x.w > 0)) weights = fallback(pc.weights);
      }
      for (const s of splitByWeights(t.amount, weights))
        add({ id: `dep|${t.id}|${s.goalId}`, goalId: s.goalId, amount: s.amount, date: t.date, note: `Moved to ${account.name}`, paycheckId: pc?.periodStart ?? null, kind: 'deposit' });
    } else if (t.amount < 0) {
      if (seen(`wd|${t.id}|`)) continue;
      const out = -t.amount;
      // a finished goal holding about this much: you bought the thing
      const match = active.find((g) => g.completedAt && Math.abs(balanceOf(g.id) - out) <= Math.max(5, out * 0.1));
      const weights = match ? [{ goalId: match.id, w: 1 }] : active.map((g) => ({ goalId: g.id, w: Math.max(0, balanceOf(g.id)) }));
      for (const s of splitByWeights(-out, weights.some((x) => x.w > 0) ? weights : fallback(i.planWeights)))
        add({ id: `wd|${t.id}|${s.goalId}`, goalId: s.goalId, amount: s.amount, date: t.date, note: `Taken out of ${account.name}`, paycheckId: null, kind: 'withdrawal' });
    }
  }

  // whatever's left over keeps goals equal to the balance
  if (account.balance != null) {
    contribs = contribs.filter((c) => !remove.has(c.id));
    const tracked = contribs.filter((c) => !isBankAdj(c, account.id)).reduce((s, c) => s + c.amount, 0);
    const residual = round2(account.balance - tracked);
    const existing = contribs.filter((c) => isBankAdj(c, account.id) && activeIds.has(c.goalId));
    // only the change since last time gets spread, so a split you set by hand stays put
    const delta = round2(residual - existing.reduce((x, c) => x + c.amount, 0));
    const desired = new Map(existing.map((c) => [c.goalId, c.amount]));
    if (Math.abs(delta) >= 0.005) {
      const byBalance = active.map((g) => ({ goalId: g.id, w: Math.max(0, balanceOf(g.id)) }));
      const weights = delta < 0 && byBalance.some((x) => x.w > 0) ? byBalance : fallback(i.planWeights);
      for (const sp of splitByWeights(delta, weights)) desired.set(sp.goalId, round2((desired.get(sp.goalId) ?? 0) + sp.amount));
    }
    const day = account.balanceDate ?? i.since;
    for (const g of active) {
      const id = `bank|${account.id}|${g.id}`;
      const cur = contribs.find((c) => c.id === id);
      const want = desired.get(g.id) ?? 0;
      if (Math.abs(want) < 0.005) {
        if (cur) remove.add(id);
      } else if (!cur || Math.abs(cur.amount - want) >= 0.005) {
        put.push({ id, goalId: g.id, amount: want, date: cur?.date ?? day, note: `Already in ${account.name}`, paycheckId: null, kind: want >= 0 ? 'deposit' : 'withdrawal' });
      }
    }
    for (const c of contribs) if (isBankAdj(c, account.id) && !activeIds.has(c.goalId)) remove.add(c.id);
  }
  return { put, remove: [...remove] };
}

/** Set exactly how much of the account each goal holds (writes the leftover adjustments). */
export function setGoalSplit(account: Account, wanted: Map<string, number>, contributions: Contribution[], date: ISODate): Contribution[] {
  return [...wanted.entries()].map(([goalId, amount]) => {
    const others = contributions.filter((c) => c.goalId === goalId && !isBankAdj(c, account.id)).reduce((s, c) => s + c.amount, 0);
    const adj = round2(amount - others);
    return { id: `bank|${account.id}|${goalId}`, goalId, amount: adj, date, note: `Already in ${account.name}`, paycheckId: null, kind: adj >= 0 ? ('deposit' as const) : ('withdrawal' as const) };
  });
}
