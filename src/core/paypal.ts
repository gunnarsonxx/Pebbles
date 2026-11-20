// PayPal and your bank both report a PayPal purchase: PayPal with the store's name, your bank as
// "PAYPAL *STORE" or "PAYPAL INST XFER". Count it once, on the PayPal side, where the details are.
import { diffDays } from './dates';
import type { Account, Transaction } from './types';

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
