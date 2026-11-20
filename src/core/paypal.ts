// PayPal and your bank both report a PayPal purchase: PayPal with the store's name, your bank as
// "PAYPAL *STORE" or "PAYPAL INST XFER". Count it once, on the PayPal side, where the details are.
import { diffDays } from './dates';
import type { Account, ISODate, Transaction } from './types';

export const isPaypalAccount = (a: Account) => /paypal/i.test(`${a.name} ${a.institution ?? ''}`);
const BANK_PAYPAL = /PAYPAL|PP\*|PYPL/i;
// money moving into PayPal from your bank shows up in PayPal as a deposit: not income
const FUNDING = /bank|transfer|funding|add(ed)? money|deposit|from (checking|savings|usaa)|top.?up/i;

export interface PaypalUpdate {
  id: string;
  patch: Partial<Transaction>;
}

export function dedupePaypal(txns: Transaction[], accounts: Account[]): PaypalUpdate[] {
  const ppIds = new Set(accounts.filter(isPaypalAccount).map((a) => a.id));
  if (!ppIds.size) return [];
  const out: PaypalUpdate[] = [];
  const pp = txns.filter((t) => ppIds.has(t.accountId));
  const used = new Set(txns.filter((t) => t.dupOf).map((t) => t.dupOf as string));

  // bank lines that paid for a PayPal purchase
  const bank = txns
    .filter((t) => !ppIds.has(t.accountId) && t.amount < 0 && !t.dupOf && BANK_PAYPAL.test(t.description))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const b of bank) {
    const match = pp
      .filter((p) => p.amount < 0 && !used.has(p.id) && Math.abs(p.amount - b.amount) <= 0.01)
      .map((p) => ({ p, gap: diffDays(b.date, p.date) }))
      .filter((x) => x.gap >= -2 && x.gap <= 10)
      .sort((x, y) => Math.abs(x.gap) - Math.abs(y.gap))[0];
    if (!match) continue;
    used.add(match.p.id);
    out.push({ id: b.id, patch: { dupOf: match.p.id, excluded: true, note: b.note || `Paid through PayPal: counted as ${match.p.merchant || 'the PayPal purchase'}` } });
  }

  // PayPal's "money in from your bank" lines are transfers, not income
  for (const p of pp) {
    if (p.amount > 0 && !p.excluded && FUNDING.test(`${p.description} ${p.merchant}`)) out.push({ id: p.id, patch: { excluded: true, note: p.note || 'Money moved into PayPal from your bank' } });
  }
  return out;
}

// ---------- PayPal purchases your bank hasn't caught up with ----------
// PayPal reports a purchase right away; your bank's balance (through Plaid) can lag a day or more.
// Until the bank's own PAYPAL line shows up, the purchase is "in flight": take it off the funding account.

export interface InFlight {
  accountId: string; // the bank account PayPal pulls from
  amount: number; // total still to come out (positive)
  txns: Transaction[];
}

/** The bank account PayPal pulls from: your pick, else the one that has paid PayPal most, else the fallback. */
export function paypalFundingAccount(accounts: Account[], txns: Transaction[], chosenId: string | null | undefined, fallback: Account | null): Account | null {
  if (chosenId === 'paypal-balance') return null;
  const chosen = chosenId ? accounts.find((a) => a.id === chosenId) : null;
  if (chosen) return chosen;
  const counts = new Map<string, number>();
  for (const t of txns) if (t.dupOf || (t.amount < 0 && BANK_PAYPAL.test(t.description))) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
  const ranked = accounts.filter((a) => !isPaypalAccount(a) && a.type === 'checking' && counts.has(a.id)).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  return ranked[0] ?? fallback;
}

/** The sum of every transaction Pebbles has for an account (to tell balance moves it can explain from ones it can't). */
export const knownTotal = (txns: Transaction[], accountId: string) => Math.round(txns.filter((t) => t.accountId === accountId).reduce((s, t) => s + t.amount, 0) * 100) / 100;

/** PayPal purchases not yet tied to the bank: the ones to snapshot the bank's balance for. */
export function paypalPurchases(txns: Transaction[], accounts: Account[], today: string): Transaction[] {
  const ppIds = new Set(accounts.filter(isPaypalAccount).map((a) => a.id));
  return txns.filter((t) => ppIds.has(t.accountId) && t.amount < 0 && !FUNDING.test(`${t.description} ${t.merchant}`) && diffDays(today, t.date) <= 7 && diffDays(today, t.date) >= 0);
}

/**
 * Has the bank already taken this PayPal purchase out? Yes when:
 *  - the bank's own line for it is in (pending or posted, same amount, within a few days), or
 *  - the bank's balance has dropped by the amount since Pebbles first saw the purchase, beyond what the
 *    bank transactions Pebbles knows about explain (the balance updates before the line comes through).
 */
export function bankHasIt(p: Transaction, txns: Transaction[], funding: Account): boolean {
  if (p.bankHas || txns.some((t) => t.dupOf === p.id)) return true;
  const line = txns.some(
    (t) => t.accountId === funding.id && Math.abs(t.amount - p.amount) <= 0.01 && diffDays(t.date, p.date) >= -2 && diffDays(t.date, p.date) <= 10 && (BANK_PAYPAL.test(`${t.description} ${t.merchant}`) || t.pending),
  );
  if (line) return true;
  const seen = p.seenBank;
  const now = funding.available ?? funding.balance;
  if (!seen || seen.accountId !== funding.id || now == null) return false;
  const unexplained = now - seen.available - (knownTotal(txns, funding.id) - seen.known);
  return unexplained <= p.amount + 0.01; // dropped by at least the purchase (p.amount is negative)
}

export function paypalInFlight(txns: Transaction[], accounts: Account[], funding: Account | null, today: string): InFlight | null {
  if (!funding) return null;
  const ppIds = new Set(accounts.filter(isPaypalAccount).map((a) => a.id));
  if (!ppIds.size) return null;
  // past a week the bank has surely posted it (or PayPal used its own balance)
  const open = paypalPurchases(txns, accounts, today).filter((t) => !bankHasIt(t, txns, funding));
  if (!open.length) return null;
  return { accountId: funding.id, amount: Math.round(open.reduce((s, t) => s - t.amount, 0) * 100) / 100, txns: open };
}

/** Accounts with in-flight PayPal purchases taken off (for planning only; never saved). */
export function withInFlight(accounts: Account[], f: InFlight | null): Account[] {
  if (!f) return accounts;
  return accounts.map((a) =>
    a.id !== f.accountId
      ? a
      : {
          ...a,
          balance: a.balance != null ? Math.round((a.balance - f.amount) * 100) / 100 : a.balance,
          available: a.available != null ? Math.round((a.available - f.amount) * 100) / 100 : a.available,
        },
  );
}

/** A record of the paying account's balance over time (newest last). */
export interface BalancePoint {
  at: number;
  date: ISODate;
  available: number;
  known: number; // sum of its transactions Pebbles had at the time
}

/**
 * The balance to compare against for a PayPal purchase: the last one recorded before the purchase's day, so
 * a bank that had already taken it out when Pebbles first saw it is still caught. Falls back to now.
 */
export function balanceBefore(history: BalancePoint[], date: ISODate): BalancePoint | null {
  const before = history.filter((h) => h.date < date);
  return before.length ? before[before.length - 1] : null;
}
