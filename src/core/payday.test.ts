import { describe, expect, it } from 'vitest';
import { findPaycheckDeposit } from './moves';
import { nextUnpaidPeriod, periodContaining } from './pay';
import { defaultSettings } from './defaults';
import type { Transaction } from './types';

const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), accountId: 'chk', date: '2026-11-20', amount: 1450, description: 'X', category: 'other', ...p }) as Transaction;

describe('recognizing the paycheck deposit', () => {
  it('finds an early, still-pending payroll deposit the bank did not label as a paycheck', () => {
    const d = findPaycheckDeposit([tx({ date: '2026-11-19', pending: true, description: 'ACME CORP PAYROLL PPD' })], '2026-11-20', 1452);
    expect(d?.description).toMatch(/PAYROLL/);
  });
  it('knows the payer from an earlier paycheck', () => {
    const txns = [tx({ date: '2026-11-06', category: 'paycheck', description: 'ACME CORP 1234' }), tx({ date: '2026-11-20', description: 'ACME CORP 5678' })];
    expect(findPaycheckDeposit(txns, '2026-11-20', 1452)?.date).toBe('2026-11-20');
  });
  it('does not mistake a Zelle or a savings transfer for pay', () => {
    expect(findPaycheckDeposit([tx({ description: 'ZELLE FROM ROOMMATE DIR DEP' }), tx({ description: 'TRANSFER FROM MARCUS' })], '2026-11-20', 1452)).toBeNull();
  });
});

describe('which paycheck is next', () => {
  const pay = defaultSettings().pay; // payday is a Friday
  const p = periodContaining(pay, '2026-11-20');
  const payday = p.payday > '2026-11-20' ? p.payday : nextUnpaidPeriod(pay, '2026-11-20', () => false).payday;
  it('stays on payday’s check until it arrives, then moves on', () => {
    const before = nextUnpaidPeriod(pay, payday, () => false);
    expect(before.payday).toBe(payday);
    const paid = nextUnpaidPeriod(pay, payday, (s) => s === before.start);
    expect(paid.payday > payday).toBe(true);
  });
  it('moves on when the deposit lands a day early', () => {
    const dayBefore = new Date(Date.parse(payday) - 86_400_000).toISOString().slice(0, 10);
    const up = nextUnpaidPeriod(pay, dayBefore, () => false);
    expect(nextUnpaidPeriod(pay, dayBefore, (s) => s === up.start).payday > payday).toBe(true);
  });
  it('moves on at midnight after payday even without a deposit', () => {
    const dayAfter = new Date(Date.parse(payday) + 86_400_000).toISOString().slice(0, 10);
    expect(nextUnpaidPeriod(pay, dayAfter, () => false).payday > payday).toBe(true);
  });
});
