import { describe, expect, it } from 'vitest';
import { categorize } from './categories';
import { parseCsv, parseOfx, parsePdfLines, cleanMerchant, transactionIds } from './statements';
import { parseAmount } from './money';
import { parseLooseDate } from './dates';
import { summarizeMonth, detectRecurring } from './analytics';
import { allocateSavings, billDueDates, buildPlan, estimateEssentials, threePaycheckMonths } from './budget';
import { defaultSettings } from './defaults';
import { foodPlanMonthly } from './food';
import { generateInsights } from './insights';
import { open, seal, newer, tokenId, pairKeys, makeOffer, verifyOffer, deriveToken, fromB64 } from './sync';
import type { Bill, Contribution, Goal, SyncRecord, Transaction } from './types';

describe('parsing helpers', () => {
  it('parses amounts in many bank styles', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('(12.00)')).toBe(-12);
    expect(parseAmount('12.00-')).toBe(-12);
    expect(parseAmount('-45.10')).toBe(-45.1);
    expect(parseAmount('45.10 CR')).toBe(45.1);
    expect(parseAmount('45.10 DR')).toBe(-45.1);
    expect(parseAmount('abc')).toBeNull();
  });
  it('parses dates', () => {
    expect(parseLooseDate('11/05/2026')).toBe('2026-11-05');
    expect(parseLooseDate('2026-11-05')).toBe('2026-11-05');
    expect(parseLooseDate('20261105120000[-7:MST]')).toBe('2026-11-05');
    expect(parseLooseDate('11/5/26')).toBe('2026-11-05');
    expect(parseLooseDate('Nov 5, 2026')).toBe('2026-11-05');
    expect(parseLooseDate('11/05', 2026)).toBe('2026-11-05');
    expect(parseLooseDate('Oct 31', 2026)).toBe('2026-10-31');
  });
  it('cleans merchant names', () => {
    expect(cleanMerchant('POS PURCHASE KING SOOPERS #0123 COLORADO SPRI CO')).toBe('King Soopers');
    expect(cleanMerchant('PURCHASE AUTHORIZED ON 11/03 STARBUCKS STORE 12345 COLORADO SPGS CO')).toBe('Starbucks');
    expect(cleanMerchant('COLORADO SPRINGS UTIL WEB PMT')).toBe('Colorado Springs Utilities');
    expect(cleanMerchant('DD DOORDASH TACOBELL')).toBe('DoorDash');
    expect(cleanMerchant('BLUE STAR DINER 1234')).toBe('Blue Star Diner');
    expect(cleanMerchant('SQ *DOWNTOWN DELI')).toBe('Downtown Deli');
  });
});

describe('categorize', () => {
  it('knows local and common merchants', () => {
    expect(categorize('KING SOOPERS #123', -50)).toBe('groceries');
    expect(categorize('KING SOOPERS FUEL #123', -40)).toBe('gas');
    expect(categorize('LOAF N JUG 0042', -35)).toBe('gas');
    expect(categorize('COLORADO SPRINGS UTILITIES', -120)).toBe('utilities');
    expect(categorize('NETFLIX.COM', -15.49)).toBe('subscriptions');
    expect(categorize('DOORDASH*CHIPOTLE', -24)).toBe('delivery');
    expect(categorize('ACME CORP PAYROLL', 1400)).toBe('paycheck');
    expect(categorize('PAYMENT THANK YOU', 300)).toBe('cc_payment');
    expect(categorize('SOMETHING ODD', -5)).toBe('uncategorized');
  });
  it('lets your own rules win', () => {
    expect(categorize('WALMART SUPERCENTER', -80, [{ id: 'r', pattern: 'walmart', category: 'shopping', createdAt: 0 }])).toBe('shopping');
  });
});

describe('statement import', () => {
  it('reads a CSV with a single amount column', () => {
    const csv = `Date,Description,Amount,Balance
11/03/2026,KING SOOPERS #123,-82.14,1000.00
11/04/2026,ACME PAYROLL,1384.22,2384.22
11/05/2026,NETFLIX.COM,-15.49,2368.73`;
    const r = parseCsv(csv);
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[0]).toMatchObject({ date: '2026-11-03', amount: -82.14 });
  });
  it('reads a CSV with debit/credit columns', () => {
    const csv = `"Posting Date","Description","Debit","Credit"
"2026-11-03","SHELL OIL 123","45.00",""
"2026-11-04","DIRECT DEP ACME","","1,384.22"`;
    const r = parseCsv(csv);
    expect(r.transactions.map((t) => t.amount)).toEqual([-45, 1384.22]);
  });
  it('flips credit-card exports where purchases are positive', () => {
    const csv = `Transaction Date,Description,Amount
11/01/2026,AMAZON MKTP,25.00
11/02/2026,STARBUCKS,6.50
11/03/2026,TARGET,40.00
11/04/2026,SHELL,30.00
11/05/2026,PAYMENT THANK YOU,-200.00`;
    const r = parseCsv(csv);
    expect(r.csv!.mapping.flip).toBe(true);
    expect(r.transactions[0].amount).toBe(-25);
    expect(r.transactions[4].amount).toBe(200);
  });
  it('reads OFX/QFX (SGML style)', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>123456789</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103120000<TRNAMT>-82.14<FITID>1<NAME>KING SOOPERS #123</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261104<TRNAMT>1384.22<FITID>2<NAME>ACME PAYROLL<MEMO>DIRECT DEP</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = parseOfx(ofx);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[1]).toMatchObject({ date: '2026-11-04', amount: 1384.22, description: 'ACME PAYROLL DIRECT DEP' });
    expect(r.accountHint).toBe('Account ••6789');
  });
  it('reads PDF statement lines using sections and running balances', () => {
    const lines = [
      'Statement Period 10/01/2026 - 10/31/2026',
      'Beginning Balance 1,000.00',
      'Deposits and Additions',
      '10/03 ACME PAYROLL DIRECT DEP 1,384.22 2,384.22',
      'Withdrawals and Debits',
      '10/05 KING SOOPERS #123 COLORADO SPRI CO 82.14 2,302.08',
      '10/06 NETFLIX.COM 15.49 2,286.59',
      'Ending Balance 2,286.59',
    ];
    const r = parsePdfLines(lines);
    expect(r.transactions.map((t) => [t.date, t.amount])).toEqual([
      ['2026-10-03', 1384.22],
      ['2026-10-05', -82.14],
      ['2026-10-06', -15.49],
    ]);
  });
  it('makes stable ids so re-imports are de-duplicated', () => {
    const t = [
      { date: '2026-11-03', description: 'STARBUCKS', amount: -5 },
      { date: '2026-11-03', description: 'STARBUCKS', amount: -5 },
    ];
    const a = transactionIds('acct', t);
    const b = transactionIds('acct', t);
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(a[1]);
  });
});

function tx(date: string, description: string, amount: number, category?: string): Transaction {
  return { id: date + description + amount, accountId: 'a', date, description, merchant: cleanMerchant(description), amount, category: category ?? categorize(description, amount), importId: null, excluded: false, note: '' };
}

describe('analytics', () => {
  const txns = [
    tx('2026-08-04', 'NETFLIX.COM', -15.49),
    tx('2026-09-04', 'NETFLIX.COM', -15.49),
    tx('2026-10-04', 'NETFLIX.COM', -15.49),
    tx('2026-10-05', 'KING SOOPERS', -300),
    tx('2026-10-06', 'ACME PAYROLL', 2800),
    tx('2026-10-07', 'TRANSFER TO SAVINGS', -200),
    tx('2026-10-08', 'ONLINE TRANSFER FROM CHK', 500),
  ];
  it('summarizes a month without counting transfers', () => {
    const s = summarizeMonth(txns, '2026-10');
    expect(s.income).toBe(2800);
    expect(s.spending).toBeCloseTo(315.49, 2);
    expect(s.saved).toBe(200);
  });
  it('detects recurring subscriptions', () => {
    const r = detectRecurring(txns, [], '2026-10-20');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Netflix', frequency: 'monthly', amount: 15.49, dueDay: 4 });
  });
});

describe('budget', () => {
  const rent: Bill = { id: 'r', name: 'Rent', amount: 1200, dueDay: 1, dueMonth: null, anchorDate: null, frequency: 'monthly', category: 'housing', autopay: false, active: true, matchPattern: '' };
  const phone: Bill = { ...rent, id: 'p', name: 'Phone', amount: 60, dueDay: 15 };
  it('finds due dates in a window, clamping short months', () => {
    expect(billDueDates({ ...rent, dueDay: 31 }, '2026-02-01', '2026-03-01')).toEqual(['2026-02-28']);
    expect(billDueDates({ ...rent, frequency: 'yearly', dueMonth: 3, dueDay: 10 }, '2026-01-01', '2027-01-01')).toEqual(['2026-03-10']);
    expect(billDueDates({ ...rent, frequency: 'weekly', anchorDate: '2026-11-02' }, '2026-11-10', '2026-11-24')).toEqual(['2026-11-16', '2026-11-23']);
  });

  it('builds a plan that covers bills due before the next payday', () => {
    const s = defaultSettings();
    s.budget.billsMode = 'due_dates';
    const essentials = estimateEssentials(s, [], null, '2026-11-19');
    const plan = buildPlan({ settings: s, net: 1400, payday: '2026-11-27', nextPayday: '2026-12-11', bills: [rent, phone], essentials, goals: [], contributions: [] });
    expect(plan.bills).toBe(1200); // rent Dec 1; phone Dec 15 belongs to the next check
    expect(plan.shortfall).toBeGreaterThanOrEqual(0);
    const plan2 = buildPlan({ settings: s, net: 1400, payday: '2026-12-11', nextPayday: '2026-12-25', bills: [rent, phone], essentials, goals: [], contributions: [] });
    expect(plan2.bills).toBe(60);
    expect(plan2.savings).toBeGreaterThan(0);
    expect(plan2.savings % 5).toBe(0);
    expect(plan2.personal).toBeGreaterThanOrEqual(1400 * 0.1 - 0.01);
    // with bills known and needs low, spending money is capped near 30% and the rest is saved
    expect(plan2.personal).toBeLessThanOrEqual(1400 * 0.3 + 5);
    expect(plan2.bills + plan2.essentials + plan2.savings + plan2.personal).toBeCloseTo(1400, 2);
  });

  it('with a bills-only account, the check only tops it up and the rest is planned for you', () => {
    const s = defaultSettings();
    s.budget.billsMode = 'due_dates';
    const essentials = estimateEssentials(s, [], null, '2026-11-19');
    const args = { settings: s, net: 1400, payday: '2026-11-27', nextPayday: '2026-12-11', bills: [rent, phone], essentials, goals: [], contributions: [] };
    const topped = buildPlan({ ...args, billsTopUp: 300 });
    expect(topped.bills).toBe(300);
    expect(topped.billsTopUp).toBe(true);
    const covered = buildPlan({ ...args, billsTopUp: 0 });
    expect(covered.bills).toBe(0);
    expect(covered.savings + covered.personal).toBeGreaterThan(buildPlan(args).savings + buildPlan(args).personal);
  });

  it('allocates savings: emergency first, then deadlines, then priority', () => {
    const goals: Goal[] = [
      { id: 'e', name: 'Bedrock', target: 3000, targetDate: null, image: null, gem: 'obsidian', priority: 2, isEmergency: true, createdAt: 0, completedAt: null, archived: false, note: '' },
      { id: 'ring', name: 'Ring', target: 1000, targetDate: '2027-02-12', image: null, gem: 'sapphire', priority: 3, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '' },
      { id: 'car', name: 'Car', target: 8000, targetDate: null, image: null, gem: 'jade', priority: 1, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '' },
    ];
    const contributions: Contribution[] = [];
    const a = allocateSavings(300, goals, contributions, 2000, '2026-11-27');
    const by = Object.fromEntries(a.map((x) => [x.goalId, x.amount]));
    expect(by.e).toBe(150);
    expect(by.ring).toBeGreaterThan(0);
    expect(a.reduce((s, x) => s + x.amount, 0)).toBe(300);
  });

  it('spots three-paycheck months', () => {
    expect(threePaycheckMonths(['2027-01-01', '2027-01-15', '2027-01-29', '2027-02-12'])).toEqual(['2027-01']);
  });

  it('estimates food by household size', () => {
    const h = defaultSettings().household;
    expect(foodPlanMonthly({ ...h, adults: 1, foodPlan: 'thrifty' })).toBeCloseTo(283 * 1.2, 1);
    expect(foodPlanMonthly({ ...h, adults: 2, children: 2, foodPlan: 'thrifty' })).toBe(1018);
  });

  it('generates field notes without data', () => {
    const notes = generateInsights({
      settings: defaultSettings(),
      txns: [],
      bills: [],
      goals: [],
      contributions: [],
      market: null,
      asOf: '2026-11-19',
      netPerPaycheck: 1400,
      upcomingPaydays: ['2027-01-01', '2027-01-15', '2027-01-29'],
      otPremiumYtd: 0,
      otTaxSaved: 0,
    });
    expect(notes.map((n) => n.id)).toContain('import-first');
    expect(notes.map((n) => n.id)).toContain('emergency-start');
    expect(notes.map((n) => n.id)).toContain('triple-2027-01');
  });
});

describe('sync', () => {
  it('last writer wins with device tie-break', () => {
    const a = { updatedAt: 5, deviceId: 'a' } as SyncRecord;
    expect(newer(a, { updatedAt: 6, deviceId: 'a' } as SyncRecord)).toBe(true);
    expect(newer(a, { updatedAt: 4, deviceId: 'z' } as SyncRecord)).toBe(false);
    expect(newer(a, { updatedAt: 5, deviceId: 'b' } as SyncRecord)).toBe(true);
  });
  it('encrypts and decrypts payloads', async () => {
    const sealed = await seal('secret-token', { hello: 'pebbles', n: 1 });
    expect(sealed.data).not.toContain('pebbles');
    expect(await open('secret-token', sealed)).toEqual({ hello: 'pebbles', n: 1 });
    await expect(open('wrong-token', sealed)).rejects.toBeTruthy();
    expect(await tokenId('x')).toHaveLength(24);
  });
  it('pairs two devices with ECDH authenticated by the code', async () => {
    const phone = await pairKeys();
    const offer = await makeOffer('123456', phone.pubRaw);
    // hub side
    expect(await verifyOffer('123456', offer)).toBe(true);
    expect(await verifyOffer('654321', offer)).toBe(false);
    const hub = await pairKeys();
    const reply = await makeOffer('123456', hub.pubRaw, fromB64(offer.pub));
    const hubToken = await deriveToken(hub.keys.privateKey, offer.pub);
    // phone side
    expect(await verifyOffer('123456', reply, phone.pubRaw)).toBe(true);
    const phoneToken = await deriveToken(phone.keys.privateKey, reply.pub);
    expect(phoneToken).toBe(hubToken);
    expect(phoneToken).toHaveLength(64);
  });
});
