import { store } from './store';
import { effectiveRules } from './useData';
import { http } from '../platform';
import { BUILTIN_EIA_KEY, normalizeSettings } from '../core/defaults';
import { categorize } from '../core/categories';
import { cleanMerchant, transactionIds, type ParsedTxn } from '../core/statements';
import { refreshMarket } from '../core/market';
import { isValidRulesFile, newerVersion } from '../core/taxrules';
import { uid } from '../core/money';
import { today } from '../core/dates';
import type { Allocation } from '../core/budget';
import type { Period } from '../core/pay';
import type { Account, Bill, CategoryRule, Contribution, Goal, MarketData, PaycheckRecord, PayRate, Settings, Transaction, WorkDay } from '../core/types';

export function getSettings(): Settings {
  return normalizeSettings(store.get('settings', 'settings'));
}

export async function saveSettings(update: Partial<Settings> | ((s: Settings) => Settings)) {
  const cur = getSettings();
  const next = typeof update === 'function' ? update(cur) : { ...cur, ...update };
  await store.put('settings', next);
}

export const setWorkDay = (d: WorkDay) => store.put('workdays', d);
export const clearWorkDay = (date: string) => store.remove('workdays', date);
export const saveRate = (r: PayRate) => store.put('rates', r);
export const archiveRate = (r: PayRate) => store.put('rates', { ...r, archived: true });

export const saveBill = (b: Bill) => store.put('bills', b);
export const deleteBill = (id: string) => store.remove('bills', id);

export const saveGoal = (g: Goal) => store.put('goals', g);
export async function deleteGoal(id: string) {
  const contribs = store.list('contributions').filter((c) => c.goalId === id);
  await store.remove('contributions', contribs.map((c) => c.id));
  await store.remove('goals', id);
}
export const addContribution = (c: Contribution) => store.put('contributions', c);
export const deleteContribution = (id: string) => store.remove('contributions', id);

export function newGoal(partial: Partial<Goal> = {}): Goal {
  return {
    id: uid('g_'),
    name: '',
    target: 1000,
    targetDate: null,
    image: null,
    gem: 'jade',
    priority: 2,
    isEmergency: false,
    createdAt: Date.now(),
    completedAt: null,
    archived: false,
    note: '',
    ...partial,
  };
}

export function newBill(partial: Partial<Bill> = {}): Bill {
  return {
    id: uid('b_'),
    name: '',
    amount: 0,
    dueDay: 1,
    dueMonth: null,
    anchorDate: null,
    frequency: 'monthly',
    category: 'utilities',
    autopay: false,
    active: true,
    matchPattern: '',
    ...partial,
  };
}

export async function ensureAccount(name: string, type: Account['type']): Promise<Account> {
  const existing = store.list('accounts').find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const acct: Account = { id: uid('a_'), name, type };
  await store.put('accounts', acct);
  return acct;
}

export async function importTransactions(accountId: string, parsed: ParsedTxn[], fileName: string) {
  const ids = transactionIds(accountId, parsed);
  const rules = store.list('rules');
  const existing = new Set(store.list('transactions').map((t) => t.id));
  const importId = uid('imp_');
  const fresh: Transaction[] = [];
  let duplicates = 0;
  parsed.forEach((p, i) => {
    if (existing.has(ids[i])) {
      duplicates++;
      return;
    }
    const category = categorize(p.description, p.amount, rules);
    fresh.push({
      id: ids[i],
      accountId,
      date: p.date,
      description: p.description,
      merchant: cleanMerchant(p.description),
      amount: p.amount,
      category,
      importId,
      excluded: false,
      note: '',
    });
  });
  if (fresh.length) {
    const dates = fresh.map((t) => t.date).sort();
    await store.putMany('transactions', fresh);
    await store.put('imports', {
      id: importId,
      fileName,
      importedAt: Date.now(),
      accountId,
      count: fresh.length,
      from: dates[0],
      to: dates[dates.length - 1],
    });
  }
  return { added: fresh.length, duplicates };
}

export async function undoImport(importId: string) {
  const ids = store.list('transactions').filter((t) => t.importId === importId).map((t) => t.id);
  await store.remove('transactions', ids);
  await store.remove('imports', importId);
}

export async function updateTransaction(t: Transaction) {
  await store.put('transactions', t);
}

/** Re-categorize one transaction, optionally remembering it for the same merchant. */
export async function recategorize(t: Transaction, category: string, remember: boolean) {
  if (!remember) {
    await store.put('transactions', { ...t, category });
    return 1;
  }
  const pattern = t.merchant.toUpperCase();
  const rule: CategoryRule = { id: uid('r_'), pattern, category, createdAt: Date.now() };
  await store.put('rules', rule);
  const same = store
    .list('transactions')
    .filter((x) => x.description.toUpperCase().includes(pattern) || x.merchant.toUpperCase() === pattern)
    .map((x) => ({ ...x, category }));
  await store.putMany('transactions', same.length ? same : [{ ...t, category }]);
  return Math.max(1, same.length);
}

export async function setSavingsOverride(period: Period, estimatedNet: number, estimatedGross: number, value: number | null) {
  const cur = store.get('paychecks', period.start);
  const rec: PaycheckRecord = cur
    ? { ...cur, savingsOverride: value }
    : {
        id: period.start,
        periodStart: period.start,
        payday: period.payday,
        estimatedNet,
        estimatedGross,
        actualNet: null,
        actualGross: null,
        received: false,
        savingsOverride: value,
        split: null,
        goalAllocations: [],
        note: '',
      };
  await store.put('paychecks', rec);
}

/** Payday: record the real deposit and drop the savings into your goals. */
export async function receivePaycheck(opts: {
  period: Period;
  estimatedNet: number;
  estimatedNetRaw: number;
  estimatedGross: number;
  actualNet: number;
  split: PaycheckRecord['split'];
  allocations: Allocation[];
}) {
  const { period } = opts;
  const prev = store.get('paychecks', period.start);
  // replace earlier contributions from this paycheck if it's re-recorded
  const old = store.list('contributions').filter((c) => c.paycheckId === period.start);
  if (old.length) await store.remove('contributions', old.map((c) => c.id));
  const date = period.payday <= today() ? period.payday : today();
  const contribs: Contribution[] = opts.allocations
    .filter((a) => a.amount > 0)
    .map((a) => ({ id: `pc|${period.start}|${a.goalId}`, goalId: a.goalId, amount: a.amount, date, note: 'From paycheck', paycheckId: period.start, kind: 'deposit' as const }));
  if (contribs.length) await store.putMany('contributions', contribs);
  await store.put('moves', { id: `${period.start}:save`, done: contribs.length > 0, at: Date.now(), auto: false });
  await store.put('paychecks', {
    id: period.start,
    periodStart: period.start,
    payday: period.payday,
    estimatedNet: opts.estimatedNet,
    estimatedNetRaw: opts.estimatedNetRaw,
    estimatedGross: opts.estimatedGross,
    actualNet: opts.actualNet,
    actualGross: prev?.actualGross ?? null,
    received: true,
    savingsOverride: prev?.savingsOverride ?? null,
    split: opts.split,
    goalAllocations: opts.allocations.map((a) => ({ goalId: a.goalId, amount: a.amount })),
    note: prev?.note ?? '',
  });
  // mark goals completed
  for (const g of store.list('goals')) {
    const bal = store.list('contributions').filter((c) => c.goalId === g.id).reduce((s, c) => s + c.amount, 0);
    if (!g.completedAt && bal >= g.target) await store.put('goals', { ...g, completedAt: Date.now() });
  }
}

export async function dismissInsight(id: string) {
  await store.put('dismissed', { id, at: Date.now() });
}

export async function setManualGasPrice(price: number | null) {
  const cur = store.get('market', 'market');
  const base: MarketData = cur ?? { id: 'market', gas: null, foodCpi: null, staples: [], fetchedAt: 0, manualGasPrice: null, errors: [] };
  await store.put('market', { ...base, manualGasPrice: price });
}

let marketBusy = false;
export async function updateMarket(force = false): Promise<string[]> {
  if (marketBusy) return [];
  const cur = store.get('market', 'market') ?? null;
  if (!force && cur && Date.now() - cur.fetchedAt < 12 * 3600_000) return [];
  marketBusy = true;
  try {
    const next = await refreshMarket(http, getSettings().integrations.eiaApiKey.trim() || BUILTIN_EIA_KEY, cur);
    const gotSomething = next.gas !== cur?.gas || next.foodCpi !== cur?.foodCpi;
    if (gotSomething || force || next.errors.length === 0) await store.put('market', next);
    return next.errors;
  } catch (e) {
    return [(e as Error).message];
  } finally {
    marketBusy = false;
  }
}

/** Download the latest tax tables published with Pebbles. */
export async function checkTaxUpdates(force = false): Promise<{ updated: boolean; version: string; error?: string }> {
  const current = effectiveRules();
  const lastCheck = (await store.getMeta<number>('lastTaxCheck')) ?? 0;
  if (!force && Date.now() - lastCheck < 24 * 3600_000) return { updated: false, version: current.version };
  const url = getSettings().integrations.taxRulesUrl;
  try {
    const res = await http(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
    await store.setMeta('lastTaxCheck', Date.now());
    if (res.status !== 200) return { updated: false, version: current.version, error: `Update server replied ${res.status}` };
    const parsed = JSON.parse(res.text);
    if (!isValidRulesFile(parsed)) return { updated: false, version: current.version, error: 'The downloaded tax file was not valid' };
    if (newerVersion(parsed.version, current.version)) {
      await store.put('taxrules', { id: 'current', json: res.text, version: parsed.version, fetchedAt: Date.now() });
      return { updated: true, version: parsed.version };
    }
    return { updated: false, version: current.version };
  } catch (e) {
    return { updated: false, version: current.version, error: (e as Error).message };
  }
}

export async function exportBackup(): Promise<string> {
  return JSON.stringify({ app: 'pebbles', exportedAt: new Date().toISOString(), records: store.exportAll() });
}

export async function restoreBackup(text: string): Promise<number> {
  const json = JSON.parse(text);
  if (json.app !== 'pebbles' || !Array.isArray(json.records)) throw new Error('This is not a Pebbles backup file.');
  await store.importAll(json.records);
  return json.records.length;
}
