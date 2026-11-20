import { describe, expect, it } from 'vitest';
import { setGoalSplit, splitByWeights, syncGoalsWithAccount, type GoalSyncInput } from './savingsAccount';
import type { Account, Contribution, Goal, Transaction } from './types';

const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, name: id, target: 3000, targetDate: null, image: null, gem: 'jade', priority: 2, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '', ...extra });
const marcus: Account = { id: 'm', name: 'Marcus', type: 'savings', balance: 1000, balanceDate: '2026-11-19', source: 'plaid' };
const tx = (id: string, date: string, amount: number, description = 'TRANSFER FROM CHECKING'): Transaction => ({ id, accountId: 'm', date, description, merchant: '', amount, category: 'savings', importId: null, excluded: true, note: '' });

function apply(contribs: Contribution[], r: { put: Contribution[]; remove: string[] }): Contribution[] {
  const map = new Map(contribs.map((c) => [c.id, c]));
  r.remove.forEach((id) => map.delete(id));
  r.put.forEach((c) => map.set(c.id, c));
  return [...map.values()];
}
const bal = (cs: Contribution[], g: string) => Math.round(cs.filter((c) => c.goalId === g).reduce((s, c) => s + c.amount, 0) * 100) / 100;

describe('goals follow the savings account', () => {
  const goals = [goal('ring'), goal('em', { isEmergency: true })];
  const base: GoalSyncInput = {
    account: marcus,
    txns: [],
    goals,
    contributions: [],
    since: '2026-11-01',
    planWeights: [
      { goalId: 'ring', w: 53 },
      { goalId: 'em', w: 212 },
    ],
    paycheckFor: () => null,
  };

  it('splits to the cent', () => {
    expect(splitByWeights(265, [{ goalId: 'a', w: 53 }, { goalId: 'b', w: 212 }])).toEqual([
      { goalId: 'a', amount: 53 },
      { goalId: 'b', amount: 212 },
    ]);
    expect(splitByWeights(100, [{ goalId: 'a', w: 1 }, { goalId: 'b', w: 1 }, { goalId: 'c', w: 1 }]).reduce((s, x) => s + x.amount, 0)).toBe(100);
  });

  it('spreads money already in Marcus so goals equal the balance', () => {
    const cs = apply([], syncGoalsWithAccount(base));
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(1000);
    expect(bal(cs, 'ring')).toBe(200);
  });

  it('splits a $265 transfer $53 / $212 by that paycheck’s plan', () => {
    let cs = apply([], syncGoalsWithAccount(base));
    const acct = { ...marcus, balance: 1265 };
    cs = apply(cs, syncGoalsWithAccount({ ...base, account: acct, contributions: cs, txns: [tx('t1', '2026-11-20', 265)], paycheckFor: () => ({ periodStart: 'p1', weights: [{ goalId: 'ring', w: 53 }, { goalId: 'em', w: 212 }] }) }));
    expect(cs.filter((c) => c.id.startsWith('dep|t1|')).map((c) => c.amount).sort((a, b) => a - b)).toEqual([53, 212]);
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(1265);
    // running again changes nothing
    const again = syncGoalsWithAccount({ ...base, account: acct, contributions: cs, txns: [tx('t1', '2026-11-20', 265)] });
    expect(again.put).toEqual([]);
    expect(again.remove).toEqual([]);
  });

  it('replaces a manual "moved to savings" with the real deposit', () => {
    const manual: Contribution[] = [
      { id: 'pc|p1|ring', goalId: 'ring', amount: 50, date: '2026-11-20', note: '', paycheckId: 'p1', kind: 'deposit' },
      { id: 'pc|p1|em', goalId: 'em', amount: 200, date: '2026-11-20', note: '', paycheckId: 'p1', kind: 'deposit' },
    ];
    const r = syncGoalsWithAccount({ ...base, account: { ...marcus, balance: 265 }, contributions: manual, txns: [tx('t1', '2026-11-20', 265)], paycheckFor: () => ({ periodStart: 'p1', weights: [] }) });
    const cs = apply(manual, r);
    expect(r.remove.sort()).toEqual(['pc|p1|em', 'pc|p1|ring']);
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(265);
    expect(bal(cs, 'ring')).toBe(53);
  });

  it('keeps a split you set by hand', () => {
    let cs = apply([], syncGoalsWithAccount(base));
    cs = apply(cs, { put: setGoalSplit(marcus, new Map([['ring', 900], ['em', 100]]), cs, '2026-11-19'), remove: [] });
    const r = syncGoalsWithAccount({ ...base, contributions: cs });
    expect(r.put).toEqual([]);
    expect(bal(apply(cs, r), 'ring')).toBe(900);
  });

  it('a withdrawal for a finished goal comes out of that goal', () => {
    const g2 = [goal('ring', { completedAt: 1, target: 500 }), goal('em', { isEmergency: true })];
    let cs = apply([], syncGoalsWithAccount({ ...base, goals: g2, account: { ...marcus, balance: 1000 } }));
    cs = apply(cs, { put: setGoalSplit(marcus, new Map([['ring', 500], ['em', 500]]), cs, '2026-11-19'), remove: [] });
    cs = apply(cs, syncGoalsWithAccount({ ...base, goals: g2, contributions: cs, account: { ...marcus, balance: 510 }, txns: [tx('w1', '2026-11-21', -490, 'TRANSFER TO CHECKING')] }));
    expect(bal(cs, 'ring')).toBeLessThan(15);
    expect(bal(cs, 'ring') + bal(cs, 'em')).toBe(510);
  });
});

describe('bills: roommate split, wider suggestions, calendar', async () => {
  const { roommateTransfer, monthlyEquivalent } = await import('./budget');
  const { detectRecurring } = await import('./analytics');
  const { billsCalendar } = await import('./ics');
  const bill = (p: Partial<import('./types').Bill>) => ({ id: p.name ?? 'b', name: 'Bill', amount: 0, dueDay: 1, dueMonth: null, anchorDate: null, frequency: 'monthly' as const, category: 'utilities', autopay: false, active: true, matchPattern: '', ...p });

  it('rent to a roommate minus their half of the bills in your name', () => {
    const bills = [bill({ name: 'Rent', amount: 1000, toRoommate: true, category: 'housing' }), bill({ name: 'Internet', amount: 70, yourSharePct: 50, fromRent: true }), bill({ name: 'Electric', amount: 120, yourSharePct: 50, fromRent: true })];
    expect(roommateTransfer(bills)).toMatchObject({ send: 905, rent: 1000 });
    // your real monthly cost: full rent plus your halves
    expect(bills.reduce((s, b) => s + monthlyEquivalent(b), 0)).toBe(1095);
  });

  it('a thorough look finds varying utilities, Venmo rent and one-off subscriptions', () => {
    const t = (id: string, date: string, amount: number, description: string, category: string) => ({ id, accountId: 'c', date, description, merchant: '', amount, category, importId: null, excluded: false, note: '' });
    const txns = [
      t('1', '2026-09-03', -82.1, 'XCEL ENERGY PAYMENT', 'utilities'),
      t('2', '2026-10-04', -118.4, 'XCEL ENERGY PAYMENT', 'utilities'),
      t('3', '2026-11-02', -96.0, 'XCEL ENERGY PAYMENT', 'utilities'),
      t('4', '2026-09-01', -905, 'VENMO PAYMENT ROOMMATE', 'p2p'),
      t('5', '2026-10-01', -905, 'VENMO PAYMENT ROOMMATE', 'p2p'),
      t('6', '2026-11-01', -905, 'VENMO PAYMENT ROOMMATE', 'p2p'),
      t('7', '2026-11-10', -15.49, 'NETFLIX.COM', 'subscriptions'),
    ];
    const strict = detectRecurring(txns, [], '2026-11-19').map((r) => r.name);
    const loose = detectRecurring(txns, [], '2026-11-19', { thorough: true }).map((r) => r.name.toUpperCase());
    expect(strict.length).toBeLessThan(loose.length);
    expect(loose.some((n) => n.includes('XCEL'))).toBe(true);
    expect(loose.some((n) => n.includes('VENMO'))).toBe(true);
    expect(loose.some((n) => n.includes('NETFLIX'))).toBe(true);
  });

  it('writes a calendar file with repeating bills and paydays', () => {
    const ics = billsCalendar([bill({ name: 'Crunchyroll', amount: 10.8, dueDay: 9 })], '2026-11-19', '2026-11-20');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261209');
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=9');
    expect(ics).toContain('SUMMARY:Payday');
  });
});

describe('PayPal purchases count once', async () => {
  const { dedupePaypal } = await import('./paypal');
  const acct = (id: string, name: string, institution: string) => ({ id, name, institution, type: 'checking' as const });
  const t = (id: string, accountId: string, date: string, amount: number, description: string, merchant = '') => ({ id, accountId, date, description, merchant, amount, category: 'shopping', importId: null, excluded: false, note: '' });
  it('hides the USAA line for a PayPal purchase and keeps the PayPal one', () => {
    const accounts = [acct('usaa', 'Checking', 'USAA'), acct('pp', 'PayPal Balance', 'PayPal')];
    const txns = [
      t('p1', 'pp', '2026-11-19', -42.17, 'Purchase', 'Steam'),
      t('p2', 'pp', '2026-11-19', 42.17, 'Bank deposit to PP account'),
      t('b1', 'usaa', '2026-11-21', -42.17, 'PAYPAL *STEAM GAMES 402-935-7733'),
      t('b2', 'usaa', '2026-11-21', -9.99, 'PAYPAL *SPOTIFY'),
      t('b3', 'usaa', '2026-11-21', -42.17, 'KING SOOPERS #12'),
    ];
    const ups = dedupePaypal(txns, accounts);
    expect(ups.find((u) => u.id === 'b1')?.patch).toMatchObject({ dupOf: 'p1', excluded: true });
    expect(ups.find((u) => u.id === 'p2')?.patch.excluded).toBe(true);
    expect(ups.some((u) => u.id === 'b2' || u.id === 'b3')).toBe(false); // no PayPal match / not a PayPal line
    // running again after applying changes nothing
    const applied = txns.map((x) => ({ ...x, ...(ups.find((u) => u.id === x.id)?.patch ?? {}) }));
    expect(dedupePaypal(applied, accounts)).toEqual([]);
  });
});

describe('one subscription, two accounts', async () => {
  const { detectRecurring } = await import('./analytics');
  const { cleanMerchant } = await import('./statements');
  it('PayPal’s “Payment To” and the bank’s “PAYPAL *” are the same merchant, counted once', () => {
    expect(cleanMerchant('Payment To Crunchyroll')).toBe(cleanMerchant('PAYPAL *CRUNCHYROLL'));
    const t = (id: string, accountId: string, date: string, description: string) => ({ id, accountId, date, description, merchant: '', amount: -10.8, category: 'subscriptions', importId: null, excluded: false, note: '' });
    const txns = [
      t('a', 'usaa', '2026-09-09', 'PAYPAL *CRUNCHYROLL'),
      t('b', 'pp', '2026-09-08', 'Payment To Crunchyroll'),
      t('c', 'usaa', '2026-10-09', 'PAYPAL *CRUNCHYROLL'),
      t('d', 'pp', '2026-10-08', 'Payment To Crunchyroll'),
      t('e', 'usaa', '2026-11-09', 'PAYPAL *CRUNCHYROLL'),
      t('f', 'pp', '2026-11-08', 'Payment To Crunchyroll'),
    ];
    const subs = detectRecurring(txns, [], '2026-11-20');
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ amount: 10.8, frequency: 'monthly', count: 3 });
  });
});

describe('bills account covers bills through the check after next', async () => {
  const { coverage } = await import('./coverage');
  const bill = (p: Partial<import('./types').Bill>) => ({ id: p.name ?? 'b', name: 'Bill', amount: 0, dueDay: 1, dueMonth: null, anchorDate: null, frequency: 'monthly' as const, category: 'utilities', autopay: false, active: true, matchPattern: '', ...p });
  const billsAcct = { id: 'bills', name: 'Bills Account', institution: 'USAA', type: 'checking' as const, balance: 360, available: 344.08, balanceDate: '2026-11-19' };
  const spend = { id: 'spend', name: 'Spending Account', institution: 'USAA', type: 'checking' as const, balance: 250, available: 240, balanceDate: '2026-11-19' };
  const bills = [
    bill({ name: 'Rent', amount: 1000, dueDay: 1, toRoommate: true, category: 'housing', matchPattern: 'VENMO' }),
    bill({ name: 'Internet', amount: 70, dueDay: 3, yourSharePct: 50, fromRent: true }),
    bill({ name: 'Crunchyroll', amount: 10.8, dueDay: 9, matchPattern: 'CRUNCHYROLL' }),
  ];
  const base = { bills, txns: [], today: '2026-11-19', nextPayday: '2026-11-20', followingPayday: '2026-12-04', essentialsMonthly: 608 };
  it('nothing due before Friday, so Friday’s check tops it up for Dec 1 and Dec 3', () => {
    const c = coverage({ ...base, billsAccount: billsAcct, spendingAccount: spend });
    const b = c.bills!;
    expect(b.bills.map((x) => [x.bill.name, x.amount, x.beforePayday])).toEqual([
      ['Rent', 965, false],
      ['Internet', 70, false],
    ]);
    expect(b.dueBeforePayday).toBe(0);
    expect(b.dueNextCycle).toBe(1035);
    expect(b.shortNow).toBe(0);
    expect(b.topUp).toBe(695); // 1035 - 344.08, rounded up to $5
    expect(b.status).toBe('topup');
    // bill money is never spending money
    expect(c.spending!.balance).toBe(240);
    expect(c.spending!.living).toBe(20); // 1 day of $608/month
    expect(c.spending!.left).toBe(220);
  });
  it('a bill due before payday the account can’t cover is short now; a paid one isn’t counted', () => {
    const late = { ...base, today: '2026-11-29', nextPayday: '2026-12-04', followingPayday: '2026-12-18' };
    const short = coverage({ ...late, billsAccount: { ...billsAcct, available: 500 }, spendingAccount: null }).bills!;
    expect(short.shortNow).toBe(535);
    expect(short.status).toBe('short');
    const paid = [{ id: 't', accountId: 'bills', date: '2026-11-28', description: 'VENMO PAYMENT', merchant: '', amount: -965, category: 'p2p', importId: null, excluded: false, note: '' }];
    const ok = coverage({ ...late, txns: paid, billsAccount: { ...billsAcct, available: 400 }, spendingAccount: null }).bills!;
    expect(ok.bills.find((x) => x.bill.name === 'Rent')?.paid).toBe(true);
    expect(ok.dueBeforePayday).toBe(70);
    expect(ok.dueNextCycle).toBe(10.8);
    expect(ok.status).toBe('ok');
    expect(ok.extra).toBe(319.2);
  });
});
