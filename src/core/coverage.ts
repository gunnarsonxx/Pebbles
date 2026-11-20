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
