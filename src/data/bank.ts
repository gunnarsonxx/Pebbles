// Plaid bank connections: connect, refresh, disconnect.
import { Browser } from '@capacitor/browser';
import { store } from './store';
import { getSettings } from './actions';
import { desktop, http, platformKind } from '../platform';
import {
  accountFromPlaid,
  createHostedLink,
  exchangePublicToken,
  getLinkResult,
  looksLikeDuplicate,
  PlaidError,
  removeItem,
  syncTransactions,
  transactionFromPlaid,
  type PlaidCreds,
} from '../core/plaid';
import { today } from '../core/dates';
import type { Account, BankLink } from '../core/types';

export function plaidCreds(): PlaidCreds | null {
  const s = getSettings().integrations;
  if (!s.plaidClientId.trim() || !s.plaidSecret.trim()) return null;
  return { clientId: s.plaidClientId.trim(), secret: s.plaidSecret.trim(), env: s.plaidEnv };
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

/** Open Plaid's sign-in page and wait for you to finish connecting a bank. */
export async function connectBank(onStatus: (msg: string) => void, reconnect?: BankLink): Promise<string[]> {
  const creds = plaidCreds();
  if (!creds) throw new Error('Add your Plaid keys first.');
  cancelFlag = false;
  onStatus('Opening a secure sign-in page…');
  let link;
  const redirect = platformKind === 'android' ? 'pebbles://plaid' : undefined;
  try {
    link = await createHostedLink(http, creds, store.deviceId, { redirectUri: redirect, accessToken: reconnect?.accessToken });
  } catch (e) {
    // some accounts don't allow a custom return address yet: carry on without it
    if (redirect && e instanceof PlaidError && /redirect/i.test(e.message)) link = await createHostedLink(http, creds, store.deviceId, { accessToken: reconnect?.accessToken });
    else throw e;
  }
  await openUrl(link.url);
  onStatus('Finish signing in to your bank in the window that opened. Pebbles is waiting…');
  const started = Date.now();
  while (!cancelFlag && Date.now() - started < 30 * 60_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await getLinkResult(http, creds, link.linkToken);
    if (res.status === 'waiting') continue;
    if (platformKind === 'android') void Browser.close().catch(() => {});
    if (res.status === 'exited') throw new Error(res.message ?? 'Sign-in was closed.');
    if (reconnect) {
      await store.put('links', { ...reconnect, error: null });
      onStatus('Reconnected. Getting transactions…');
      await syncBank({ ...reconnect, error: null });
      return [reconnect.institution];
    }
    const names: string[] = [];
    for (const item of res.items) {
      const { accessToken, itemId } = await exchangePublicToken(http, creds, item.publicToken);
      const bank: BankLink = { id: itemId, institution: item.institution, institutionId: item.institutionId, accessToken, cursor: null, createdAt: Date.now(), lastSync: null, error: null };
      await store.put('links', bank);
      names.push(item.institution);
      onStatus(`Connected ${item.institution}. Getting transactions…`);
      await syncBank(bank).catch(() => {});
    }
    return names;
  }
  throw new Error(cancelFlag ? 'Cancelled.' : 'Timed out waiting for the bank sign-in.');
}

/** Pull new, changed and removed transactions plus balances for one bank. */
export async function syncBank(link: BankLink): Promise<{ added: number }> {
  const creds = plaidCreds();
  if (!creds) return { added: 0 };
  try {
    const r = await syncTransactions(http, creds, link.accessToken, link.cursor);
    const rules = store.list('rules');
    // accounts & balances (keep anything you changed by hand)
    const accounts: Account[] = r.accounts.map((a) => {
      const fresh = accountFromPlaid(a, link.institution, link.id, today());
      const cur = store.get('accounts', fresh.id);
      return cur ? { ...fresh, name: cur.name || fresh.name, apy: cur.apy ?? null, holdsGoals: cur.holdsGoals } : fresh;
    });
    if (!store.list('accounts').some((a) => a.holdsGoals)) {
      const marcus = accounts.find((a) => a.type === 'savings' && /marcus|goldman/i.test(`${a.institution} ${a.name}`)) ?? (accounts.filter((a) => a.type === 'savings').length === 1 ? accounts.find((a) => a.type === 'savings') : undefined);
      if (marcus) marcus.holdsGoals = true;
    }
    if (accounts.length) await store.putMany('accounts', accounts);
    const existing = store.list('transactions');
    const fresh = [...r.added, ...r.modified].map((t) => transactionFromPlaid(t, rules));
    const keep = fresh.filter((t) => {
      const cur = store.get('transactions', t.id);
      if (cur) return true; // update
      return !looksLikeDuplicate(t, existing);
    });
    // preserve your edits (category, notes, excluded) on transactions Pebbles already has
    const merged = keep.map((t) => {
      const cur = store.get('transactions', t.id);
      return cur ? { ...t, category: cur.category, note: cur.note, excluded: cur.excluded } : t;
    });
    if (merged.length) await store.putMany('transactions', merged);
    const removed = r.removed.map((id) => 'p_' + id).filter((id) => store.get('transactions', id));
    if (removed.length) await store.remove('transactions', removed);
    await store.put('links', { ...link, cursor: r.cursor, lastSync: Date.now(), error: null });
    return { added: merged.length };
  } catch (e) {
    const msg = e instanceof PlaidError && e.code === 'ITEM_LOGIN_REQUIRED' ? 'Your bank needs you to sign in again.' : (e as Error).message;
    await store.put('links', { ...link, error: msg, lastSync: link.lastSync });
    throw e;
  }
}

let syncing = false;
export async function syncAllBanks(force = false): Promise<void> {
  if (syncing || !plaidCreds()) return;
  syncing = true;
  try {
    for (const link of store.list('links')) {
      if (!force && link.lastSync && Date.now() - link.lastSync < 4 * 3600_000) continue;
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
}
