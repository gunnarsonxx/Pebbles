// What really happened with a paycheck, read from your bank: what moved to the Bills account and to savings,
// and so what was left for you. Used to fill in (or correct) a past paycheck's plan.
import { addDays } from './dates';
import { round2 } from './money';
import type { ISODate, Transaction } from './types';

export interface ActualSplit {
  net: number | null; // the paycheck deposit, if found
  bills: number; // moved into the Bills account
  savings: number; // moved into savings (net of anything taken back out)
  you: number | null; // what stayed for groceries, gas, basics and fun
  found: { bills: Transaction[]; savings: Transaction[] };
}

const PAYCHECKISH = /PAYROLL|DIR(ECT)?\s*DEP|PAYCHECK|SALARY|\bPPD\b/i;

/**
 * From the day before payday until the day before the next one: money arriving in the Bills account and in your
 * savings account (other than interest and the paycheck itself) is what you moved there from this check.
 */
export function actualSplit(opts: { txns: Transaction[]; payday: ISODate; nextPayday: ISODate; billsAccountId: string | null; savingsAccountId: string | null; net: number | null }): ActualSplit {
  const from = addDays(opts.payday, -1);
  const to = addDays(opts.nextPayday, -1);
  const inWindow = (t: Transaction) => t.date >= from && t.date <= to;
  const bills = opts.billsAccountId
    ? opts.txns.filter((t) => t.accountId === opts.billsAccountId && t.amount > 0 && inWindow(t) && !PAYCHECKISH.test(t.description) && !/INTEREST/i.test(t.description))
    : [];
  const sav = opts.savingsAccountId ? opts.txns.filter((t) => t.accountId === opts.savingsAccountId && inWindow(t) && !/INTEREST/i.test(t.description)) : [];
  const billsTotal = round2(bills.reduce((s, t) => s + t.amount, 0));
  const savingsTotal = round2(
    Math.max(
      0,
      sav.reduce((s, t) => s + t.amount, 0),
    ),
  );
  return {
    net: opts.net,
    bills: billsTotal,
    savings: savingsTotal,
    you: opts.net != null ? round2(opts.net - billsTotal - savingsTotal) : null,
    found: { bills, savings: sav.filter((t) => t.amount > 0) },
  };
}
