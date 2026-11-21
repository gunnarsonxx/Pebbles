import { describe, expect, it } from 'vitest';
import { duePrompts, looksVariable, nextPromptTime, postedAmount, promptDue, saveAmount, snooze } from './billPrompt';
import type { Bill } from './types';

const util: Bill = {
  id: 'u',
  name: 'Cos Utilit',
  amount: 175,
  dueDay: 28,
  dueMonth: null,
  anchorDate: null,
  frequency: 'monthly',
  category: 'utilities',
  autopay: false,
  active: true,
  matchPattern: 'COLORADO SPRINGS UTIL',
  amountReminder: { day: 9, time: '10:00' },
};
const at = (s: string) => new Date(s); // local time

describe('monthly amount prompt', () => {
  it('pops up from 10am on the 9th until answered', () => {
    expect(promptDue(util, at('2026-12-09T09:59:00'))).toBe(false);
    expect(promptDue(util, at('2026-12-09T10:00:00'))).toBe(true);
    expect(promptDue(util, at('2026-12-15T08:00:00'))).toBe(true); // missed it: still asks
    expect(duePrompts([util, { ...util, id: 'x', amountReminder: null }], at('2026-12-09T10:00:00'))).toHaveLength(1);
  });
  it('Not Posted waits 24 hours; saving the amount is done until next month', () => {
    const t = at('2026-12-09T10:05:00');
    const snoozed = snooze(util, t);
    expect(promptDue(snoozed, at('2026-12-10T10:00:00'))).toBe(false);
    expect(promptDue(snoozed, at('2026-12-10T10:05:00'))).toBe(true);
    expect(nextPromptTime(snoozed, t)?.getTime()).toBe(t.getTime() + 24 * 3_600_000);
    const saved = saveAmount(snoozed, 142.37, at('2026-12-10T10:06:00'));
    expect(saved.amount).toBe(142.37);
    expect(promptDue(saved, at('2026-12-20T12:00:00'))).toBe(false);
    expect(promptDue(saved, at('2027-01-09T10:00:00'))).toBe(true);
    expect(nextPromptTime(saved, at('2026-12-20T12:00:00'))?.getTime()).toBe(at('2027-01-09T10:00:00').getTime());
  });
  it('suggests what the bank shows, and spots utility bills', () => {
    const txns = [
      { id: 't', accountId: 'b', date: '2026-12-08', description: 'COLORADO SPRINGS UTIL WEB PMT', merchant: '', amount: -151.2, category: 'utilities', importId: null, excluded: false, note: '' },
    ];
    expect(postedAmount(util, txns, at('2026-12-09T10:00:00'))).toEqual({ amount: 151.2, date: '2026-12-08' });
    expect(looksVariable({ ...util, name: 'Cos Utilit' })).toBe(true);
    expect(looksVariable({ ...util, name: 'Internet', category: 'utilities' })).toBe(false);
    expect(looksVariable({ ...util, name: 'Rent', category: 'utilities' })).toBe(false);
    expect(looksVariable({ ...util, name: 'Discord', category: 'subscriptions' })).toBe(false);
  });
});
