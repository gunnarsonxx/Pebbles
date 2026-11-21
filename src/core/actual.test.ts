import { describe, expect, it } from 'vitest';
import { actualSplit } from './actual';
import type { Transaction } from './types';

const t = (accountId: string, date: string, amount: number, description = 'TRANSFER'): Transaction => ({
  id: Math.random().toString(36),
  accountId,
  date,
  description,
  merchant: '',
  amount,
  category: 'transfer',
  importId: null,
  excluded: true,
  note: '',
});

describe('what actually happened with a check', () => {
  it('counts money that landed in the Bills account and savings between paydays', () => {
    const txns = [
      t('bills', '2026-11-20', 480),
      t('bills', '2026-11-25', 20),
      t('bills', '2026-11-20', 1500, 'ACME PAYROLL PPD'), // a paycheck isn't a transfer from it
      t('sav', '2026-11-21', 300),
      t('sav', '2026-11-30', 0.74, 'INTEREST PAID'),
      t('sav', '2026-12-10', 200), // next period
    ];
    const a = actualSplit({ txns, payday: '2026-11-20', nextPayday: '2026-12-04', billsAccountId: 'bills', savingsAccountId: 'sav', net: 1452.34 });
    expect(a.bills).toBe(500);
    expect(a.savings).toBe(300);
    expect(a.you).toBe(652.34);
  });
});
