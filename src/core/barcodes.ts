// Barcodes on things in your kitchen → what they are.
// First your own receipts (King Soopers app receipts list each item's UPC) and barcodes you've named
// before, then two free product databases: Open Food Facts and UPCitemdb (no account needed).
import { cleanItemName, deptFor, packOf } from './groceries';
import type { HttpFn } from './market';
import type { GroceryDept, ItemRule, Receipt } from './types';

export interface BarcodeInfo {
  code: string;
  name: string; // plain name for the pantry ("Milk")
  product: string | null; // what the label says ("Kroger Vitamin D Whole Milk")
  dept: GroceryDept;
  pack: number | null;
  price: number | null; // what you last paid, when it's on a receipt
  source: 'yours' | 'receipt' | 'openfoodfacts' | 'upcitemdb';
}

/** A barcode you've named (synced, so the phone and desktop both know it). */
export interface SavedBarcode {
  id: string; // the code, no leading zeros
  name: string;
  dept: GroceryDept;
  pack: number | null;
  product: string | null;
  at: number;
}

const digits = (s: string) => s.replace(/\D/g, '');
const unpad = (s: string) => s.replace(/^0+/, '');

/** UPC-E (the short code on small packs) written out as the full UPC-A. */
export function upcEtoA(e: string): string | null {
  const d = digits(e);
  if (d.length !== 8) return null;
  const [ns, x1, x2, x3, x4, x5, x6, check] = d.split('');
  if (ns !== '0' && ns !== '1') return null;
  let body: string;
  if ('012'.includes(x6)) body = `${x1}${x2}${x6}0000${x3}${x4}${x5}`;
  else if (x6 === '3') body = `${x1}${x2}${x3}00000${x4}${x5}`;
  else if (x6 === '4') body = `${x1}${x2}${x3}${x4}00000${x5}`;
  else body = `${x1}${x2}${x3}${x4}${x5}0000${x6}`;
  return `${ns}${body}${check}`;
}

/** Every way the same product's code gets written: with or without leading zeros, check digit, EAN-13 vs UPC-A. */
export function codeVariants(code: string): Set<string> {
  let d = digits(code);
  const expanded = d.length === 8 ? upcEtoA(d) : null;
  if (expanded) d = expanded;
  const out = new Set<string>();
  const add = (s: string) => s && out.add(unpad(s));
  add(d);
  add(d.slice(0, -1)); // without the check digit (Kroger's own UPCs leave it off)
  return out;
}

export function sameProduct(a: string, b: string): boolean {
  const va = codeVariants(a);
  for (const v of codeVariants(b)) if (v.length >= 6 && va.has(v)) return true;
  return false;
}

/** The key barcodes are saved under. */
export const barcodeId = (code: string) => unpad(digits(upcEtoA(code) ?? code));

/** Already known: a barcode you named, or one on your receipts. */
export function lookupLocal(code: string, saved: SavedBarcode[], receipts: Receipt[]): BarcodeInfo | null {
  const mine = saved.find((s) => sameProduct(s.id, code));
  if (mine) return { code, name: mine.name, product: mine.product, dept: mine.dept, pack: mine.pack, price: null, source: 'yours' };
  for (const r of [...receipts].sort((a, b) => b.date.localeCompare(a.date))) {
    const it = r.items.find((i) => i.upc && sameProduct(i.upc, code));
    if (it)
      return {
        code,
        name: it.name,
        product: it.raw || null,
        dept: it.dept,
        pack: it.pack ?? null,
        price: it.price > 0 ? Math.round((it.price / Math.max(1, it.qty || 1)) * 100) / 100 : null,
        source: 'receipt',
      };
  }
  return null;
}

// The databases ask apps to say who they are.
const HEADERS = { 'User-Agent': 'PebblesBudget/1.0 (personal budgeting app)', Accept: 'application/json' };

function fromProduct(code: string, title: string, quantity: string | null, rules: ItemRule[], source: BarcodeInfo['source']): BarcodeInfo {
  const c = cleanItemName(title);
  return { code, name: c.name, product: title, dept: deptFor(title, c.key, rules), pack: packOf(`${title} ${quantity ?? ''}`), price: null, source };
}

export function parseOpenFoodFacts(code: string, text: string, rules: ItemRule[] = []): BarcodeInfo | null {
  const j = JSON.parse(text);
  if (j?.status !== 1 || !j.product) return null;
  const p = j.product;
  const name = [p.brands?.split(',')[0]?.trim(), p.product_name_en || p.product_name || p.generic_name_en || p.generic_name].filter(Boolean).join(' ').trim();
  if (!name) return null;
  return fromProduct(code, name, p.quantity ?? null, rules, 'openfoodfacts');
}

export function parseUpcItemDb(code: string, text: string, rules: ItemRule[] = []): BarcodeInfo | null {
  const it = JSON.parse(text)?.items?.[0];
  if (!it?.title) return null;
  return fromProduct(code, it.title, it.size ?? null, rules, 'upcitemdb');
}

/** Look a barcode up online. Never throws: no answer, no connection or a slow server all come back as null. */
export async function lookupOnline(http: HttpFn, code: string, rules: ItemRule[] = [], timeoutMs = 9000): Promise<{ info: BarcodeInfo | null; offline: boolean }> {
  const d = digits(upcEtoA(code) ?? code);
  // Open Food Facts files US products under their 13-digit code
  const ean = d.length === 12 ? `0${d}` : d;
  const within = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
  let reached = false;
  try {
    const res = await within(http(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_en,generic_name,generic_name_en,brands,quantity`, { headers: HEADERS }));
    // busy (429) or down (5xx) isn't an answer: say "try again later", not "not found"
    if (res.status < 429) reached = true;
    if (res.status === 200) {
      const info = parseOpenFoodFacts(code, res.text, rules);
      if (info) return { info, offline: false };
    }
  } catch {
    /* try the next one */
  }
  try {
    const res = await within(http(`https://api.upcitemdb.com/prod/trial/lookup?upc=${d}`, { headers: HEADERS }));
    if (res.status < 429) reached = true;
    if (res.status === 200) {
      const info = parseUpcItemDb(code, res.text, rules);
      if (info) return { info, offline: false };
    }
  } catch {
    /* none found */
  }
  return { info: null, offline: !reached };
}
