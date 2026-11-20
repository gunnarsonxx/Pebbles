// Staples (kinds of food you always want, whatever the exact product) and adding a receipt's
// items to the pantry only when you say they're still in your kitchen.
import { NON_GROCERY_DEPTS } from './groceries';
import { diffDays } from './dates';
import { round2, uid } from './money';
import { matches, newPantryItem, stockOf } from './pantry';
import type { ISODate, ItemRule, PantryItem, Receipt, ReceiptItem, Staple } from './types';

// ---------------- staples ----------------

export interface StaplePreset {
  name: string;
  keywords: string[];
}

/** Ideas to start from; you can rename them or make your own. */
export const STAPLE_PRESETS: StaplePreset[] = [
  {
    name: 'Air Fryer Frozen Food',
    keywords: ['pizza roll', 'popcorn chicken', 'nugget', 'chicken tender', 'chicken strip', 'tater tot', 'fries', 'egg roll', 'taquito', 'mozzarella stick', 'corn dog', 'hot pocket', 'wings', 'fish stick', 'bagel bite', 'pizza bite', 'jalapeno popper', 'onion ring', 'chimichanga', 'pot sticker', 'potsticker', 'dumpling'],
  },
  { name: 'Frozen Meals', keywords: ['frozen meal', 'frozen dinner', 'bowl', 'lean cuisine', 'banquet', 'marie callender', 'stouffer', 'hungry man', 'frozen pizza', 'digiorno', 'totino', 'red baron', 'burrito'] },
  { name: 'Meat & Protein', keywords: ['chicken breast', 'chicken thigh', 'ground beef', 'ground turkey', 'steak', 'pork chop', 'sausage', 'bacon', 'ham', 'tuna', 'salmon', 'shrimp', 'deli turkey', 'lunch meat'] },
  { name: 'Breakfast', keywords: ['cereal', 'oatmeal', 'oats', 'waffle', 'pancake', 'bagel', 'pop tart', 'granola', 'breakfast sandwich'] },
  { name: 'Bread & Tortillas', keywords: ['bread', 'tortilla', 'bun', 'roll', 'english muffin', 'pita'] },
  { name: 'Rice, Pasta & Noodles', keywords: ['rice', 'pasta', 'spaghetti', 'penne', 'macaroni', 'noodle', 'ramen', 'mac and cheese', 'mac & cheese'] },
  { name: 'Snacks', keywords: ['chips', 'crackers', 'pretzel', 'popcorn', 'granola bar', 'cookies', 'goldfish', 'cheez it', 'trail mix', 'jerky'] },
  { name: 'Drinks', keywords: ['soda', 'coke', 'pepsi', 'sprite', 'juice', 'energy drink', 'monster', 'red bull', 'gatorade', 'sparkling water', 'coffee', 'tea'] },
  { name: 'Fruit', keywords: ['apple', 'banana', 'orange', 'grape', 'strawberr', 'blueberr', 'clementine', 'mango', 'pineapple', 'peach', 'pear'] },
  { name: 'Veggies', keywords: ['broccoli', 'carrot', 'lettuce', 'salad', 'spinach', 'pepper', 'onion', 'potato', 'green bean', 'corn', 'mixed vegetable', 'frozen vegetable', 'cucumber', 'tomato'] },
];

const lc = (s: string) => s.toLowerCase();

/** Which staple an item belongs to: one you picked for it, else the first whose keywords it matches. */
export function stapleFor(name: string, staples: Staple[], picked?: string | null): Staple | null {
  if (picked) return staples.find((s) => s.id === picked) ?? null;
  const n = lc(name);
  return staples.find((s) => s.examples.some((e) => lc(e) === n) || s.keywords.some((k) => k && n.includes(lc(k)))) ?? null;
}

export function newStaple(name: string, keywords: string[] = [], examples: string[] = []): Staple {
  return { id: uid('stp_'), name: name.trim(), keywords: [...new Set(keywords.map(lc).filter(Boolean))], examples: [...new Set(examples)], createdAt: Date.now() };
}

export interface StapleStatus {
  staple: Staple;
  items: PantryItem[]; // pantry items that count toward it
  stock: 'ok' | 'low' | 'out';
}

export function stapleStatus(staples: Staple[], pantry: PantryItem[]): StapleStatus[] {
  return staples.map((st) => {
    const items = pantry.filter((p) => !p.archived && p.stapleId === st.id);
    const ok = items.filter((p) => stockOf(p) === 'ok').length;
    const low = items.filter((p) => stockOf(p) === 'low').length;
    return { staple: st, items, stock: ok ? 'ok' : low ? 'low' : 'out' };
  });
}

// ---------------- receipt → pantry, only what you say you still have ----------------

/** How much of something is left. 'gone' = used up or not tracked. */
export type LeftAmount = 'gone' | 'low' | 'half' | 'full';

export interface KitchenPick {
  item: ReceiptItem;
  left: LeftAmount;
  stapleId: string | null;
}

/** One line per product (the same thing bought twice is one pick), groceries only. */
export function pickableItems(r: Pick<Receipt, 'items'>): ReceiptItem[] {
  const seen = new Map<string, ReceiptItem>();
  for (const i of r.items) {
    if (i.price <= 0 || NON_GROCERY_DEPTS.includes(i.dept) || !i.name.trim()) continue;
    const k = i.key || lc(i.name);
    const cur = seen.get(k);
    seen.set(k, cur ? { ...cur, qty: (cur.qty || 1) + (i.qty || 1) } : i);
  }
  return [...seen.values()];
}

/** A receipt from the last few days is probably all still there; an older one, you pick. */
export const isRecent = (date: ISODate, today: ISODate) => diffDays(today, date) <= 3;

export function defaultPicks(r: Pick<Receipt, 'items' | 'date'>, today: ISODate, pantry: PantryItem[], staples: Staple[]): KitchenPick[] {
  const recent = isRecent(r.date, today);
  return pickableItems(r).map((item) => {
    const p = pantry.find((x) => !x.archived && matches(x, item.key, item.name));
    return { item, left: recent ? 'full' : 'gone', stapleId: p?.stapleId ?? stapleFor(item.name, staples)?.id ?? null };
  });
}

const FRACTION: Record<Exclude<LeftAmount, 'gone'>, number> = { full: 1, half: 0.5, low: 0.2 };

/** What to save: pantry items to update or create, and staples that gained an example. */
export function applyPicks(picks: KitchenPick[], pantry: PantryItem[], staples: Staple[], receiptDate: ISODate, rules: ItemRule[] = []): { pantry: PantryItem[]; staples: Staple[] } {
  const outPantry: PantryItem[] = [];
  const outStaples = new Map<string, Staple>();
  for (const pk of picks) {
    if (pk.left === 'gone') continue;
    const existing = pantry.find((x) => !x.archived && matches(x, pk.item.key, pk.item.name));
    const base = existing ?? newPantryItem(pk.item.name, { key: pk.item.key, dept: pk.item.dept }, rules);
    const next: PantryItem = { ...base, lastBought: !base.lastBought || base.lastBought < receiptDate ? receiptDate : base.lastBought };
    if (next.mode === 'level') next.level = pk.left;
    else next.qty = round2(Math.max(next.perBuy, 1) * FRACTION[pk.left]);
    if (pk.stapleId) {
      next.stapleId = pk.stapleId;
      const st = outStaples.get(pk.stapleId) ?? staples.find((s) => s.id === pk.stapleId);
      if (st && !st.examples.some((e) => lc(e) === lc(base.name))) outStaples.set(st.id, { ...st, examples: [...st.examples, base.name] });
    }
    outPantry.push(next);
  }
  return { pantry: outPantry, staples: [...outStaples.values()] };
}

/** Pantry items a new staple should claim: ones whose names match it and aren't in another staple. */
export function claimForStaple(st: Staple, pantry: PantryItem[]): PantryItem[] {
  return pantry.filter((p) => !p.archived && !p.stapleId && stapleFor(p.name, [st])?.id === st.id).map((p) => ({ ...p, stapleId: st.id }));
}
