// Two accounts, two jobs:
//  • the Bills account is only for bills. It has to cover what's due before the next check, and the
//    next check has to top it up for everything due before the check after that.
//  • the Spending account is for everything else: what's in it, minus groceries and gas until
//    payday, is what's yours. Bills money is never counted as spending money.
import { billDueDates, roommateTransfer, yourAmount } from './budget';
import { matchesBill } from './analytics';
import { addDays, diffDays } from './dates';
import { round2 } from './money';
import type { Account, Bill, ISODate, Transaction } from './types';

export interface DueBill {
  bill: Bill;
  date: ISODate;
  amount: number; // what leaves your account (the roommate transfer for rent, the full bill when you cover their share)
  paid: boolean; // already seen leaving your account
  beforePayday: boolean; // due before the next check lands
}

export interface BillsCoverage {
  account: Account;
  balance: number;
  asOf: ISODate | null;
  bills: DueBill[]; // due from today through the day before the following payday
  dueBeforePayday: number; // unpaid, due before the next check
  dueNextCycle: number; // unpaid, due from the next check until the one after
  shortNow: number; // bills before payday the account can't cover right now
  topUp: number; // move this into the Bills account from the next check (rounded up to $5)
  extra: number; // what's left over after everything through the following payday
  status: 'ok' | 'topup' | 'short';
  steady?: SteadyPlan | null; // when you put the same amount in every check
}

export interface SpendingCoverage {
  account: Account;
  balance: number;
  asOf: ISODate | null;
  living: number; // groceries, gas and basics until payday
  days: number;
  left: number;
  status: 'ok' | 'tight' | 'short';
}

export interface Coverage {
  nextPayday: ISODate;
  followingPayday: ISODate;
  bills: BillsCoverage | null;
  spending: SpendingCoverage | null;
}

const isPaypal = (a: Account) => /paypal/i.test(`${a.name} ${a.institution ?? ''}`);
const usable = (a: Account) => (a.available ?? a.balance) != null;

/** The account bills come out of: your pick, else a checking account named for bills, else the fullest checking account. */
export function billsAccount(accounts: Account[], chosenId: string | null | undefined): Account | null {
  const chosen = chosenId ? accounts.find((a) => a.id === chosenId) : null;
  if (chosen) return chosen;
  const checking = accounts.filter((a) => a.type === 'checking' && !a.holdsGoals && !isPaypal(a) && usable(a));
  return checking.find((a) => /bill/i.test(a.name)) ?? checking.sort((a, b) => (b.available ?? b.balance ?? 0) - (a.available ?? a.balance ?? 0))[0] ?? null;
}

/** The account everyday spending comes out of: your pick, else a checking account named for spending. */
export function spendingAccount(accounts: Account[], chosenId: string | null | undefined, bills: Account | null): Account | null {
  const chosen = chosenId ? accounts.find((a) => a.id === chosenId) : null;
  if (chosen) return chosen;
  const checking = accounts.filter((a) => a.type === 'checking' && !a.holdsGoals && !isPaypal(a) && usable(a) && a.id !== bills?.id);
  return checking.find((a) => /spend|everyday|fun/i.test(a.name)) ?? (checking.length === 1 ? checking[0] : null);
}

/** What actually leaves your account for a bill. */
export function cashAmount(b: Bill, bills: Bill[]): number {
  if (b.toRoommate) {
    const rm = roommateTransfer(bills);
    const to = bills.filter((x) => x.active && x.toRoommate);
    // their share of split bills comes off what you send them (spread over rent-type bills)
    const credit = rm ? rm.rent - rm.send : 0;
    const total = to.reduce((s, x) => s + x.amount, 0) || 1;
    return round2(Math.max(0, b.amount - (credit * b.amount) / total));
  }
  if (b.yourSharePct != null && b.yourSharePct < 100) return b.fromRent ? b.amount : yourAmount(b);
  return b.amount;
}

// ---------------- the same amount every check ----------------

export interface SteadyPlan {
  perCheck: number; // put this in the Bills account every payday
  average: number; // the bills' true average per check over the year
  lowest: number; // the lowest the account gets over the next 12 months, putting in perCheck each payday (at least the cushion)
  lowestDate: ISODate | null;
  shortNow: number; // due before the first payday and not covered: has to be moved now
  horizon: ISODate;
  checks: number;
}

/**
 * One steady amount per paycheck that pays every bill in full and on time.
 * Plays out the next 12 months day by day (each bill on its due date, the deposit on each payday) and
 * takes the smallest amount, rounded up to $5, at which the account never goes below zero, and never
 * less than the bills' real average per check, so it doesn't fall behind over the year.
 */
export function steadyBillsPlan(opts: { balance: number; bills: Bill[]; txns: Transaction[]; today: ISODate; paydays: ISODate[]; cushion?: number }): SteadyPlan {
  // never run the account right down to zero: a bill that comes in higher (utilities) still clears
  const cushion = opts.cushion ?? 50;
  const { bills, txns, today } = opts;
  const paydays = opts.paydays.filter((p) => p >= today).sort();
  const horizon = paydays.length ? addDays(paydays[0], 365) : addDays(today, 365);
  const inYear = paydays.filter((p) => p < horizon);
  const events: { date: ISODate; amount: number }[] = [];
  for (const b of bills.filter((x) => x.active)) {
    for (const d of billDueDates(b, today, horizon)) {
      const paid = d <= addDays(today, 10) && txns.some((t) => t.date >= addDays(d, -10) && t.date <= today && matchesBill(t, b));
      if (!paid) events.push({ date: d, amount: cashAmount(b, bills) });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  // deposits made on or before a date (a payday's deposit is there before that day's bills)
  const depositsBy = (d: ISODate) => inYear.filter((p) => p <= d).length;
  let cum = 0;
  let shortNow = 0;
  let need = 0;
  for (const e of events) {
    cum += e.amount;
    const n = depositsBy(e.date);
    if (n === 0) shortNow = Math.max(shortNow, cum - opts.balance);
  }
  const start = opts.balance + Math.max(0, shortNow);
  cum = 0;
  for (const e of events) {
    cum += e.amount;
    const n = depositsBy(e.date);
    if (n > 0) need = Math.max(need, (cum - (start - cushion)) / n);
  }
  const yearBills = events.reduce((s2, e) => s2 + e.amount, 0);
  const average = inYear.length ? yearBills / inYear.length : 0;
  const perCheck = Math.ceil(Math.max(need, average, 0) / 5) * 5;
  // the lowest point with that amount
  let bal = start;
  let lowest = start;
  let lowestDate: ISODate | null = null;
  let pi = 0;
  for (const e of events) {
    while (pi < inYear.length && inYear[pi] <= e.date) {
      bal += perCheck;
      pi++;
    }
    bal -= e.amount;
    if (bal < lowest) {
      lowest = bal;
      lowestDate = e.date;
    }
  }
  return { perCheck, average: Math.round(average * 100) / 100, lowest: Math.round(lowest * 100) / 100, lowestDate, shortNow: Math.round(Math.max(0, shortNow) * 100) / 100, horizon, checks: inYear.length };
}

export function coverage(opts: {
  billsAccount: Account | null;
  spendingAccount: Account | null;
  bills: Bill[];
  txns: Transaction[];
  today: ISODate;
  nextPayday: ISODate;
  followingPayday: ISODate;
  essentialsMonthly: number;
}): Coverage {
  const { bills, txns, today, nextPayday, followingPayday } = opts;
  const out: Coverage = { nextPayday, followingPayday, bills: null, spending: null };

  const ba = opts.billsAccount;
  const bBal = ba ? (ba.available ?? ba.balance) : null;
  if (ba && bBal != null) {
    const due: DueBill[] = [];
    for (const b of bills.filter((x) => x.active)) {
      for (const d of billDueDates(b, today, followingPayday)) {
        // paid already? a matching payment in the 10 days before it's due, up to today
        const paid = txns.some((t) => t.date >= addDays(d, -10) && t.date <= today && matchesBill(t, b));
        due.push({ bill: b, date: d, amount: cashAmount(b, bills), paid, beforePayday: d < nextPayday });
      }
    }
    due.sort((a, b) => a.date.localeCompare(b.date));
    const sum = (xs: DueBill[]) => round2(xs.filter((x) => !x.paid).reduce((s, x) => s + x.amount, 0));
    const dueBeforePayday = sum(due.filter((x) => x.beforePayday));
    const dueNextCycle = sum(due.filter((x) => !x.beforePayday));
    const shortNow = round2(Math.max(0, dueBeforePayday - bBal));
    const need = dueBeforePayday + dueNextCycle - bBal;
    const topUp = need > 0 ? Math.ceil((need - shortNow) / 5) * 5 : 0;
    out.bills = {
      account: ba,
      balance: bBal,
      asOf: ba.balanceDate ?? null,
      bills: due,
      dueBeforePayday,
      dueNextCycle,
      shortNow,
      topUp,
      extra: round2(Math.max(0, -need)),
      status: shortNow > 0 ? 'short' : topUp > 0 ? 'topup' : 'ok',
    };
  }

  const sa = opts.spendingAccount;
  const sBal = sa ? (sa.available ?? sa.balance) : null;
  if (sa && sBal != null && sa.id !== ba?.id) {
    const days = Math.max(0, diffDays(nextPayday, today));
    const living = round2((opts.essentialsMonthly * days) / 30.4);
    const left = round2(sBal - living);
    out.spending = {
      account: sa,
      balance: sBal,
      asOf: sa.balanceDate ?? null,
      living,
      days,
      left,
      status: left < 0 ? 'short' : left < Math.max(25, living * 0.25) ? 'tight' : 'ok',
    };
  }
  return out;
}
