// What's at home, what's running low, and what the next trip will cost.
//
// Three ways to track an item, so nothing needs weighing:
//   count  – eggs: 12, cans of soup: 4        (tap − when you use one)
//   amount – rice: 5 lb, coffee: 12 oz        (tap − to take off a bit)
//   level  – milk, peanut butter, dish soap   (Full → Half → Low → Out)
// Receipts restock what they match; low and out items go on the shopping list by themselves.
import { baseName, cleanItemName, deptFor, NON_GROCERY_DEPTS, sameProduct, type GroceryStats } from './groceries';
import { diffDays } from './dates';
import { round2, uid } from './money';
import type { ISODate, ItemRule, PantryItem, Receipt, ShopItem, Staple, StorePrice } from './types';

export type Level = PantryItem['level'];
export const LEVELS: Level[] = ['full', 'half', 'low', 'out'];
export const LEVEL_LABEL: Record<Level, string> = { full: 'Full', half: 'Half', low: 'Low', out: 'Out' };

const AMOUNT_UNITS: Record<string, string> = {
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  g: 'g',
  kg: 'kg',
  gal: 'gal',
  gallon: 'gal',
  gallons: 'gal',
  qt: 'qt',
  l: 'L',
  liter: 'L',
  ml: 'ml',
  cup: 'cup',
  cups: 'cup',
};
const COUNT_UNITS: Record<string, string> = {
  ct: 'ct',
  count: 'ct',
  x: 'ct',
  pk: 'pack',
  pack: 'pack',
  packs: 'pack',
  can: 'can',
  cans: 'can',
  bag: 'bag',
  bags: 'bag',
  box: 'box',
  boxes: 'box',
  bottle: 'bottle',
  bottles: 'bottle',
  jar: 'jar',
  jars: 'jar',
  roll: 'roll',
  rolls: 'roll',
  loaf: 'loaf',
  loaves: 'loaf',
  dozen: 'ct',
  doz: 'ct',
  bar: 'bar',
  bars: 'bar',
  pouch: 'pouch',
  pouches: 'pouch',
  each: 'ct',
  ea: 'ct',
};

export function newPantryItem(name: string, patch: Partial<PantryItem> = {}, rules: ItemRule[] = []): PantryItem {
  const c = cleanItemName(name);
  const key = patch.key ?? c.key;
  return {
    id: uid('pan_'),
    name: name
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^./, (x) => x.toUpperCase()),
    key,
    dept: deptFor(c.name, key, rules),
    mode: 'level',
    qty: 0,
    unit: 'ct',
    perBuy: 1,
    lowAt: 0,
    level: 'full',
    lastBought: null,
    ...patch,
  };
}

/**
 * Quick add, one item per line:
 *   eggs 12        → count, 12 on hand
 *   rice 5 lb      → amount, 5 lb
 *   soup 4 cans    → count, 4 cans
 *   milk           → level, full
 *   coffee low     → level, low
 *   2 dozen eggs   → count, 24
 */
export function parseQuickAdd(text: string, rules: ItemRule[] = []): PantryItem[] {
  const out: PantryItem[] = [];
  for (const raw of text.split(/\n|,|;/)) {
    let line = raw.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const lvl = line.match(/\s+(full|half|low|out|empty)$/i);
    if (lvl) {
      const level = (lvl[1].toLowerCase() === 'empty' ? 'out' : lvl[1].toLowerCase()) as Level;
      out.push(newPantryItem(line.slice(0, lvl.index), { level }, rules));
      continue;
    }
    // number (+ unit) at the end or the start
    let m = line.match(/^(.*?)\s*[x×:]?\s*(\d+(?:\.\d+)?)\s*([a-z]+)?\.?$/i);
    let name = m?.[1];
    let n = m ? parseFloat(m[2]) : NaN;
    let unitWord = m?.[3]?.toLowerCase();
    if (!m || !name) {
      m = line.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?\s+(?:of\s+)?(.+)$/i);
      if (m) {
        n = parseFloat(m[1]);
        unitWord = m[2]?.toLowerCase();
        name = m[3];
        if (unitWord && !AMOUNT_UNITS[unitWord] && !COUNT_UNITS[unitWord]) {
          name = `${m[2]} ${m[3]}`;
          unitWord = undefined;
        }
      }
    }
    if (!name || Number.isNaN(n)) {
      out.push(newPantryItem(line, {}, rules));
      continue;
    }
    line = name;
    if (unitWord === 'dozen' || unitWord === 'doz') n *= 12;
    if (unitWord && AMOUNT_UNITS[unitWord]) {
      const unit = AMOUNT_UNITS[unitWord];
      out.push(newPantryItem(line, { mode: 'amount', qty: n, unit, perBuy: n, lowAt: round2(n * 0.25) }, rules));
    } else {
      const unit = unitWord && COUNT_UNITS[unitWord] ? COUNT_UNITS[unitWord] : 'ct';
      const known = unitWord && !COUNT_UNITS[unitWord] ? `${line} ${unitWord}` : line;
      out.push(newPantryItem(known, { mode: 'count', qty: n, unit, perBuy: Math.max(1, n), lowAt: n >= 4 ? Math.floor(n * 0.25) : n > 1 ? 1 : 0 }, rules));
    }
  }
  return out;
}

export type Stock = 'ok' | 'low' | 'out';

export function stockOf(p: PantryItem): Stock {
  if (p.mode === 'level') return p.level === 'out' ? 'out' : p.level === 'low' ? 'low' : 'ok';
  if (p.qty <= 0) return 'out';
  return p.qty <= p.lowAt ? 'low' : 'ok';
}

export function nextLevel(l: Level, dir: 1 | -1 = 1): Level {
  const i = LEVELS.indexOf(l);
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i + dir))];
}

/** "Probably running low": you usually rebuy this every N days and it's been about that long. */
export function dueSoon(p: PantryItem, receipts: Receipt[], asOf: ISODate): number | null {
  const dates = [...new Set(receipts.filter((r) => r.items.some((i) => matches(p, i.key, i.name))).map((r) => r.date))].sort();
  if (dates.length < 2) return null;
  const gaps = dates
    .slice(1)
    .map((d, i) => diffDays(d, dates[i]))
    .filter((g) => g > 0);
  if (!gaps.length) return null;
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const since = diffDays(asOf, dates[dates.length - 1]);
  return since >= avg * 0.85 ? Math.round(avg) : null;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !['the', 'and', 'with', 'large', 'small', 'organic', 'whole', 'fresh'].includes(w));
}

/** Does a receipt line belong to this pantry item? Same key, or the pantry name's words all appear. */
export function matches(p: PantryItem, key: string, name: string): boolean {
  if (!key && !name) return false;
  if (p.key && key && p.key === key) return true;
  // both plain names Pebbles knows (Coffee, Coffee Creamer, Milk, Chocolate Milk): only the same one matches
  const bp = baseName(p.name);
  const bi = baseName(name);
  if (bp && bi) return bp === bi;
  // one key inside the other only for a plural or small spelling difference (egg / eggs), not coffee / coffeecreamer
  if (p.key && key) {
    const [a, b] = p.key.length <= key.length ? [p.key, key] : [key, p.key];
    if (a.length >= 4 && b.startsWith(a) && b.length - a.length <= 2) return true;
  }
  const pw = words(p.name).map((w) => w.replace(/s$/, ''));
  const nw = new Set(words(name).map((w) => w.replace(/s$/, '')));
  // every word of the pantry name is in the receipt line, and the line isn't a different plain-named thing
  return pw.length > 0 && pw.every((w) => nw.has(w)) && (!bi || bi.toLowerCase() === p.name.toLowerCase());
}

/** What a receipt does to your pantry: restock what it matches. */
export function restockFromReceipt(pantry: PantryItem[], receipt: Receipt): PantryItem[] {
  const changed: PantryItem[] = [];
  for (const p of pantry) {
    if (p.archived) continue;
    const hits = receipt.items.filter((i) => i.price > 0 && !NON_GROCERY_DEPTS.includes(i.dept) && matches(p, i.key, i.name));
    if (!hits.length) continue;
    if (p.lastBought && p.lastBought >= receipt.date) continue; // already counted
    const bought = hits.reduce((s, i) => s + Math.max(1, i.qty || 1), 0);
    const next: PantryItem = { ...p, lastBought: receipt.date };
    if (p.mode === 'level') next.level = 'full';
    else next.qty = round2(Math.max(0, p.qty) + p.perBuy * bought);
    changed.push(next);
  }
  return changed;
}

export interface ListLine {
  id: string; // pantry id or shop item id
  name: string;
  key: string;
  why: 'out' | 'low' | 'due' | 'added';
  qty: number;
  pantry: PantryItem | null;
  shop: ShopItem | null;
  price: number | null; // best known price for one
  priceFrom: string | null;
  staple?: { staple: Staple; options: string[] } | null; // any of these will do
  always?: boolean; // one of your staples
}

/** Your shopping list: out and low pantry items, ones you usually rebuy by now, and anything you added. */
export function buildList(
  pantry: PantryItem[],
  shop: ShopItem[],
  receipts: Receipt[],
  asOf: ISODate,
  priceOf: (key: string, name: string, desc?: string) => { price: number; from: string } | null,
  staples: Staple[] = [],
): ListLine[] {
  const out: ListLine[] = [];
  const onList = new Set(shop.filter((s) => !s.done && s.pantryId).map((s) => s.pantryId));
  // staples: one line for the kind of food ("Air Fryer Frozen Food"), not each product in it
  const inStaple = new Set<string>();
  for (const st of staples) {
    const items = pantry.filter((p) => !p.archived && p.stapleId === st.id);
    items.forEach((p) => inStaple.add(p.id));
    const ok = items.some((p) => stockOf(p) === 'ok');
    const low = items.some((p) => stockOf(p) === 'low');
    if (ok || shop.some((x) => !x.done && x.key === `staple:${st.id}`)) continue;
    const options = [...new Set([...st.examples, ...items.map((p) => p.name)])];
    const prices = options.map((n) => priceOf('', n)?.price).filter((x): x is number => x != null);
    out.push({
      id: `staple:${st.id}`,
      name: st.name,
      key: `staple:${st.id}`,
      why: low ? 'low' : 'out',
      qty: 1,
      pantry: null,
      shop: null,
      price: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
      priceFrom: prices.length ? 'about what you usually pay' : null,
      staple: { staple: st, options },
    });
  }
  for (const p of pantry) {
    if (p.archived || onList.has(p.id) || inStaple.has(p.id)) continue;
    const st = stockOf(p);
    const due = st === 'ok' ? dueSoon(p, receipts, asOf) : null;
    if (st === 'ok' && due == null) continue;
    const pr = priceOf(p.key, p.name, p.desc);
    out.push({ id: p.id, name: p.name, key: p.key, why: st === 'ok' ? 'due' : st, qty: 1, pantry: p, shop: null, price: pr?.price ?? null, priceFrom: pr?.from ?? null, always: !!p.always });
  }
  for (const s of shop) {
    if (s.done) continue;
    const p = s.pantryId ? (pantry.find((x) => x.id === s.pantryId) ?? null) : null;
    const pr = priceOf(s.key, s.name);
    out.push({ id: s.id, name: s.name, key: s.key, why: 'added', qty: s.qty, pantry: p, shop: s, price: pr?.price ?? null, priceFrom: pr?.from ?? null });
  }
  const order = { out: 0, low: 1, added: 2, due: 3 };
  // staples first within out / low
  return out.sort((a, b) => order[a.why] - order[b.why] || Number(!!b.always) - Number(!!a.always) || a.name.localeCompare(b.name));
}

/** Best price for one of an item: a King Soopers sale or shelf price, else what you last paid. */
/**
 * Best price for one: a King Soopers price for the same product (same words, about the same size), else what
 * you last paid. A store product that isn't yours (a different coffee, a smaller bag) is never used.
 */
export function makePriceOf(stats: GroceryStats | null, prices: StorePrice[]): (key: string, name: string, desc?: string) => { price: number; from: string } | null {
  return (key, name, desc) => {
    const st = (key ? stats?.items.find((i) => i.key === key) : undefined) ?? stats?.items.find((i) => matches({ key, name } as PantryItem, i.key, i.name));
    const mine = desc || st?.desc;
    let best: { price: number; from: string } | null = null;
    for (const p of prices) {
      if (!key || !(p.id === key || p.id.endsWith(`|${key}`))) continue;
      if (mine && !sameProduct(mine, p)) continue;
      const v = p.promo ?? p.regular;
      const sale = p.promo != null && p.regular != null && p.promo < p.regular;
      if (v != null && (!best || v < best.price)) best = { price: v, from: `${p.store}${sale ? ' (sale)' : ''}: ${p.description}${p.size ? `, ${p.size}` : ''}` };
    }
    if (best) return best;
    return st ? { price: st.lastPrice, from: `last paid at ${st.lastStore}` } : null;
  };
}

export interface TripEstimate {
  items: number;
  priced: number;
  subtotal: number;
  tax: number;
  total: number;
  unpricedGuess: number; // an average-item guess for things with no price yet
}

export function estimateTrip(lines: ListLine[], taxRate: number, avgItem = 4.5): TripEstimate {
  const priced = lines.filter((l) => l.price != null);
  const known = priced.reduce((s, l) => s + (l.price as number) * Math.max(1, l.qty), 0);
  const unpriced = lines.length - priced.length;
  const guess = unpriced * avgItem;
  const subtotal = round2(known + guess);
  const tax = round2(subtotal * taxRate);
  return { items: lines.length, priced: priced.length, subtotal, tax, total: round2(subtotal + tax), unpricedGuess: round2(guess) };
}
