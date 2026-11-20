import { describe, expect, it } from 'vitest';
import { dedupePaypal, paypalFundingAccount, paypalInFlight, withInFlight } from './paypal';
import type { Account, Transaction } from './types';

const acct = (id: string, name: string, available: number): Account => ({ id, name, institution: name.split(' ')[0], type: 'checking', balance: available, available, source: 'plaid' });
const spend = acct('spend', 'USAA Spending Account', 20);
const bills = acct('bills', 'USAA Bills Account', 344.08);
const pp: Account = { id: 'pp', name: 'PayPal', institution: 'PayPal', type: 'other', source: 'plaid' };
const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), accountId: 'pp', date: '2026-11-20', description: '', merchant: '', amount: 0, category: 'shopping', importId: null, excluded: false, note: '', ...p });

describe('PayPal purchases the bank balance doesn’t show yet', () => {
  const steam = tx({ id: 'steam', description: 'Payment to Valve Corporation', merchant: 'Steam', amount: -15.99, category: 'entertainment' });
  const accounts = [spend, bills, pp];
  it('takes a fresh PayPal purchase off the account PayPal pulls from', () => {
    const f = paypalInFlight([steam], accounts, spend, '2026-11-20')!;
    expect(f).toMatchObject({ accountId: 'spend', amount: 15.99 });
    const adj = withInFlight(accounts, f);
    expect(adj.find((a) => a.id === 'spend')?.available).toBe(4.01);
    expect(adj.find((a) => a.id === 'bills')?.available).toBe(344.08);
  });
  it('stops once the bank’s own PAYPAL line is in, and ignores money moved into PayPal', () => {
    const bank = tx({ id: 'b1', accountId: 'spend', description: 'PAYPAL *VALVE', amount: -15.99 });
    const ups = dedupePaypal([steam, bank], accounts);
    const after = [steam, { ...bank, ...ups.find((u) => u.id === 'b1')!.patch }];
    expect(paypalInFlight(after, accounts, spend, '2026-11-21')).toBeNull();
    const topUp = tx({ description: 'Transfer from bank', amount: -50 });
    expect(paypalInFlight([topUp], accounts, spend, '2026-11-20')).toBeNull();
    expect(paypalInFlight([steam], accounts, spend, '2026-11-30')).toBeNull(); // over a week old
  });
  it('learns which account pays PayPal, and respects your pick', () => {
    const history = [tx({ accountId: 'spend', description: 'PAYPAL INST XFER', amount: -9 }), tx({ accountId: 'spend', description: 'PAYPAL *X', amount: -3 })];
    expect(paypalFundingAccount(accounts, history, null, bills)?.id).toBe('spend');
    expect(paypalFundingAccount(accounts, [], null, bills)?.id).toBe('bills');
    expect(paypalFundingAccount(accounts, history, 'bills', null)?.id).toBe('bills');
    expect(paypalFundingAccount(accounts, history, 'paypal-balance', bills)).toBeNull();
  });
});

describe('the bank updates its balance before its PayPal line comes through', async () => {
  const { bankHasIt, knownTotal } = await import('./paypal');
  const usaa = { id: 'spend', name: 'Spending', type: 'checking' as const, available: 100, balance: 100, source: 'plaid' as const };
  const lunch = tx({ id: 'lunch', accountId: 'spend', description: 'TACO BELL', amount: -8, date: '2026-11-20' });
  const steam = tx({ id: 'steam', description: 'Payment to Valve', merchant: 'Steam', amount: -15.99, date: '2026-11-20' });
  const seen = { accountId: 'spend', available: 100, known: knownTotal([lunch], 'spend') };
  it('still out when the balance hasn’t moved', () => {
    expect(bankHasIt({ ...steam, seenBank: seen }, [lunch], usaa)).toBe(false);
  });
  it('taken out once the balance drops by the purchase, even with no PAYPAL line yet', () => {
    expect(bankHasIt({ ...steam, seenBank: seen }, [lunch], { ...usaa, available: 84.01 })).toBe(true);
  });
  it('a drop the bank’s own transactions explain doesn’t count', () => {
    const gas = tx({ id: 'gas', accountId: 'spend', description: 'SHELL', amount: -40, date: '2026-11-21' });
    expect(bankHasIt({ ...steam, seenBank: seen }, [lunch, gas], { ...usaa, available: 60 })).toBe(false);
    expect(bankHasIt({ ...steam, seenBank: seen }, [lunch, gas], { ...usaa, available: 44.01 })).toBe(true);
  });
  it('a pending bank line for the same amount counts, whatever it’s called', () => {
    const pending = tx({ id: 'p1', accountId: 'spend', description: 'VALVE CORP', amount: -15.99, date: '2026-11-20', pending: true });
    expect(bankHasIt(steam, [pending], usaa)).toBe(true);
  });
});
