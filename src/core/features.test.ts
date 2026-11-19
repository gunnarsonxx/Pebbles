import { describe, expect, it } from 'vitest';
import { createHostedLink, getLinkResult, exchangePublicToken, syncTransactions, transactionFromPlaid, accountFromPlaid, looksLikeDuplicate, PlaidError, type PlaidCreds } from './plaid';
import { parseReceipt, type OcrLine } from './receipts';
import { parsePaystub, deductionsFromStub } from './paystub';
import { analyzeGroceries, cleanItemName, deptFor, monthlyGroceryNeed } from './groceries';
import { interestContributions, interestNextMonth, projectSavings, splitAcrossGoals, apyFromText, goalsAccount } from './savingsAccount';
import { findPaycheckDeposit, findSavingsTransfer, paydayMoves } from './moves';
import { parseReleases, findUpdate } from './updates';
import { krogerPrice, krogerToken } from './kroger';
import { BUNDLED_GUIDELINES, checkGuidelines } from './guidelines';
import { buildPlan, estimateEssentials } from './budget';
import { defaultSettings } from './defaults';
import type { HttpFn } from './market';
import type { Account, Goal, Receipt, Transaction } from './types';

const L = (s: string, confidence = 95): OcrLine[] => s.trim().split('\n').map((text) => ({ text: text.trim(), confidence }));

// ---------------- Plaid ----------------

function fakePlaid(routes: Record<string, (body: Record<string, unknown>) => { status?: number; json: unknown }>): HttpFn & { calls: { path: string; body: Record<string, unknown> }[] } {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string, init?: { body?: string }) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init?.body ?? '{}');
    calls.push({ path, body });
    const r = routes[path]?.(body) ?? { status: 404, json: { error_message: 'no route' } };
    return { status: r.status ?? 200, text: JSON.stringify(r.json) };
  }) as HttpFn & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

const creds: PlaidCreds = { clientId: 'cid', secret: 'sec', env: 'sandbox' };

describe('plaid', () => {
  it('runs the hosted link flow', async () => {
    const http = fakePlaid({
      '/link/token/create': () => ({ json: { link_token: 'link-1', hosted_link_url: 'https://hosted.plaid.com/link/abc', expiration: 'x' } }),
      '/link/token/get': () => ({
        json: { link_sessions: [{ finished_at: 'now', results: { item_add_results: [{ public_token: 'public-1', institution: { name: 'Marcus by Goldman Sachs', institution_id: 'ins_1' } }] } }] },
      }),
      '/item/public_token/exchange': () => ({ json: { access_token: 'access-1', item_id: 'item-1' } }),
    });
    const link = await createHostedLink(http, creds, 'dev1', { redirectUri: 'pebbles://plaid' });
    expect(link.url).toContain('hosted.plaid.com');
    expect(http.calls[0].body).toMatchObject({ client_id: 'cid', secret: 'sec', products: ['transactions'], hosted_link: { completion_redirect_uri: 'pebbles://plaid' } });
    const r = await getLinkResult(http, creds, link.linkToken);
    expect(r).toMatchObject({ status: 'done', items: [{ publicToken: 'public-1', institution: 'Marcus by Goldman Sachs' }] });
    expect(await exchangePublicToken(http, creds, 'public-1')).toEqual({ accessToken: 'access-1', itemId: 'item-1' });
  });

  it('reports a waiting session and plaid errors', async () => {
    const http = fakePlaid({
      '/link/token/get': () => ({ json: { link_sessions: [] } }),
      '/item/public_token/exchange': () => ({ status: 400, json: { error_code: 'INVALID_PUBLIC_TOKEN', error_message: 'bad token' } }),
    });
    expect((await getLinkResult(http, creds, 'x')).status).toBe('waiting');
    await expect(exchangePublicToken(http, creds, 'x')).rejects.toBeInstanceOf(PlaidError);
  });

  it('pages through transactions/sync and restarts on mutation', async () => {
    let n = 0;
    const http = fakePlaid({
      '/transactions/sync': (b) => {
        n++;
        if (n === 2) return { status: 400, json: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', error_message: 'retry' } };
        const first = !b.cursor;
        return {
          json: {
            added: [{ transaction_id: first ? 't1' : 't2', account_id: 'a1', amount: first ? 82.14 : -1384.22, date: '2026-11-03', name: first ? 'KING SOOPERS #12' : 'ACME PAYROLL', merchant_name: first ? 'King Soopers' : null, pending: false, personal_finance_category: first ? { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' } : { primary: 'INCOME', detailed: 'INCOME_WAGES' } }],
            modified: [],
            removed: [],
            accounts: [{ account_id: 'a1', name: 'Checking', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 1000, available: 990 } }],
            next_cursor: first ? 'c1' : 'c2',
            has_more: first,
          },
        };
      },
    });
    const r = await syncTransactions(http, creds, 'access', null);
    expect(r.added.map((t) => t.transaction_id)).toEqual(['t1', 't2']);
    expect(r.cursor).toBe('c2');
    const t1 = transactionFromPlaid(r.added[0], []);
    expect(t1).toMatchObject({ id: 'p_t1', amount: -82.14, category: 'groceries', accountId: 'pa_a1' });
    expect(transactionFromPlaid(r.added[1], []).category).toBe('paycheck');
    const acct = accountFromPlaid(r.accounts[0], 'Ent', 'item', '2026-11-19');
    expect(acct).toMatchObject({ id: 'pa_a1', type: 'checking', balance: 1000 });
  });

  it('spots transactions already imported from a statement', () => {
    const plaidTxn = { id: 'p_x', accountId: 'pa', date: '2026-11-04', description: 'King Soopers · KING SOOPERS #12', merchant: 'King Soopers', amount: -82.14, category: 'groceries', importId: null, excluded: false, note: '', source: 'plaid' } as Transaction;
    const imported = { ...plaidTxn, id: 't1', date: '2026-11-03', description: 'KING SOOPERS #0123 COLORADO SPRI CO', source: 'import' } as Transaction;
    expect(looksLikeDuplicate(plaidTxn, [imported])).toBe(true);
    expect(looksLikeDuplicate({ ...plaidTxn, amount: -10 }, [imported])).toBe(false);
  });
});

// ---------------- receipts & groceries ----------------

const KING_SOOPERS = `
KING SOOPERS
1750 S NEVADA AVE COLORADO SPRINGS CO
11/14/26 06:42pm
KRO 2% MILK GAL 3.49 B
SIMTRU ORG BNNA
2.31 lb @ 0.59 /lb 1.36 B
SC KROGER SAVINGS 0.50-
KRO LG EGGS 18CT 4.29 B
DORITOS NACHO CHS 5.49 T
BNLS SKNLS CHKN BRST 9.87 B
SUBTOTAL 24.00
TAX 0.31
**** BALANCE 24.31
VISA 24.31
TOTAL SAVINGS 0.50
`;

describe('receipts', () => {
  it('reads a King Soopers receipt with weights and savings', () => {
    const r = parseReceipt(L(KING_SOOPERS));
    expect(r.store).toBe('King Soopers');
    expect(r.date).toBe('2026-11-14');
    expect(r.items.map((i) => [i.name, i.price])).toEqual([
      ['Milk', 3.49],
      ['Organic Bananas', 0.86],
      ['Large Eggs', 4.29],
      ['Doritos Nacho Cheese', 5.49],
      ['Boneless Skinless Chicken Breast', 9.87],
    ]);
    expect(r.subtotal).toBe(24);
    expect(r.tax).toBe(0.31);
    expect(r.savings).toBe(0.5);
    expect(r.items.map((i) => i.dept)).toEqual(['dairy', 'produce', 'dairy', 'snacks', 'meat']);
    expect(r.warnings.filter((w) => w.includes('add up'))).toHaveLength(0);
  });

  it('flags a receipt whose items do not add up', () => {
    const r = parseReceipt(L(KING_SOOPERS.replace('SUBTOTAL 24.00', 'SUBTOTAL 23.50')));
    expect(r.warnings.filter((w) => w.includes('add up'))).toHaveLength(1);
  });

  it('reads a Walmart receipt with UPCs and flags', () => {
    const r = parseReceipt(L(`
Walmart
Save money. Live better.
GV WHOLE MILK 007874235187 F 3.48 N
BANANAS 000000004011KF 1.24 N
GV LG EGGS 007874202123 F 3.12 N
SUBTOTAL 7.84
TAX 1 4.070 % 0.00
TOTAL 7.84
11/16/26 12:01:15
`));
    expect(r.store).toBe('Walmart');
    expect(r.items.map((i) => i.name)).toEqual(['Whole Milk', 'Bananas', 'Large Eggs']);
    expect(r.items[0].price).toBe(3.48);
    expect(r.warnings.find((w) => w.includes('add up'))).toBeUndefined();
  });

  it('cleans names and departments', () => {
    expect(cleanItemName('GV 2% WHL MLK 128 OZ')).toEqual({ name: 'Whole Milk', key: 'wholemilk' });
    expect(deptFor('Toilet Paper', 'toiletpaper')).toBe('household');
    expect(deptFor('Coors Light', 'coorslight')).toBe('alcohol');
    expect(deptFor('Mystery', 'mystery', [{ id: 'mystery', name: 'Mystery', dept: 'pantry' }])).toBe('pantry');
  });

  it('learns usual trips, extras and tax from receipts', () => {
    const base = parseReceipt(L(KING_SOOPERS));
    const mk = (date: string, extra?: [string, number]): Receipt => ({
      id: date,
      store: 'King Soopers',
      date,
      items: [...base.items.filter((i) => i.dept !== 'snacks'), ...(extra ? [{ raw: extra[0], ...cleanItemName(extra[0]), price: extra[1], qty: 1, dept: deptFor(extra[0], cleanItemName(extra[0]).key) }] : [])],
      subtotal: null,
      tax: 0.31,
      total: null,
      savings: null,
      source: 'text',
      createdAt: 0,
    });
    const receipts = [mk('2026-10-20'), mk('2026-10-27', ['MONSTER ENERGY', 3.29]), mk('2026-11-03'), mk('2026-11-10', ['OREO COOKIES', 4.99])];
    const s = analyzeGroceries(receipts, '2026-11-19')!;
    expect(s.trips).toBe(4);
    expect(s.usual.map((u) => u.name)).toContain('Large Eggs');
    expect(s.usualTrip).toBeCloseTo(3.49 + 0.86 + 4.29 + 9.87, 2);
    expect(s.extrasPerTrip).toBeCloseTo((3.29 + 4.99) / 4, 2);
    expect(s.taxRate).toBeGreaterThan(0.01);
    expect(s.tripsPerMonth).toBeCloseTo(3.9, 1);
    expect(monthlyGroceryNeed(s)).toBeCloseTo(s.needsPerMonth * (1 + (s.taxRate ?? 0)), 1);
  });
});

// ---------------- paystubs ----------------

const STUB = `
ACME LOGISTICS INC Earnings Statement
Pay Period: 11/08/2026 - 11/21/2026 Pay Date: 11/27/2026
Regular 22.00 72.00 1,584.00 33,264.00
Lead Shift 25.50 8.00 204.00 1,020.00
Gross Pay 1,788.00 34,284.00
Federal Income Tax 130.92 2,610.40
Social Security 108.08 2,125.61
Medicare 25.28 497.12
CO State Income Tax 69.04 1,352.10
CO FAMLI 7.75 150.85
401(k) 89.40 1,714.20
Dental 12.50 237.50
Net Pay 1,345.03 25,595.72
`;

describe('paystubs', () => {
  it('reads dates, earnings, taxes and deductions', () => {
    const p = parsePaystub(L(STUB));
    expect(p.payDate).toBe('2026-11-27');
    expect(p.periodStart).toBe('2026-11-08');
    expect(p.periodEnd).toBe('2026-11-21');
    expect(p.gross).toBe(1788);
    expect(p.net).toBe(1345.03);
    expect(p.hours).toEqual([
      { label: 'Regular', hours: 72, rate: 22, amount: 1584 },
      { label: 'Lead Shift', hours: 8, rate: 25.5, amount: 204 },
    ]);
    const kinds = Object.fromEntries(p.lines.map((l) => [l.kind, l.current]));
    expect(kinds).toMatchObject({ federal: 130.92, social_security: 108.08, medicare: 25.28, state: 69.04, famli: 7.75 });
    expect(p.warnings).toEqual([]);
    const d = deductionsFromStub(p);
    expect(d.find((x) => x.kind === 'traditional_401k')).toMatchObject({ mode: 'percent', amount: 5 });
    expect(d.find((x) => x.name === 'Dental')).toMatchObject({ kind: 'section125', mode: 'fixed', amount: 12.5 });
  });

  it('flags a stub that does not add up', () => {
    const p = parsePaystub(L(STUB.replace('1,345.03', '1,445.03')));
    expect(p.warnings.length).toBe(1);
    expect(p.lines.every((l) => l.lowConfidence)).toBe(true);
  });
});

// ---------------- savings account ----------------

describe('savings account', () => {
  const goals: Goal[] = [
    { id: 'a', name: 'Bedrock', target: 3000, targetDate: null, image: null, gem: 'obsidian', priority: 3, isEmergency: true, createdAt: 0, completedAt: null, archived: false, note: '' },
    { id: 'b', name: 'Ring', target: 4500, targetDate: null, image: null, gem: 'sapphire', priority: 2, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '' },
  ];
  it('projects compounding interest', () => {
    expect(interestNextMonth(10000, 3.65)).toBeCloseTo(29.94, 1);
    const p = projectSavings(5000, 3.65, 600, 12);
    expect(p[12].balance).toBeGreaterThan(5000 + 7200);
    expect(p[12].interestTotal).toBeGreaterThan(200);
  });
  it('splits interest across goals by balance, to the cent', () => {
    const s = splitAcrossGoals(12.34, goals, new Map([['a', 1000], ['b', 3000]]));
    expect(s.reduce((x, y) => x + y.amount, 0)).toBeCloseTo(12.34, 2);
    expect(s.find((x) => x.goalId === 'b')!.amount).toBeCloseTo(9.25, 1);
  });
  it('turns interest payments into pebbles once', () => {
    const marcus: Account = { id: 'm', name: 'Marcus Online Savings', type: 'savings', holdsGoals: true };
    const txns = [{ id: 'i1', accountId: 'm', date: '2026-10-31', description: 'Interest Paid', merchant: 'Interest', amount: 10, category: 'income_other', importId: null, excluded: false, note: '' } as Transaction];
    const first = interestContributions(txns, marcus, goals, [], new Map([['a', 500], ['b', 500]]));
    expect(first.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(10, 2);
    expect(interestContributions(txns, marcus, goals, first, new Map())).toEqual([]);
    expect(goalsAccount([{ id: 'x', name: 'Marcus Savings', type: 'savings' }])?.id).toBe('x');
    expect(apyFromText(['Annual Percentage Yield Earned 3.65%'])).toBe(3.65);
  });
});

// ---------------- autopilot moves ----------------

describe('payday moves', () => {
  const s = defaultSettings();
  const essentials = estimateEssentials(s, [], null, '2026-11-19');
  const goals: Goal[] = [{ id: 'g', name: 'Ring', target: 4500, targetDate: null, image: null, gem: 'sapphire', priority: 2, isEmergency: false, createdAt: 0, completedAt: null, archived: false, note: '' }];
  const plan = buildPlan({ settings: s, net: 1400, payday: '2026-11-27', nextPayday: '2026-12-11', bills: [], essentials, goals, contributions: [] });
  const period = { index: 0, start: '2026-11-08', end: '2026-11-21', payday: '2026-11-27' };
  it('tells you what to move', () => {
    const moves = paydayMoves({ period, plan, goals, savingsName: 'Marcus', states: new Map(), bonusMonth: true });
    expect(moves[0].title).toContain('to Marcus');
    expect(moves.map((m) => m.key)).toEqual(['save', 'spend', 'bonus']);
  });
  it('finds the paycheck and the savings transfer in bank data', () => {
    const t = (id: string, date: string, amount: number, category: string, description = '') =>
      ({ id, accountId: 'c', date, description, merchant: '', amount, category, importId: null, excluded: false, note: '' }) as Transaction;
    const txns = [t('1', '2026-11-27', 1398.5, 'paycheck'), t('2', '2026-11-28', -plan.savings, 'savings', 'TRANSFER TO MARCUS')];
    expect(findPaycheckDeposit(txns, '2026-11-27', 1400)?.id).toBe('1');
    expect(findSavingsTransfer(txns, '2026-11-27', plan.savings, null)?.id).toBe('2');
    expect(findSavingsTransfer(txns, '2026-11-27', plan.savings * 3, null)).toBeNull();
  });
});

// ---------------- updates, kroger, guidelines ----------------

describe('updates', () => {
  const json = [
    { tag_name: 'build-5', name: 'Pebbles build 5', published_at: '2026-11-20', prerelease: true, draft: false, html_url: 'u5', assets: [{ name: 'Pebbles.apk', browser_download_url: 'https://github.com/x/apk5', size: 1, digest: 'sha256:abc' }] },
    { tag_name: 'build-4', name: 'Pebbles build 4', published_at: '2026-11-19', prerelease: true, draft: false, html_url: 'u4', assets: [{ name: 'Pebbles.apk', browser_download_url: 'a4', size: 1 }, { name: 'Pebbles-Setup.exe', browser_download_url: 'e4', size: 1 }] },
  ];
  it('finds the newest build for each platform', () => {
    const r = parseReleases(json);
    expect(findUpdate(r, 3, 'android')?.build).toBe(5);
    expect(findUpdate(r, 3, 'android')?.apk?.sha256).toBe('abc');
    expect(findUpdate(r, 3, 'desktop')?.build).toBe(4);
    expect(findUpdate(r, 5, 'android')).toBeNull();
  });
});

describe('kroger', () => {
  it('gets a token and picks the best priced match', async () => {
    const http: HttpFn = async (url, init) => {
      if (url.includes('/token')) {
        expect(init?.headers?.Authorization).toBe('Basic ' + btoa('id:secret'));
        return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
      }
      return {
        status: 200,
        text: JSON.stringify({
          data: [
            { productId: '1', description: 'Fairlife Whole Milk', items: [{ price: { regular: 5.49, promo: 0 }, size: '52 fl oz' }] },
            { productId: '2', description: 'Kroger Whole Milk', brand: 'Kroger', items: [{ price: { regular: 3.79, promo: 3.29 }, size: '1 gal' }] },
            { productId: '3', description: 'Oat Drink', items: [{ price: { regular: 4.99 } }] },
          ],
        }),
      };
    };
    expect(await krogerToken(http, 'id', 'secret')).toBe('tok');
    const p = await krogerPrice(http, 'tok', '620', 'whole milk');
    expect(p).toMatchObject({ productId: '2', regular: 3.79, promo: 3.29 });
  });
});

describe('guidelines', () => {
  it('compares a plan with the consensus targets', () => {
    const s = defaultSettings();
    const essentials = estimateEssentials(s, [], null, '2026-11-19');
    const plan = buildPlan({ settings: s, net: 1400, payday: '2026-11-27', nextPayday: '2026-12-11', bills: [], essentials, goals: [], contributions: [] });
    const checks = checkGuidelines({ g: BUNDLED_GUIDELINES, plan, grossPerCheck: 1760, retirementPerCheck: 0, emergencyBalance: 500, essentials, bills: [] });
    expect(checks.map((c) => c.id)).toEqual(['needs', 'savings', 'wants', 'emergency', 'retirement']);
    expect(checks.find((c) => c.id === 'savings')!.standing).toBe('good');
  });
});

describe('paystub screenshots from pay apps', () => {
  const L2 = (t: string) => t.split('\n').map((text) => ({ text, confidence: 85 }));
  it('reads labels and amounts on separate lines', () => {
    const p = parsePaystub(
      L2(`Pay Date
11/13/2026
Gross Pay
$1,671.50
Net Pay
$1,355.31
Federal Income Tax
$98.12
Social Security
$103.63`),
    );
    expect(p.gross).toBe(1671.5);
    expect(p.net).toBe(1355.31);
    expect(p.lines.find((l) => l.kind === 'federal')?.current).toBe(98.12);
  });
  it('reads an amount printed above its label', () => {
    const p = parsePaystub(L2(`Earnings statement\n$1,355.31\nTake Home Pay`));
    expect(p.net).toBe(1355.31);
  });
  it('reads a header row over a row of amounts', () => {
    const p = parsePaystub(L2(`Gross Pay   Deductions   Net Pay\n$1,671.50   $316.19   $1,355.31`));
    expect(p.gross).toBe(1671.5);
    expect(p.net).toBe(1355.31);
  });
  it('fixes common misreads', async () => {
    const { cleanOcrMoney } = await import('./paystub');
    expect(cleanOcrMoney('Net Pay S1,355.31')).toBe('Net Pay $1,355.31');
    expect(cleanOcrMoney('Gross $ 1, 671 .50')).toBe('Gross $1,671.50');
    expect(cleanOcrMoney('Gross 1.671.50')).toBe('Gross 1,671.50');
  });
});

describe('a real stub screenshot, as the on-device reader saw it (personal details removed)', () => {
  // rows rebuilt from word positions, with the reader's actual mistakes left in
  const rows = `Check Date:   Check #:
Saint Petersburg   FL 33716   11/20/2026   1393110
Pay Period: 11/1/2026 THRU 11/14/2026
Pay Type: Hourly   CURRENT
Rate   Hous Eamings* Hours   Eamings | Description   Peiod   YTD   Description   Period
2250 5880   1316.25   1667.00   3844754 Reimbursement   181.18 | Federd WH   119.84   3298.76
24.500   1450   38625   FICA   103.64   272385
Holiday   32.00   1096.52   Medicare   2424   637.02
Overtime   5325   1909.69   COWH   65.00   1707.00
Sick   48.00   1080.00   COPFMLEE   7.36   198.31
Total   181.18 Total   320.08   8550.94
Total   73.00   1671.50   1853.32   43637.91   Begin   924
Blended OT   004   Adjustments   0.00   0.00
Blended OT   19.81   Available Balance   10.77
IMPORTANT MESSAGE   | COIRA Roth   1325.79
Total   0.00   1325.79
Gross   FCA   Federal   Other
Wages   Taxable   Taxable   Taxes   Deducts   Net Pay
Current   1671 30   1671 50   1671 50   3 20.08   0.00   1351.42
YTD   43933.03   43933.03   43933.03   8559.94   1325.79   3422848
11/20/2026`;
  const p = parsePaystub(
    rows.split('\n').map((text) => ({ text, confidence: 85 })),
    [22.5, 24.5],
  );
  it('finds gross, net and dates', () => {
    expect(p.gross).toBe(1671.5);
    expect(p.net).toBe(1351.42);
    expect(p.payDate).toBe('2026-11-20');
    expect(p.periodStart).toBe('2026-11-01');
    expect(p.periodEnd).toBe('2026-11-14');
  });
  it('reads every tax, and they add up to the stub’s total', () => {
    const t = (k: string) => p.lines.find((l) => l.kind === k)?.current;
    expect(t('federal')).toBe(119.84);
    expect(t('social_security')).toBe(103.64);
    expect(t('medicare')).toBe(24.24);
    expect(t('state')).toBe(65);
    expect(t('famli')).toBe(7.36);
    expect(p.warnings).toEqual([]);
  });
  it('treats the year-to-date Roth IRA total as nothing taken this check', () => {
    expect(p.lines.find((l) => /ROTH/i.test(l.label))?.current ?? 0).toBe(0);
    expect(p.hours.some((h) => h.amount === 19.81)).toBe(false);
  });
});

describe('pay stub columns: this period vs. year to date', async () => {
  const { rowsFromWords } = await import('./layout');
  // words placed where they sit on a real stub (x in px, one row every 18 px)
  let y = 0;
  const words: { text: string; confidence: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  const row = (...cells: [string, number][]) => {
    y += 18;
    for (const [text, x] of cells) {
      let at = x;
      for (const part of text.split(' ')) {
        words.push({ text: part, confidence: 95, x0: at, x1: at + part.length * 6, y0: y, y1: y + 10 });
        at += part.length * 6 + 5;
      }
    }
  };
  row(['Pay Period: 11/1/2026 THRU 11/14/2026', 700]);
  row(['CURRENT', 290], ['YTD', 455], ['This', 690], ['This', 935]);
  row(['Description', 40], ['Rate', 245], ['Hours', 290], ['Earnings', 340], ['Hours', 410], ['Earnings', 480], ['Description', 545], ['Period', 690], ['YTD', 760], ['Description', 800], ['Period', 935], ['YTD', 1010]);
  row(['Regular', 40], ['22.500', 245], ['58.50', 300], ['1316.25', 355], ['1667.00', 430], ['38447.54', 495], ['Reimbursement', 545], ['181.18', 760], ['Federal W/H', 800], ['119.84', 935], ['3298.76', 1010]);
  row(['Regular', 40], ['24.500', 245], ['14.50', 300], ['355.25', 360], ['FICA', 800], ['103.64', 935], ['2723.85', 1010]);
  row(['Holiday', 40], ['32.00', 430], ['1096.52', 495], ['Medicare', 800], ['24.24', 940], ['637.02', 1010]);
  row(['Overtime', 40], ['53.25', 430], ['1909.69', 495], ['CO W/H', 800], ['65.00', 940], ['1707.00', 1010]);
  row(['CO PFML EE', 800], ['7.36', 945], ['193.31', 1010]);
  row(['CURRENT', 290], ['YTD', 455]);
  row(['Blended OT', 40], ['19.81', 500]);
  row(['Bonus', 40], ['275.27', 495]);
  row(['This', 690]);
  row(['Description', 545], ['Period', 690], ['YTD', 760]);
  row(['CO IRA Roth', 545], ['1325.79', 760]);
  row(['Gross', 100], ['FICA', 170], ['Federal', 250], ['Other', 400]);
  row(['Wages', 100], ['Taxable', 170], ['Taxable', 250], ['Taxes', 330], ['Deducts', 400], ['Net Pay', 480]);
  row(['Current', 40], ['1671.50', 100], ['1671.50', 170], ['1671.50', 250], ['320.08', 330], ['0.00', 400], ['1351.42', 480]);
  row(['YTD', 40], ['43933.03', 100], ['43933.03', 170], ['43933.03', 250], ['8559.94', 330], ['1325.79', 400], ['34228.48', 480]);

  const lines = rowsFromWords(words);
  const p = parsePaystub(lines, [22.5, 24.5]);

  it('takes this period’s amounts, not year to date', () => {
    expect(p.gross).toBe(1671.5);
    expect(p.net).toBe(1351.42);
    const tax = (k: string) => p.lines.find((l) => l.kind === k);
    expect(tax('federal')).toMatchObject({ current: 119.84, ytd: 3298.76 });
    expect(tax('social_security')).toMatchObject({ current: 103.64, ytd: 2723.85 });
    expect(tax('medicare')).toMatchObject({ current: 24.24, ytd: 637.02 });
    expect(tax('famli')).toMatchObject({ current: 7.36, ytd: 193.31 });
    expect(p.warnings).toEqual([]);
  });

  it('a number only in the YTD column means nothing this period', () => {
    expect(p.lines.find((l) => /ROTH/i.test(l.label))).toMatchObject({ current: 0, ytd: 1325.79 });
    // holiday, overtime, blended OT and bonus only have year-to-date amounts
    expect(p.hours.map((h) => [h.hours, h.rate, h.amount])).toEqual([
      [58.5, 22.5, 1316.25],
      [14.5, 24.5, 355.25],
    ]);
  });
});
