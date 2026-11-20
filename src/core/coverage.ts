// "Will everything get paid before my next check?" What's in checking now, minus the bills due
// before payday (the amount that actually leaves the account), minus groceries and gas until then.
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
}

export interface Coverage {
  account: Account;
  balance: number;
  asOf: ISODate | null;
  bills: DueBill[];
  billsLeft: number; // still to pay before payday
  living: number; // groceries, gas and basics until payday
  days: number;
  left: number; // what's left for you after bills and needs
  status: 'ok' | 'tight' | 'short';
}

/** The checking account bills come out of: your pick, else the checking account with the most in it. */
export function billsAccount(accounts: Account[], chosenId: string | null | undefined): Account | null {
  const chosen = chosenId ? accounts.find((a) => a.id === chosenId) : null;
  if (chosen) return chosen;
  return (
    accounts
      .filter((a) => a.type === 'checking' && !a.holdsGoals && !/paypal/i.test(`${a.name} ${a.institution ?? ''}`) && (a.available ?? a.balance) != null)
      .sort((a, b) => (b.available ?? b.balance ?? 0) - (a.available ?? a.balance ?? 0))[0] ?? null
  );
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
  account: Account | null;
  bills: Bill[];
  txns: Transaction[];
  today: ISODate;
  nextPayday: ISODate;
  essentialsMonthly: number;
}): Coverage | null {
  const { account, bills, txns, today, nextPayday } = opts;
  if (!account) return null;
  const balance = account.available ?? account.balance;
  if (balance == null) return null;
  // bills due from today up to the day before your paycheck lands
  const due: DueBill[] = [];
  for (const b of bills.filter((x) => x.active)) {
    for (const d of billDueDates(b, today, nextPayday)) {
      // paid already? a matching payment in the 10 days before it's due, up to today
      const paid = txns.some((t) => t.date >= addDays(d, -10) && t.date <= today && matchesBill(t, b));
      due.push({ bill: b, date: d, amount: cashAmount(b, bills), paid });
    }
  }
  due.sort((a, b) => a.date.localeCompare(b.date));
  const billsLeft = round2(due.filter((x) => !x.paid).reduce((s, x) => s + x.amount, 0));
  const days = Math.max(0, diffDays(nextPayday, today));
  const living = round2((opts.essentialsMonthly * days) / 30.4);
  const left = round2(balance - billsLeft - living);
  const status: Coverage['status'] = left < 0 ? 'short' : left < Math.max(50, living * 0.25) ? 'tight' : 'ok';
  return { account, balance, asOf: account.balanceDate ?? null, bills: due, billsLeft, living, days, left, status };
}
