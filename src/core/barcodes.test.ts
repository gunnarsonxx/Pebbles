import { describe, expect, it } from 'vitest';
import { barcodeId, codeVariants, lookupLocal, lookupOnline, parseOpenFoodFacts, parseUpcItemDb, sameProduct, upcEtoA } from './barcodes';
import type { Receipt } from './types';

const receipt = (upc: string, name: string, price: number, qty = 1): Receipt => ({
  id: 'r',
  store: 'King Soopers',
  date: '2026-11-19',
  items: [{ raw: name, name, key: name.toLowerCase(), price, qty, dept: 'dairy', upc }],
  subtotal: null,
  tax: null,
  total: null,
  savings: null,
  source: 'photo',
  createdAt: 0,
});

describe('barcodes', () => {
  it('matches the code on the package to the UPC on a King Soopers receipt', () => {
    // the package says 0 11110 50240 7; the receipt lists UPC 0001111050240 (padded, no check digit)
    expect(sameProduct('011110502407', '0001111050240')).toBe(true);
    expect(sameProduct('0011110502407', '0001111050240')).toBe(true); // EAN-13 form
    expect(sameProduct('051500255162', '0001111050240')).toBe(false);
    expect(barcodeId('011110502407')).toBe('11110502407');
    expect(codeVariants('011110502407').has('1111050240')).toBe(true);
  });
  it('writes short UPC-E codes out in full', () => {
    expect(upcEtoA('01234565')).toBe('012345000065');
    expect(upcEtoA('04252614')).toBe('042100005264');
  });
  it('knows it from your receipts, or from a name you gave it', () => {
    const r = [receipt('0001111050240', 'Milk', 7.18, 2)];
    expect(lookupLocal('011110502407', [], r)).toMatchObject({ name: 'Milk', source: 'receipt', price: 3.59 });
    const saved = [{ id: '11110502407', name: 'Whole Milk', dept: 'dairy' as const, pack: null, product: null, at: 0 }];
    expect(lookupLocal('011110502407', saved, r)).toMatchObject({ name: 'Whole Milk', source: 'yours' });
    expect(lookupLocal('012345678905', [], r)).toBeNull();
  });
  it('reads the product databases', () => {
    const off = JSON.stringify({ status: 1, product: { brands: 'Jif', product_name: 'Creamy Peanut Butter', quantity: '16 oz' } });
    expect(parseOpenFoodFacts('051500255162', off)).toMatchObject({ name: 'Peanut Butter', product: 'Jif Creamy Peanut Butter', source: 'openfoodfacts' });
    expect(parseOpenFoodFacts('1', JSON.stringify({ status: 0 }))).toBeNull();
    const upc = JSON.stringify({ items: [{ title: 'Kroger Grade A Large Eggs 18 ct', size: '18 ct' }] });
    expect(parseUpcItemDb('1', upc)).toMatchObject({ name: 'Eggs', pack: 18 });
  });
  it('falls back to the second database, and never throws when offline or slow', async () => {
    const calls: string[] = [];
    const http = async (url: string) => {
      calls.push(url);
      if (url.includes('openfoodfacts')) return { status: 404, text: '' };
      return { status: 200, text: JSON.stringify({ items: [{ title: 'Folgers Classic Roast Ground Coffee' }] }) };
    };
    const r = await lookupOnline(http, '025500201156');
    expect(r.info?.name).toBe('Coffee');
    expect(calls[0]).toContain('/product/0025500201156.json'); // 13-digit form for Open Food Facts
    const offline = await lookupOnline(async () => Promise.reject(new Error('network down')), '012345678905');
    expect(offline).toEqual({ info: null, offline: true });
    const slow = await lookupOnline(() => new Promise(() => {}), '012345678905', [], 20);
    expect(slow).toEqual({ info: null, offline: true });
    const busy = await lookupOnline(async () => ({ status: 429, text: '' }), '012345678905');
    expect(busy).toEqual({ info: null, offline: true });
    const notFound = await lookupOnline(async () => ({ status: 404, text: '' }), '012345678905');
    expect(notFound).toEqual({ info: null, offline: false });
  });
});
