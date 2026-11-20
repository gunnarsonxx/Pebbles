// Pantry, shopping list and gas prices: saving and syncing.
import { store } from './store';
import { getSettings, saveSettings } from './actions';
import { http } from '../platform';
import { today } from '../core/dates';
import { round2, uid } from '../core/money';
import { matches, newPantryItem, restockFromReceipt, type ListLine } from '../core/pantry';
import { applyPicks, claimForStaple, type KitchenPick } from '../core/kitchen';
import { usedUp, type RecipeMatch } from '../core/recipes';
import { geocodeAddress, googleStations, stationsNear, type Point, type Station } from '../core/gas';
import type { GasPrice, PantryItem, Receipt, Recipe, ShopItem, Staple } from '../core/types';

export const savePantryItem = (p: PantryItem) => store.put('pantry', p);
export const savePantryItems = (ps: PantryItem[]) => store.putMany('pantry', ps);
export const deletePantryItem = (id: string) => store.remove('pantry', id);

export async function addToList(name: string, pantryId: string | null = null, key = ''): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  const item: ShopItem = { id: uid('shop_'), name: clean, key: key || clean.toLowerCase().replace(/[^a-z]/g, '').slice(0, 24), qty: 1, pantryId, done: false, doneAt: null, addedAt: Date.now() };
  await store.put('shoplist', item);
}

/** Checked off in the store: restock the pantry item (if any) and tick the line. */
export async function boughtLine(line: ListLine): Promise<() => Promise<void>> {
  const prevPantry = line.pantry ? { ...line.pantry } : null;
  const prevShop = line.shop ? { ...line.shop } : null;
  if (line.pantry) {
    const p = line.pantry;
    await store.put('pantry', { ...p, lastBought: today(), ...(p.mode === 'level' ? { level: 'full' as const } : { qty: round2(Math.max(0, p.qty) + p.perBuy * Math.max(1, line.qty)) }) });
  }
  if (line.shop) await store.put('shoplist', { ...line.shop, done: true, doneAt: Date.now() });
  // undo
  return async () => {
    if (prevPantry) await store.put('pantry', prevPantry);
    if (prevShop) await store.put('shoplist', prevShop);
  };
}

export async function removeShopItem(id: string) {
  await store.remove('shoplist', id);
}

export async function clearBought() {
  const done = store.list('shoplist').filter((s) => s.done);
  if (done.length) await store.remove('shoplist', done.map((s) => s.id));
}

/** After a receipt is saved: restock the pantry, tick list items it covers, and log the gas price. */
export async function afterReceipt(r: Receipt, at: Point | null = null, restock = true): Promise<{ restocked: number }> {
  const pantry = store.list('pantry');
  const changed = restock ? restockFromReceipt(pantry, r) : [];
  if (changed.length) await store.putMany('pantry', changed);
  const shop = store.list('shoplist').filter((s) => !s.done && r.items.some((i) => matches({ key: s.key, name: s.name } as PantryItem, i.key, i.name)));
  if (shop.length) await store.putMany('shoplist', shop.map((s) => ({ ...s, done: true, doneAt: Date.now() })));
  if (r.fuel) {
    await store.put('gasprices', {
      id: `rc|${r.id}`,
      station: r.store,
      stationId: null,
      lat: at?.lat ?? null,
      lon: at?.lon ?? null,
      perGallon: r.fuel.perGallon,
      grade: r.fuel.grade,
      date: r.date,
      source: 'receipt',
      areaAvg: areaAvgNow(),
    });
  }
  return { restocked: changed.length };
}

// ---------------- gas ----------------

export async function setHomeAddress(address: string): Promise<string> {
  const g = await geocodeAddress(http, address);
  await saveSettings((s) => ({ ...s, integrations: { ...s.integrations, homeAddress: address.trim(), homeLat: g.lat, homeLon: g.lon } }));
  return g.matched;
}

export function currentPosition(): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device can’t share its location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'Location is off for Pebbles. Allow it in your phone’s settings to see stations near you.' : 'Couldn’t get your location right now.')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60_000 },
    );
  });
}

export interface StationCache {
  at: number;
  where: Point;
  stations: Station[];
  source: 'osm' | 'google';
  googleAt?: number; // when Google prices were last fetched for this spot
  googleError?: string; // why Google prices couldn't load (the free station map is shown instead)
  note?: string; // e.g. "Prices from 40 min ago" when a refresh was held back
}

// ---------------- Google usage limits ----------------
// Google gives 1,000 free gas-price lookups a month (the most expensive tier this could fall
// under). Pebbles stays far below that no matter how often you tap Refresh.
export const GOOGLE_LIMITS = { perDay: 20, perMonth: 400, minGapMs: 30 * 60_000, freshMs: 3 * 3600_000 };

interface GoogleUsage {
  month: string;
  monthCount: number;
  day: string;
  dayCount: number;
}

export async function googleUsage(): Promise<GoogleUsage> {
  const t = today();
  const u = (await store.getMeta<GoogleUsage>('googleUsage')) ?? { month: t.slice(0, 7), monthCount: 0, day: t, dayCount: 0 };
  return { month: t.slice(0, 7), monthCount: u.month === t.slice(0, 7) ? u.monthCount : 0, day: t, dayCount: u.day === t ? u.dayCount : 0 };
}

/** Count one Google lookup, or say why it's not allowed right now. */
export async function useGoogleLookup(): Promise<string | null> {
  const u = await googleUsage();
  if (u.dayCount >= GOOGLE_LIMITS.perDay) return `Pebbles already checked Google ${u.dayCount} times today (its limit, to keep you in the free tier). Live prices refresh again tomorrow.`;
  if (u.monthCount >= GOOGLE_LIMITS.perMonth) return `Pebbles reached its ${GOOGLE_LIMITS.perMonth} Google lookups for this month (well inside the free 1,000). Live prices come back on the 1st.`;
  await store.setMeta('googleUsage', { ...u, monthCount: u.monthCount + 1, dayCount: u.dayCount + 1 });
  return null;
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** Stations around a point: live Google prices when you've added a key (within the free limits), else the free station map. */
export async function loadStations(where: 'home' | 'here', point: Point, force = false): Promise<StationCache> {
  const cacheKey = `gasStations:v2:${where}`; // v2: closed and no-pump places filtered out
  const cached = await store.getMeta<StationCache>(cacheKey);
  const moved = cached ? Math.abs(cached.where.lat - point.lat) + Math.abs(cached.where.lon - point.lon) > 0.01 : true;
  const g = getSettings().integrations.googlePlacesKey.trim();
  const now = Date.now();

  if (!g) {
    if (cached && !force && !moved && cached.source === 'osm' && now - cached.at < 7 * 24 * 3600_000) return cached;
    const val: StationCache = { at: now, where: point, stations: (await stationsNear(http, point)).slice(0, 25), source: 'osm' };
    await store.setMeta(cacheKey, val);
    return val;
  }

  // with a key: reuse Google prices for 3 hours; a manual refresh can go sooner, but not more than every 30 min
  const lastGoogle = !moved && cached?.source === 'google' ? (cached.googleAt ?? cached.at) : 0;
  // no prices last time? Google likely has none for this area: check once a day instead of every 3 hours
  const noPrices = cached?.source === 'google' && !cached.stations.some((x) => x.live);
  const fresh = lastGoogle && now - lastGoogle < (force ? GOOGLE_LIMITS.minGapMs : noPrices ? 24 * 3600_000 : GOOGLE_LIMITS.freshMs);
  if (cached && fresh) return { ...cached, note: force ? `Prices from ${ago(now - lastGoogle)}. Google is checked at most every 30 minutes to stay free.` : undefined };

  const blocked = await useGoogleLookup();
  if (!blocked) {
    try {
      const stations = await googleStations(http, g, point);
      const val: StationCache = { at: now, googleAt: now, where: point, stations: stations.slice(0, 25), source: 'google' };
      await store.setMeta(cacheKey, val);
      return val;
    } catch (e) {
      const msg = googleMessage((e as Error).message);
      const stations = await stationsNear(http, point).catch(() => cached?.stations ?? []);
      const val: StationCache = { at: now, where: point, stations: stations.slice(0, 25), source: 'osm', googleError: msg };
      await store.setMeta(cacheKey, val);
      return val;
    }
  }
  // over the free limits: keep showing the last prices
  if (cached && !moved) return { ...cached, note: blocked };
  const val: StationCache = { at: now, where: point, stations: (await stationsNear(http, point)).slice(0, 25), source: 'osm', note: blocked };
  await store.setMeta(cacheKey, val);
  return val;
}

/** Turn Google's error into what to do about it. */
export function googleMessage(raw: string): string {
  if (/not been used|is disabled|SERVICE_DISABLED|has not been enabled/i.test(raw)) return 'Google says Places API (New) isn’t turned on for this key’s project. In Google Cloud: APIs & Services → Library → “Places API (New)” → Enable. (The older “Places API” is a different one.)';
  if (/billing/i.test(raw)) return 'Google says billing isn’t set up on this project. Places needs a billing account even though Pebbles stays in the free tier.';
  if (/API key not valid|API_KEY_INVALID/i.test(raw)) return 'Google says the key isn’t valid. Copy it again from Google Cloud → APIs & Services → Credentials.';
  if (/referer|android|ios|restricted|not authorized|API_KEY_.*BLOCKED|blocked/i.test(raw))
    return 'Google blocked the key because of its restrictions. In Google Cloud → Credentials → your key: set Application restrictions to “None” and API restrictions to “Places API (New)”.';
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(raw)) return 'Google’s daily limit for this key was reached. Prices come back tomorrow.';
  return `Google couldn’t load prices: ${raw}`;
}

/** This week's Colorado average, saved with each price so Pebbles learns how stations compare. */
export function areaAvgNow(): number | null {
  return store.get('market', 'market')?.gas?.price ?? null;
}

export async function logGasPrice(st: Station, perGallon: number, grade = 'Regular', source: GasPrice['source'] = 'manual'): Promise<void> {
  const rec: GasPrice = { id: uid('gp_'), station: st.brand ?? st.name, stationId: st.id, lat: st.lat, lon: st.lon, perGallon, grade, date: today(), source, areaAvg: areaAvgNow() };
  await store.put('gasprices', rec);
}

// ---------------- staples, receipt picks, meals ----------------

/** Save a staple; pantry items that match it (and aren't in another staple) join it. */
export async function saveStaple(st: Staple): Promise<number> {
  await store.put('staples', st);
  const claimed = claimForStaple(st, store.list('pantry'));
  if (claimed.length) await store.putMany('pantry', claimed);
  return claimed.length;
}

export async function deleteStaple(id: string) {
  const members = store.list('pantry').filter((p) => p.stapleId === id);
  if (members.length) await store.putMany('pantry', members.map((p) => ({ ...p, stapleId: null })));
  await store.remove('staples', id);
}

/** From a receipt: only the items you said are still in your kitchen go in the pantry. */
/** Returns what happened, in words: "Added Coffee · updated Milk". */
export async function applyKitchenPicks(picks: KitchenPick[], receiptDate: string): Promise<string> {
  const res = applyPicks(picks, store.list('pantry'), store.list('staples'), receiptDate, store.list('itemrules'));
  if (res.pantry.length) await store.putMany('pantry', res.pantry);
  if (res.staples.length) await store.putMany('staples', res.staples);
  const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));
  const parts = [res.added.length ? `Added ${list(res.added)}` : '', res.updated.length ? `${res.added.length ? 'updated' : 'Updated'} ${list(res.updated)}` : ''].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} in your pantry` : 'Nothing to add';
}

/** Bought something for a staple: that product is now in the pantry, full. */
export async function gotForStaple(st: Staple, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  const pantry = store.list('pantry');
  const existing = pantry.find((p) => !p.archived && p.name.toLowerCase() === clean.toLowerCase());
  const item = existing ?? newPantryItem(clean, {}, store.list('itemrules'));
  await store.put('pantry', { ...item, stapleId: st.id, lastBought: today(), ...(item.mode === 'level' ? { level: 'full' as const } : { qty: Math.max(item.qty, item.perBuy) }) });
  if (!st.examples.some((e) => e.toLowerCase() === clean.toLowerCase())) await store.put('staples', { ...st, examples: [...st.examples, item.name] });
}

export const saveRecipe = (r: Recipe) => store.put('recipes', r);
export const deleteRecipe = (id: string) => store.remove('recipes', id);

export async function addToPlan(id: string, batches = 1) {
  const cur = store.get('mealplan', id);
  await store.put('mealplan', { id, batches: (cur && !cur.cookedAt ? cur.batches : 0) + batches, addedAt: cur && !cur.cookedAt ? cur.addedAt : Date.now(), cookedAt: null });
}
export const removeFromPlan = (id: string) => store.remove('mealplan', id);

/** Cooked it: the pantry items it used go down, and it's ticked in this week's prep. */
/** Cooked it: save what's left of what it used (as you set it), and tick it in this week's prep. */
export async function cooked(m: RecipeMatch, after?: PantryItem[]): Promise<() => Promise<void>> {
  const used = after ?? usedUp(m);
  const before = used.map((u) => store.get('pantry', u.id)).filter((x): x is PantryItem => !!x);
  const plan = store.get('mealplan', m.recipe.id);
  if (used.length) await store.putMany('pantry', used);
  if (plan) await store.put('mealplan', { ...plan, cookedAt: Date.now() });
  return async () => {
    if (before.length) await store.putMany('pantry', before);
    if (plan) await store.put('mealplan', plan);
  };
}

export async function clearCookedPlan() {
  const done = store.list('mealplan').filter((e) => e.cookedAt);
  if (done.length) await store.remove('mealplan', done.map((e) => e.id));
}
