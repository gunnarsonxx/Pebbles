// Plaid bank connections: connect, recover, refresh, disconnect.
//
// Every sign-in Pebbles starts is saved right away ("pending"), so if the app is paused,
// closed or reloaded while you sign in to your bank, the next refresh still finds the
// finished connection (Plaid keeps the result for 6 hours) and adds it.
import { Browser } from '@capacitor/browser';
import { store } from './store';
import { getSettings } from './actions';
import { desktop, http, platformKind } from '../platform';
import {
  accountFromPlaid,
  createHostedLink,
  exchangePublicToken,
  getAccounts,
  getLinkResult,
  looksLikeDuplicate,
  PlaidError,
  removeItem,
  syncTransactions,
  transactionFromPlaid,
  type LinkedItem,
  type PlaidCreds,
} from '../core/plaid';
import { today } from '../core/dates';
import type { Account, BankLink } from '../core/types';

export function plaidCreds(): PlaidCreds | null {
  const s = getSettings().integrations;
  if (!s.plaidClientId.trim() || !s.plaidSecret.trim()) return null;
  return { clientId: s.plaidClientId.trim(), secret: s.plaidSecret.trim(), env: s.plaidEnv };
}

// ---------------- status log (shown on the Accounts screen) ----------------

export interface BankLogEntry {
  at: number;
  msg: string;
  error?: boolean;
}

const logListeners = new Set<() => void>();
let logCache: BankLogEntry[] = [];

export const bankLog = {
  get: () => logCache,
  subscribe: (l: () => void) => {
    logListeners.add(l);
    return () => logListeners.delete(l);
  },
};

export async function loadBankLog() {
  logCache = (await store.getMeta<BankLogEntry[]>('bankLog')) ?? [];
  logListeners.forEach((l) => l());
}

async function log(msg: string, error = false) {
  logCache = [{ at: Date.now(), msg, error }, ...logCache].slice(0, 25);
  logListeners.forEach((l) => l());
  await store.setMeta('bankLog', logCache);
}

// ---------------- pending sign-ins ----------------

interface PendingLink {
  linkToken: string;
  startedAt: number;
  reconnectId?: string;
}

async function pendingLinks(): Promise<PendingLink[]> {
  const list = (await store.getMeta<PendingLink[]>('plaidPending')) ?? [];
  // Plaid keeps results for 6 hours
  return list.filter((p) => Date.now() - p.startedAt < 6 * 3600_000);
}

async function setPending(list: PendingLink[]) {
  await store.setMeta('plaidPending', list);
}

async function openUrl(url: string) {
  if (desktop) return desktop.openExternal(url);
  if (platformKind === 'android') return Browser.open({ url });
  window.open(url, '_blank');
}

let cancelFlag = false;
export function cancelConnect() {
  cancelFlag = true;
}

/** Add the banks from a finished sign-in; skips (and unlinks) duplicates of banks you already have. */
async function addItems(items: LinkedItem[]): Promise<string[]> {
  const creds = plaidCreds()!;
  const names: string[] = [];
  for (const item of items) {
    const { accessToken, itemId } = await exchangePublicToken(http, creds, item.publicToken);
    if (store.get('links', itemId)) continue;
    const dup = store.list('links').find((l) => l.institutionId && l.institutionId === item.institutionId);
    if (dup) {
      // you connected the same bank twice: keep the newer login, release the old one at Plaid
      await removeItem(http, creds, dup.accessToken).catch(() => {});
      await store.remove('links', dup.id);
      await log(`Replaced an older connection to ${item.institution}`);
    }
    const bank: BankLink = { id: itemId, institution: item.institution, institutionId: item.institutionId, accessToken, cursor: null, createdAt: Date.now(), lastSync: null, error: null };
    await store.put('links', bank);
    await log(`Connected ${item.institution}`);
    names.push(item.institution);
    await syncBank(bank).catch(() => {});
  }
  return names;
}

let recovering: Promise<string[]> | null = null;

/** Check every sign-in started in the last 6 hours and finish any that completed. */
export function recoverPendingLinks(): Promise<string[]> {
  if (!recovering) recovering = doRecover().finally(() => (recovering = null));
  return recovering;
}

async function doRecover(): Promise<string[]> {
  const creds = plaidCreds();
  if (!creds) return [];
  const list = await pendingLinks();
  const still: PendingLink[] = [];
  const names: string[] = [];
  for (const p of list) {
    try {
      const r = await getLinkResult(http, creds, p.linkToken);
      if (r.status === 'done') {
        if (p.reconnectId) {
          const link = store.get('links', p.reconnectId);
          if (link) {
            await store.put('links', { ...link, error: null });
            await syncBank({ ...link, error: null }).catch(() => {});
            names.push(link.institution);
          }
        } else names.push(...(await addItems(r.items)));
      } else if (r.status === 'waiting') still.push(p);
      else await log(r.message ?? 'A bank sign-in was closed before finishing.', true);
    } catch (e) {
      await log(`Couldn’t check a bank sign-in: ${(e as Error).message}`, true);
      still.push(p);
    }
  }
  await setPending(still);
  return names;
}

/** Open Plaid's sign-in page and wait for you to finish connecting a bank. */
export async function connectBank(onStatus: (msg: string) => void, reconnect?: BankLink): Promise<string[]> {
  const creds = plaidCreds();
  if (!creds) throw new Error('Add your Plaid keys first (Settings → Connections).');
  cancelFlag = false;
  onStatus('Opening a secure sign-in page…');
  let link;
  const redirect = platformKind === 'android' ? 'pebbles://plaid' : undefined;
  try {
    link = await createHostedLink(http, creds, store.deviceId, { redirectUri: redirect, accessToken: reconnect?.accessToken });
  } catch (e) {
    // some accounts don't allow a custom return address yet: carry on without it
    if (redirect && e instanceof PlaidError && /redirect|uri/i.test(e.message)) link = await createHostedLink(http, creds, store.deviceId, { accessToken: reconnect?.accessToken });
    else {
      await log(`Plaid refused to start a sign-in: ${(e as Error).message}`, true);
      throw e;
    }
  }
  await setPending([...(await pendingLinks()), { linkToken: link.linkToken, startedAt: Date.now(), reconnectId: reconnect?.id }]);
  await log(reconnect ? `Started signing in again to ${reconnect.institution}` : 'Started a bank sign-in');
  await openUrl(link.url);
  onStatus('Finish signing in to your bank in the window that opened. Pebbles is waiting…');
  const started = Date.now();
  while (!cancelFlag && Date.now() - started < 30 * 60_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const names = await recoverPendingLinks();
    const stillPending = (await pendingLinks()).some((p) => p.linkToken === link.linkToken);
    if (!stillPending) {
      if (platformKind === 'android') void Browser.close().catch(() => {});
      return names;
    }
  }
  throw new Error(cancelFlag ? 'Stopped waiting. If you finish signing in, tap Refresh and Pebbles will pick it up.' : 'Timed out waiting for the bank sign-in. Tap Refresh after you finish.');
}

/** Pull new, changed and removed transactions plus balances for one bank. */
export async function syncBank(link: BankLink): Promise<{ added: number }> {
  const creds = plaidCreds();
  if (!creds) return { added: 0 };
  try {
    const r = await syncTransactions(http, creds, link.accessToken, link.cursor);
    const rules = store.list('rules');
    // accounts & balances come from /accounts/get so they show up even before transactions are ready
    const plaidAccounts = await getAccounts(http, creds, link.accessToken).catch(() => r.accounts);
    const accounts: Account[] = (plaidAccounts.length ? plaidAccounts : r.accounts).map((a) => {
      const fresh = accountFromPlaid(a, link.institution, link.id, today());
      const cur = store.get('accounts', fresh.id);
      return cur ? { ...fresh, name: cur.name || fresh.name, apy: cur.apy ?? null, holdsGoals: cur.holdsGoals } : fresh;
    });
    if (!store.list('accounts').some((a) => a.holdsGoals)) {
      const marcus =
        accounts.find((a) => a.type === 'savings' && /marcus|goldman/i.test(`${a.institution} ${a.name}`)) ??
        (accounts.filter((a) => a.type === 'savings').length === 1 ? accounts.find((a) => a.type === 'savings') : undefined);
      if (marcus) marcus.holdsGoals = true;
    }
    if (accounts.length) await store.putMany('accounts', accounts);
    const existing = store.list('transactions');
    const fresh = [...r.added, ...r.modified].map((t) => transactionFromPlaid(t, rules));
    const keep = fresh.filter((t) => store.get('transactions', t.id) || !looksLikeDuplicate(t, existing));
    // preserve your edits (category, notes, excluded) on transactions Pebbles already has
    // a pending item that just posted comes back with a new id: carry over what you set on the pending one
    const pendingOf = new Map([...r.added, ...r.modified].filter((p) => p.pending_transaction_id).map((p) => ['p_' + p.transaction_id, 'p_' + p.pending_transaction_id]));
    const merged = keep.map((t) => {
      const cur = store.get('transactions', t.id) ?? (pendingOf.has(t.id) ? store.get('transactions', pendingOf.get(t.id)!) : undefined);
      return cur ? { ...t, category: cur.category, note: cur.note, excluded: cur.excluded, dupOf: cur.dupOf, seenBank: cur.seenBank, bankHas: cur.bankHas } : t;
    });
    // goal money split from the pending deposit moves to the posted one (so it isn't counted twice)
    const moved = [];
    const drop: string[] = [];
    for (const [posted, pend] of pendingOf) {
      for (const c of store.list('contributions')) {
        for (const kind of ['dep', 'wd']) {
          if (c.id.startsWith(`${kind}|${pend}|`)) {
            moved.push({ ...c, id: c.id.replace(`${kind}|${pend}|`, `${kind}|${posted}|`) });
            drop.push(c.id);
          }
        }
      }
    }
    if (drop.length) await store.remove('contributions', drop);
    if (moved.length) await store.putMany('contributions', moved);
    if (merged.length) await store.putMany('transactions', merged);
    const removed = r.removed.map((id) => 'p_' + id).filter((id) => store.get('transactions', id));
    if (removed.length) await store.remove('transactions', removed);
    await store.put('links', { ...link, cursor: r.cursor, lastSync: Date.now(), error: null });
    await log(
      `${link.institution}: ${accounts.length} account${accounts.length === 1 ? '' : 's'}, ${merged.length} new or updated transaction${merged.length === 1 ? '' : 's'}` +
        (merged.length === 0 && !link.cursor ? ' (banks can take a few minutes to send history the first time)' : ''),
    );
    return { added: merged.length };
  } catch (e) {
    const msg = e instanceof PlaidError && e.code === 'ITEM_LOGIN_REQUIRED' ? 'Your bank needs you to sign in again.' : (e as Error).message;
    await store.put('links', { ...link, error: msg, lastSync: link.lastSync });
    await log(`${link.institution}: ${msg}`, true);
    throw e;
  }
}

let syncing = false;
export async function syncAllBanks(force = false): Promise<void> {
  if (syncing || !plaidCreds()) return;
  syncing = true;
  try {
    await recoverPendingLinks().catch(() => {});
    for (const link of store.list('links')) {
      // banks that haven't sent anything yet are retried every time
      if (!force && link.cursor && link.lastSync && Date.now() - link.lastSync < 30 * 60_000) continue;
      await syncBank(link).catch(() => {});
    }
  } finally {
    syncing = false;
  }
}

export async function disconnectBank(link: BankLink): Promise<void> {
  const creds = plaidCreds();
  if (creds) await removeItem(http, creds, link.accessToken).catch(() => {});
  await store.remove('links', link.id);
  await log(`Disconnected ${link.institution}`);
}
