// Plaid bank connection, using Plaid's Hosted Link so no server is needed:
//   1. /link/token/create with `hosted_link` → a URL you open in a browser
//   2. you sign in to your bank on Plaid's page
//   3. Pebbles asks /link/token/get for the result → public token(s)
//   4. /item/public_token/exchange → access token, kept on your own devices
//   5. /transactions/sync and /accounts/get keep transactions and balances fresh
import type { HttpFn } from './market';
import { categorize } from './categories';
import { cleanMerchant } from './statements';
import { round2 } from './money';
import type { Account, CategoryRule, Transaction } from './types';

export type PlaidEnv = 'production' | 'sandbox';

export const PLAID_HOSTS: Record<PlaidEnv, string> = {
  production: 'https://production.plaid.com',
  sandbox: 'https://sandbox.plaid.com',
};

export interface PlaidCreds {
  clientId: string;
  secret: string;
  env: PlaidEnv;
}

export class PlaidError extends Error {
  constructor(
    message: string,
    public code: string | null,
  ) {
    super(message);
  }
}

async function call<T>(http: HttpFn, creds: PlaidCreds, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await http(PLAID_HOSTS[creds.env] + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, ...body }),
  });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.text || '{}');
  } catch {
    /* not JSON */
  }
  if (res.status !== 200) {
    const msg = (json.display_message as string) || (json.error_message as string) || `Plaid replied ${res.status}`;
    throw new PlaidError(msg, (json.error_code as string) ?? null);
  }
  return json as T;
}

export interface HostedLink {
  linkToken: string;
  url: string;
  expiration: string;
}

export async function createHostedLink(http: HttpFn, creds: PlaidCreds, userId: string, opts: { redirectUri?: string; accessToken?: string } = {}): Promise<HostedLink> {
  const hosted: Record<string, unknown> = { url_lifetime_seconds: 1800 };
  if (opts.redirectUri) hosted.completion_redirect_uri = opts.redirectUri;
  const body: Record<string, unknown> = {
    client_name: 'Pebbles',
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: userId },
    hosted_link: hosted,
  };
  if (opts.accessToken)
    body.access_token = opts.accessToken; // update mode: re-connect a bank
  else {
    body.products = ['transactions'];
    body.transactions = { days_requested: 730 };
  }
  const r = await call<{ link_token: string; hosted_link_url: string; expiration: string }>(http, creds, '/link/token/create', body);
  if (!r.hosted_link_url) throw new PlaidError('Plaid did not return a sign-in page. Hosted Link may not be enabled for this account yet.', null);
  return { linkToken: r.link_token, url: r.hosted_link_url, expiration: r.expiration };
}

export interface LinkedItem {
  publicToken: string;
  institution: string;
  institutionId: string;
}

export interface LinkResult {
  status: 'waiting' | 'done' | 'exited';
  items: LinkedItem[];
  message?: string;
}

interface LinkTokenGet {
  link_sessions?: {
    finished_at?: string | null;
    results?: { item_add_results?: { public_token: string; institution?: { name?: string; institution_id?: string } }[] } | null;
    exit?: { error?: { display_message?: string; error_message?: string } | null } | null;
  }[];
}

export async function getLinkResult(http: HttpFn, creds: PlaidCreds, linkToken: string): Promise<LinkResult> {
  const r = await call<LinkTokenGet>(http, creds, '/link/token/get', { link_token: linkToken });
  const sessions = r.link_sessions ?? [];
  const items: LinkedItem[] = [];
  for (const s of sessions) {
    for (const it of s.results?.item_add_results ?? []) {
      items.push({ publicToken: it.public_token, institution: it.institution?.name ?? 'Bank', institutionId: it.institution?.institution_id ?? '' });
    }
  }
  if (items.length) return { status: 'done', items };
  // a finished session can take a few seconds to show its results; only treat it as
  // closed when Plaid reports an exit
  const finished = sessions.find((s) => s.finished_at && s.exit);
  if (finished) {
    const err = finished.exit?.error;
    return { status: 'exited', items: [], message: err?.display_message || err?.error_message || 'The bank sign-in was closed before finishing.' };
  }
  return { status: 'waiting', items: [] };
}

export async function exchangePublicToken(http: HttpFn, creds: PlaidCreds, publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const r = await call<{ access_token: string; item_id: string }>(http, creds, '/item/public_token/exchange', { public_token: publicToken });
  return { accessToken: r.access_token, itemId: r.item_id };
}

export async function removeItem(http: HttpFn, creds: PlaidCreds, accessToken: string): Promise<void> {
  await call(http, creds, '/item/remove', { access_token: accessToken });
}

// ---------------- accounts & transactions ----------------

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string; // depository | credit | loan | investment
  subtype?: string | null; // checking | savings | credit card ...
  balances: { current: number | null; available: number | null; iso_currency_code?: string | null };
}

export interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  amount: number; // positive = money out
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null; // on a posted item: the pending item it replaces
  personal_finance_category?: { primary: string; detailed: string } | null;
}

export interface SyncResult {
  added: PlaidTxn[];
  modified: PlaidTxn[];
  removed: string[];
  accounts: PlaidAccount[];
  cursor: string;
}

export async function syncTransactions(http: HttpFn, creds: PlaidCreds, accessToken: string, cursor: string | null): Promise<SyncResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const out: SyncResult = { added: [], modified: [], removed: [], accounts: [], cursor: cursor ?? '' };
    let next = cursor ?? undefined;
    try {
      for (let page = 0; page < 100; page++) {
        const r = await call<{
          added: PlaidTxn[];
          modified: PlaidTxn[];
          removed: { transaction_id: string }[];
          accounts?: PlaidAccount[];
          next_cursor: string;
          has_more: boolean;
        }>(http, creds, '/transactions/sync', { access_token: accessToken, ...(next ? { cursor: next } : {}), count: 500 });
        out.added.push(...r.added);
        out.modified.push(...r.modified);
        out.removed.push(...r.removed.map((x) => x.transaction_id));
        if (r.accounts?.length) out.accounts = r.accounts;
        out.cursor = r.next_cursor;
        next = r.next_cursor;
        if (!r.has_more) return out;
      }
      return out;
    } catch (e) {
      // the bank's data changed mid-download: start this round over
      if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') continue;
      throw e;
    }
  }
  throw new PlaidError('Plaid kept changing during download. Try again in a minute.', null);
}

export async function getAccounts(http: HttpFn, creds: PlaidCreds, accessToken: string): Promise<PlaidAccount[]> {
  const r = await call<{ accounts: PlaidAccount[] }>(http, creds, '/accounts/get', { access_token: accessToken });
  return r.accounts;
}

// ---------------- mapping into Pebbles ----------------

const DETAILED: Record<string, string> = {
  INCOME_WAGES: 'paycheck',
  INCOME_INTEREST_EARNED: 'income_other',
  INCOME_DIVIDENDS: 'income_other',
  INCOME_TAX_REFUND: 'refund',
  TRANSFER_OUT_SAVINGS: 'savings',
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: 'savings',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'cc_payment',
  FOOD_AND_DRINK_GROCERIES: 'groceries',
  FOOD_AND_DRINK_COFFEE: 'dining',
  FOOD_AND_DRINK_FAST_FOOD: 'dining',
  FOOD_AND_DRINK_RESTAURANT: 'dining',
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: 'shopping',
  TRANSPORTATION_GAS: 'gas',
  RENT_AND_UTILITIES_RENT: 'housing',
  RENT_AND_UTILITIES_TELEPHONE: 'phone_internet',
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'phone_internet',
  GENERAL_SERVICES_INSURANCE: 'insurance',
  GENERAL_SERVICES_AUTOMOTIVE: 'transport',
  GENERAL_SERVICES_CHILDCARE: 'childcare',
  GENERAL_SERVICES_EDUCATION: 'childcare',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'gifts',
  ENTERTAINMENT_TV_AND_MOVIES: 'subscriptions',
  ENTERTAINMENT_MUSIC_AND_AUDIO: 'subscriptions',
  GENERAL_MERCHANDISE_PET_SUPPLIES: 'pets',
  MEDICAL_VETERINARY_SERVICES: 'pets',
};

const PRIMARY: Record<string, string> = {
  INCOME: 'income_other',
  TRANSFER_IN: 'transfer',
  TRANSFER_OUT: 'transfer',
  LOAN_PAYMENTS: 'loans',
  BANK_FEES: 'fees',
  ENTERTAINMENT: 'entertainment',
  FOOD_AND_DRINK: 'dining',
  GENERAL_MERCHANDISE: 'shopping',
  HOME_IMPROVEMENT: 'household',
  MEDICAL: 'health',
  PERSONAL_CARE: 'household',
  GENERAL_SERVICES: 'household',
  GOVERNMENT_AND_NON_PROFIT: 'fees',
  TRANSPORTATION: 'transport',
  TRAVEL: 'travel',
  RENT_AND_UTILITIES: 'utilities',
};

export function categoryFor(t: PlaidTxn, rules: CategoryRule[]): string {
  const desc = t.merchant_name ? `${t.merchant_name} ${t.name}` : t.name;
  const amount = -t.amount;
  const keyword = categorize(desc, amount, rules);
  // your own rules and well-known merchants win; otherwise trust Plaid's category
  if (rules.some((r) => r.pattern && desc.toUpperCase().includes(r.pattern.toUpperCase()))) return keyword;
  const d = t.personal_finance_category?.detailed;
  if (d && DETAILED[d]) return DETAILED[d];
  if (keyword !== 'uncategorized' && keyword !== 'income_other') return keyword;
  const p = t.personal_finance_category?.primary;
  if (p && PRIMARY[p]) return PRIMARY[p];
  return keyword;
}

export function accountFromPlaid(a: PlaidAccount, institution: string, linkId: string, today: string): Account {
  const type: Account['type'] =
    a.type === 'credit' ? 'credit' : a.subtype === 'savings' || a.subtype === 'money market' || a.subtype === 'cd' ? 'savings' : a.type === 'depository' ? 'checking' : 'other';
  return {
    id: 'pa_' + a.account_id,
    name: `${institution} ${a.official_name || a.name}`.trim(),
    type,
    institution,
    mask: a.mask ?? undefined,
    balance: a.balances.current,
    available: a.balances.available,
    balanceDate: today,
    source: 'plaid',
    plaidAccountId: a.account_id,
    linkId,
  };
}

export function transactionFromPlaid(t: PlaidTxn, rules: CategoryRule[]): Transaction {
  const description = t.merchant_name && !t.name.toUpperCase().includes(t.merchant_name.toUpperCase()) ? `${t.merchant_name} · ${t.name}` : t.name;
  return {
    id: 'p_' + t.transaction_id,
    accountId: 'pa_' + t.account_id,
    date: t.date,
    description,
    merchant: t.merchant_name || cleanMerchant(t.name),
    amount: round2(-t.amount),
    category: categoryFor(t, rules),
    importId: null,
    excluded: false,
    note: '',
    pending: t.pending,
    source: 'plaid',
  };
}

/** Is this bank transaction already in Pebbles from an imported statement? */
export function looksLikeDuplicate(t: Transaction, existing: Transaction[]): boolean {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .slice(0, 5);
  const k = key(t.merchant || t.description);
  const day = Date.parse(t.date);
  return existing.some(
    (e) =>
      e.source !== 'plaid' &&
      Math.abs(e.amount - t.amount) < 0.005 &&
      Math.abs(Date.parse(e.date) - day) <= 3 * 86_400_000 &&
      (key(e.merchant || e.description) === k || key(e.description) === key(t.description)),
  );
}
