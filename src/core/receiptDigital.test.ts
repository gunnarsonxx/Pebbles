import { describe, expect, it } from 'vitest';
import { mergeReceipts, parseReceipt } from './receipts';
import { applyPicks, defaultPicks } from './kitchen';
import { cleanItemName } from './groceries';

const L = (t: string) => ({ text: t, confidence: 90 });
// an app / online-order receipt, as the phone's reader sees it (OCR quirks included: $6-49, S0.50)
const part1 = [
  'Order Total: $21.45',
  'Item Details 4 Items',
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
    expect(r.warnings.join(' ')).toMatch(/lists 4 items and Pebbles found 3/);
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
