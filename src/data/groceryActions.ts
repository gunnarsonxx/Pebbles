import { store } from './store';
import { effectiveGuidelines, effectiveRules } from './useData';
import { getSettings, saveSettings } from './actions';
import { http } from '../platform';
import { uid } from '../core/money';
import { krogerLocations, krogerPrice, krogerToken, type KrogerLocation } from '../core/kroger';
import { analyzeGroceries } from '../core/groceries';
import { deductionsFromStub } from '../core/paystub';
import { estimatePaycheck } from '../core/paycheck';
import { computeWithholding } from '../core/tax';
import { rulesForYear } from '../core/taxrules';
import { periodContaining } from '../core/pay';
import { GUIDELINES_URL, isValidGuidelines } from '../core/guidelines';
import { newerVersion } from '../core/taxrules';
import { krogerStoresOf, normalizeSettings } from '../core/defaults';
import { today } from '../core/dates';
import type { GroceryDept, Paystub, Receipt, ReceiptItem } from '../core/types';

// ---------------- receipts ----------------

export async function saveReceipt(r: Omit<Receipt, 'id' | 'createdAt'> & { id?: string }): Promise<void> {
  await store.put('receipts', { ...r, id: r.id ?? uid('rc_'), createdAt: Date.now() });
}

export const deleteReceipt = (id: string) => store.remove('receipts', id);

/** Remember a department (and friendly name) for an item from now on. */
export async function rememberItem(item: ReceiptItem, dept: GroceryDept, name?: string): Promise<void> {
  await store.put('itemrules', { id: item.key, name: name ?? item.name, dept });
}

// ---------------- King Soopers prices ----------------

export async function findKrogerStores(zip: string): Promise<KrogerLocation[]> {
  const s = getSettings().integrations;
  const token = await krogerToken(http, s.krogerClientId.trim(), s.krogerSecret.trim());
  return krogerLocations(http, token, zip);
}

let pricing = false;
/** Look up King Soopers prices for your usual items (once a day). */
export async function refreshStorePrices(force = false): Promise<{ updated: number; error?: string }> {
  const s = getSettings().integrations;
  const stores = krogerStoresOf(s);
  if (pricing || !s.krogerClientId || !s.krogerSecret || !stores.length) return { updated: 0 };
  const stats = analyzeGroceries(store.list('receipts'), today());
  if (!stats) return { updated: 0 };
  const items = [...stats.usual, ...stats.items.filter((i) => i.trips >= 2)].filter((v, i, a) => a.findIndex((x) => x.key === v.key) === i).slice(0, 20);
  pricing = true;
  try {
    const token = await krogerToken(http, s.krogerClientId.trim(), s.krogerSecret.trim());
    let updated = 0;
    for (const st of stores)
      for (const it of items) {
        const id = `${st.id}|${it.key}`;
        const cur = store.get('prices', id);
        if (!force && cur && Date.now() - cur.fetchedAt < 20 * 3600_000) continue;
        const p = await krogerPrice(http, token, st.id, it.name).catch(() => null);
        if (!p) continue;
        await store.put('prices', { id, store: st.name, description: p.description, regular: p.regular, promo: p.promo, size: p.size, fetchedAt: Date.now() });
        updated++;
      }
    return { updated };
  } catch (e) {
    return { updated: 0, error: (e as Error).message };
  } finally {
    pricing = false;
  }
}

// ---------------- pay stubs ----------------

export interface ApplyStubOptions {
  applyDeductions: boolean;
  recordPaycheck: boolean;
  updateBaseRate: number | null;
}

/** Save a pay stub and use it to make future estimates exact. */
export async function applyPaystub(stub: Omit<Paystub, 'id' | 'createdAt'>, opts: ApplyStubOptions): Promise<string[]> {
  const done: string[] = [];
  await store.put('paystubs', { ...stub, id: uid('ps_'), createdAt: Date.now() });
  if (opts.applyDeductions) {
    const ded = deductionsFromStub(stub);
    if (ded.length) {
      await saveSettings((s) => ({ ...s, deductions: ded }));
      done.push(`Set ${ded.length} paycheck deduction${ded.length === 1 ? '' : 's'} from your stub`);
    }
  }
  if (opts.updateBaseRate && opts.updateBaseRate > 0) {
    await saveSettings((s) => ({ ...s, pay: { ...s.pay, baseRate: opts.updateBaseRate as number } }));
    done.push(`Updated your base rate to $${opts.updateBaseRate.toFixed(2)}`);
  }
  if (opts.recordPaycheck && stub.net != null) {
    const settings = normalizeSettings(store.get('settings', 'settings'));
    const ref = stub.periodStart ?? stub.payDate ?? today();
    const period = periodContaining(settings.pay, ref);
    const workdays = new Map(store.list('workdays').map((w) => [w.date, w]));
    // re-estimate with the new deductions so the remaining gap is truly unexplained
    const est = estimatePaycheck(period, settings, store.list('rates'), workdays, effectiveRules());
    // taxes and deductions at the stub's own gross, so hours you didn't log don't skew the match
    const atStubGross = stub.gross != null ? computeWithholding(stub.gross, settings, rulesForYear(effectiveRules(), Number(period.payday.slice(0, 4))).rules).net : est.withholding.net;
    const prev = store.get('paychecks', period.start);
    await store.put('paychecks', {
      id: period.start,
      periodStart: period.start,
      payday: period.payday,
      estimatedNet: est.net,
      estimatedNetRaw: atStubGross,
      estimatedGross: est.gross.gross,
      actualNet: stub.net,
      actualGross: stub.gross,
      received: true,
      savingsOverride: prev?.savingsOverride ?? null,
      split: prev?.split ?? null,
      goalAllocations: prev?.goalAllocations ?? [],
      note: 'From pay stub',
    });
    done.push(`Recorded the ${period.payday} paycheck: $${stub.net.toFixed(2)}`);
  }
  return done;
}

// ---------------- guidelines updates ----------------

export async function checkGuidelineUpdates(): Promise<void> {
  const last = (await store.getMeta<number>('lastGuidelinesCheck')) ?? 0;
  if (Date.now() - last < 24 * 3600_000) return;
  try {
    const res = await http(GUIDELINES_URL + '?t=' + Date.now());
    await store.setMeta('lastGuidelinesCheck', Date.now());
    if (res.status !== 200) return;
    const parsed = JSON.parse(res.text);
    if (isValidGuidelines(parsed) && newerVersion(parsed.version, effectiveGuidelines().version)) {
      await store.put('guidelines', { id: 'current', json: res.text, version: parsed.version, fetchedAt: Date.now() });
    }
  } catch {
    /* offline */
  }
}
