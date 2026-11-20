import { describe, expect, it } from 'vitest';
import { mergeReceipts, parseReceipt } from './receipts';
import { applyPicks, defaultPicks } from './kitchen';
import { cleanItemName } from './groceries';

const L = (t: string) => ({ text: t, confidence: 90 });
// an app / online-order receipt, as the phone's reader sees it (OCR quirks included: $6-49, S0.50)
const part1 = [
  'Order Total: $21.45',
  'Item Details 7 Items', // units: 3 cans count as 3
  'Cream of Wheat Original 2 1/2- Minute, $5.99',
  '28 oz',
  '1 x $5.99 $6-49 ea.',
  'Item Coupon/Sale: -S0.50',
  'UPC: 0001313000612',
  'King Soopers® City Market® Vitamin D $3.69',
  'Whole Milk Gallon, 1 gal',
  '1 x $3.69 ea.',
  'UPC: 0001111050240',
  'Monster Bad Apple Energy Drink Can, 16 $7.18',
  'fl oz',
  '3 x $2.39 $3-59 ea. (approx.)',
  'Item Coupon/Sale: -S$3.59',
  'UPC: 0007084789956',
].map(L);
const part2 = [
  'Monster Bad Apple Energy Drink Can, 16 $7.18', // overlaps the first screenshot
  'fl oz',
  '3 x $2.39 $3-59 ea. (approx.)',
  'UPC: 0007084789956',
  'Kroger Grade A Large Eggs, 12 ct $3.99',
  '2 x $1.99 ea.',
  'UPC: 0001111060933',
  'Ordered Nov 18, 2026',
].map(L);

describe('app receipts', () => {
  it('reads names, quantities, shelf prices and deals without taking coupons off twice', () => {
    const r = parseReceipt(part1, [], '2026-11-20');
    expect(r.items.map((i) => [i.name, i.price, i.qty, i.regular ?? null, i.deal?.saved ?? null])).toEqual([
      ['Cream of Wheat', 5.99, 1, 6.49, 0.5],
      ['Milk', 3.69, 1, null, null],
      ['Monster Energy', 7.18, 3, 3.59, 3.59],
    ]);
    expect(r.total).toBe(21.45);
    expect(r.savings).toBe(4.09);
    expect(r.warnings.join(' ')).toMatch(/lists 7 items and Pebbles found 5/);
  });
  it('a second screenshot adds the rest, skips repeats, finds the date and works out the tax', () => {
    const r = mergeReceipts(parseReceipt(part1, [], '2026-11-20'), parseReceipt(part2, [], '2026-11-20'));
    expect(r.items.map((i) => i.name)).toEqual(['Cream of Wheat', 'Milk', 'Monster Energy', 'Eggs']);
    expect(r.items[3]).toMatchObject({ qty: 2, pack: 12 });
    expect(r.date).toBe('2026-11-18');
    expect(r.subtotal).toBe(20.85);
    expect(r.tax).toBe(0.6);
    expect(r.warnings).toEqual([]);
  });
  it('two cartons of a dozen eggs go in the pantry as 24', () => {
    const r = mergeReceipts(parseReceipt(part1, [], '2026-11-20'), parseReceipt(part2, [], '2026-11-20'));
    const picks = defaultPicks({ items: r.items, date: '2026-11-19' }, '2026-11-20', [], []);
    const eggs = picks.find((p) => p.item.name === 'Eggs')!;
    expect(eggs.count).toBe(24);
    expect(picks.find((p) => p.item.name === 'Monster Energy')!.count).toBe(3);
    expect(picks.find((p) => p.item.name === 'Milk')!.count).toBeNull(); // one jug: Full / Half / Low
    const saved = applyPicks(picks, [], [], '2026-11-19').pantry.find((p) => p.name === 'Eggs')!;
    expect(saved).toMatchObject({ mode: 'count', qty: 24, perBuy: 12, lowAt: 3 });
  });
  it('names that contain another food’s word', () => {
    expect(cleanItemName('Cream of Wheat Original 2 1/2- Minute').name).toBe('Cream of Wheat');
    expect(cleanItemName('Monster Bad Apple Energy Drink Can').name).toBe('Monster Energy');
    expect(cleanItemName('Apple Juice').name).not.toBe('Apples');
    expect(cleanItemName('Honeycrisp Apples 3 lb').name).toBe('Apples');
    expect(cleanItemName('Banana Bread').name).toBe('Bread');
    expect(cleanItemName('Thomas Cinnamon Raisin English Muffin, 6 ct').name).toBe('English Muffins');
  });
});

// an online-order invoice (PDF): summary block, quantity lines without "ea.", coupons per unit, fees and tip
const invoice = [
  'King Soopers   INVOICE',
  'Order Date: October 27, 2026',
  'SAVINGS',
  'Savings   -$7.40',
  'ORDER SUMMARY',
  'Subtotal   $26.36',
  'Item Coupons & Sales   -$6.40',
  'Coupons   -$1.00',
  'Fee   +$14.95',
  'Tip   +$5.25',
  'Tax   $0.60',
  'Total   $39.76',
  'ITEMS PURCHASED (8)',
  'Barilla Cellentani Pasta, 16 oz   $4.95',
  '5 × $0.99',
  'Item Coupon/Sale: -$0.40',
  'Item Coupon/Sale: -$0.60',
  'Item Coupon/Sale: -$0.40',
  'Item Coupon/Sale: -$0.60',
  'Item Coupon/Sale: -$0.40',
  'Item Coupon/Sale: -$0.60',
  'Item Coupon/Sale: -$0.40',
  'Item Coupon/Sale: -$0.60',
  'Item Coupon/Sale: -$0.40',
  'Item Coupon/Sale: -$0.60',
  'El Monterey® Chicken & Cheese Frozen Flour Taquitos, 20 ct / 20 oz   $7.49',
  '1 × $7.49',
  'Item Coupon/Sale: -$1.40',
  'Kroger® Cage Free Grade AA Large White Eggs, 18 ct   $2.65',
  '1 × $2.65',
  'P3 Portable Protein Snack Pack with Dark Chocolate Almond Nut, Turkey & Cheddar Cheese, Tray,   $4.87',
  '2 oz',
  '1 × $4.87',
  'PAYMENT DETAILS',
  'Visa 1234   $39.76',
].map(L);

describe('online order invoices (PDF)', () => {
  it('reads items, coupons, fees and tip, and checks out', () => {
    const r = parseReceipt(invoice, [], '2026-11-20');
    expect(r.date).toBe('2026-10-27');
    expect(r.items.map((i) => [i.name, i.price, i.qty, i.pack ?? null, i.deal?.saved ?? null, i.dept])).toEqual([
      ['Pasta', 4.95, 5, null, 5, 'pantry'],
      ['Taquitos', 7.49, 1, 20, 1.4, 'frozen'],
      ['Eggs', 2.65, 1, 18, null, 'dairy'],
      ['Protein Snack Packs', 4.87, 1, null, null, 'snacks'],
    ]);
    // the summary's subtotal is before item coupons; the items are after them
    expect(r.subtotal).toBe(19.96);
    expect(r.itemsTotal).toBe(19.96);
    expect(r).toMatchObject({ tax: 0.6, total: 39.76, fees: 20.2, discount: 1, savings: 7.4 });
    expect(r.warnings).toEqual([]);
  });
});

describe('telling similar things apart', async () => {
  const { pickableItems } = await import('./kitchen');
  const { fullName, describeItem } = await import('./groceries');
  it('a coffee drink and ground coffee get different names, and stay two lines', () => {
    expect(cleanItemName('Starbucks Frappuccino Mocha Chilled Coffee Drink 4 ct').name).toBe('Coffee Drink');
    expect(cleanItemName('Kroger Classic Blend Medium Roast Ground Coffee, 29 oz').name).toBe('Coffee');
    expect(cleanItemName('Folgers Classic Roast K-Cup Pods 24 ct').name).toBe('Coffee Pods');
    const items = [
      { raw: 'Starbucks Frappuccino Mocha Chilled Coffee Drink', desc: 'Starbucks Frappuccino Mocha Chilled Coffee Drink', name: 'Coffee', key: 'coffee', price: 7.49, qty: 1, dept: 'drinks' as const },
      { raw: 'Kroger Classic Blend Medium Roast Ground Coffee', desc: 'Kroger Classic Blend Medium Roast Ground Coffee', name: 'Coffee', key: 'coffee', price: 12.99, qty: 1, dept: 'drinks' as const },
      { raw: 'Kroger Classic Blend Medium Roast Ground Coffee', desc: 'Kroger Classic Blend Medium Roast Ground Coffee', name: 'Coffee', key: 'coffee', price: 12.99, qty: 1, dept: 'drinks' as const },
    ];
    // even with the same short name, different products aren't merged; the same one bought twice is
    expect(pickableItems({ items }).map((i) => [i.desc, i.qty])).toEqual([
      ['Starbucks Frappuccino Mocha Chilled Coffee Drink', 1],
      ['Kroger Classic Blend Medium Roast Ground Coffee', 2],
    ]);
  });
  it('keeps the store’s full name for the description', () => {
    expect(fullName('Kroger® Classic Blend Medium Roast Ground Coffee, 29 oz')).toBe('Kroger Classic Blend Medium Roast Ground Coffee, 29 oz');
    expect(fullName('KS WHT BRD 0001111008502 2.49 F')).toBe('KS WHT BRD');
    expect(describeItem({ raw: 'GV 2% MLK', name: 'Milk' })).toBe('GV 2% MLK');
    const r = parseReceipt(invoice, [], '2026-11-20');
    expect(r.items[1].desc).toBe('El Monterey Chicken & Cheese Frozen Flour Taquitos, 20 ct / 20 oz');
  });
});

describe('store prices only for the same product', async () => {
  const { sameProduct, searchTerm, sizeOf } = await import('./groceries');
  const { makePriceOf } = await import('./pantry');
  const mine = 'Kroger Classic Blend Medium Roast Ground Coffee, 29 oz';
  it('a different coffee, or a smaller bag, isn’t yours', () => {
    expect(sameProduct(mine, { description: 'Kroger 100% Colombian Medium Roast Ground Coffee', size: '11.5 oz' })).toBe(false);
    expect(sameProduct(mine, { description: 'Kroger Classic Blend Medium Roast Ground Coffee', size: '11.5 oz' })).toBe(false); // smaller bag
    expect(sameProduct(mine, { description: 'Kroger® Classic Blend Medium Roast Ground Coffee', size: '29 oz' })).toBe(true);
    expect(sizeOf('2 lb')).toEqual({ n: 32, unit: 'oz' });
    expect(searchTerm(mine)).toBe('Kroger Classic Blend Medium Roast Ground Coffee');
  });
  it('the list uses what you paid unless King Soopers has the same product', () => {
    const stats = { items: [{ key: 'coffee', name: 'Coffee', desc: mine, lastPrice: 12.99, lastStore: 'King Soopers' }] } as never;
    const wrong = [{ id: 'ks1|coffee', store: 'King Soopers (Powers Blvd)', description: 'Kroger 100% Colombian Ground Coffee', regular: 5.99, promo: null, size: '11.5 oz', fetchedAt: 0 }];
    expect(makePriceOf(stats, wrong)('coffee', 'Coffee', mine)).toEqual({ price: 12.99, from: 'last paid at King Soopers' });
    const right = [{ ...wrong[0], description: 'Kroger Classic Blend Medium Roast Ground Coffee', size: '29 oz', regular: 13.49, promo: 11.99 }];
    expect(makePriceOf(stats, right)('coffee', 'Coffee', mine)).toEqual({ price: 11.99, from: 'King Soopers (Powers Blvd) (sale): Kroger Classic Blend Medium Roast Ground Coffee, 29 oz' });
  });
});
