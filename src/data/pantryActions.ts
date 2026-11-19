// Pantry, shopping list and gas prices: saving and syncing.
import { store } from './store';
import { getSettings, saveSettings } from './actions';
import { http } from '../platform';
import { today } from '../core/dates';
import { round2, uid } from '../core/money';
import { matches, restockFromReceipt, type ListLine } from '../core/pantry';
import { geocodeAddress, googleStations, stationsNear, type Point, type Station } from '../core/gas';
import type { GasPrice, PantryItem, Receipt, ShopItem } from '../core/types';

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
export async function afterReceipt(r: Receipt, at: Point | null = null): Promise<{ restocked: number }> {
  const pantry = store.list('pantry');
  const changed = restockFromReceipt(pantry, r);
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
}

/** Stations around a point: Google (with live prices) when you've added a key, else OpenStreetMap. Cached a few hours. */
export async function loadStations(where: 'home' | 'here', point: Point, force = false): Promise<StationCache> {
  const key = `gasStations:${where}`;
  const cached = await store.getMeta<StationCache>(key);
  const moved = cached ? Math.abs(cached.where.lat - point.lat) + Math.abs(cached.where.lon - point.lon) > 0.01 : true;
  const g = getSettings().integrations.googlePlacesKey.trim();
  const maxAge = g ? 3 * 3600_000 : 7 * 24 * 3600_000;
  if (cached && !force && !moved && Date.now() - cached.at < maxAge) return cached;
  let stations: Station[];
  let source: StationCache['source'] = 'osm';
  if (g) {
    try {
      stations = await googleStations(http, g, point);
      source = 'google';
    } catch (e) {
      stations = await stationsNear(http, point).catch(() => {
        throw e;
      });
    }
  } else stations = await stationsNear(http, point);
  const val: StationCache = { at: Date.now(), where: point, stations: stations.slice(0, 25), source };
  await store.setMeta(key, val);
  return val;
}

export async function logGasPrice(st: Station, perGallon: number, grade = 'Regular'): Promise<void> {
  const rec: GasPrice = { id: uid('gp_'), station: st.brand ?? st.name, stationId: st.id, lat: st.lat, lon: st.lon, perGallon, grade, date: today(), source: 'manual' };
  await store.put('gasprices', rec);
}
