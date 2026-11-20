import { describe, expect, it } from 'vitest';
import { buildList, estimateTrip, matches, nextLevel, parseQuickAdd, restockFromReceipt, stockOf } from './pantry';
import { findFuel, parseReceipt } from './receipts';
import { milesBetween, parseOverpass, parsePlaces, priceStations, worthTheDrive } from './gas';
import { receiptSpendByDept, analyzeGroceries } from './groceries';
import type { Receipt } from './types';

const L = (t: string) => t.split('\n').map((text) => ({ text, confidence: 95 }));

describe('pantry', () => {
  it('quick-adds counts, amounts and levels', () => {
    const items = parseQuickAdd('eggs 12\nrice 5 lb\nsoup 4 cans\nmilk\ncoffee low\n2 dozen tortillas');
    const by = Object.fromEntries(items.map((i) => [i.name.toLowerCase(), i]));
    expect(by.eggs).toMatchObject({ mode: 'count', qty: 12, unit: 'ct' });
    expect(by.rice).toMatchObject({ mode: 'amount', qty: 5, unit: 'lb' });
    expect(by.soup).toMatchObject({ mode: 'count', qty: 4, unit: 'can' });
    expect(by.milk).toMatchObject({ mode: 'level', level: 'full' });
    expect(by.coffee).toMatchObject({ mode: 'level', level: 'low' });
    expect(by.tortillas).toMatchObject({ mode: 'count', qty: 24 });
  });

  it('knows when something is low or out', () => {
    const [eggs, milk] = parseQuickAdd('eggs 12\nmilk');
    expect(stockOf(eggs)).toBe('ok');
    expect(stockOf({ ...eggs, qty: 2 })).toBe('low');
    expect(stockOf({ ...eggs, qty: 0 })).toBe('out');
    expect(stockOf({ ...milk, level: nextLevel(nextLevel('full')) })).toBe('low');
  });

  it('matches receipt lines loosely', () => {
    const [milk] = parseQuickAdd('milk');
    expect(matches(milk, 'wholemilkgallon', 'Whole Milk Gallon')).toBe(true);
    expect(matches(milk, 'chocolatechips', 'Chocolate Chips')).toBe(false);
  });

  it('restocks from a receipt and builds the list with a trip estimate', () => {
    const pantry = parseQuickAdd('eggs 0\nmilk out\nbread low\nrice 5 lb');
    const receipt: Receipt = {
      id: 'r1',
      store: 'King Soopers',
      date: '2026-11-18',
      items: [
        { raw: '', name: 'Whole Milk Gallon', key: 'wholemilkgallon', price: 3.49, qty: 1, dept: 'dairy' },
        { raw: '', name: 'Large Eggs', key: 'largeeggs', price: 4.29, qty: 1, dept: 'dairy' },
      ],
      subtotal: null,
      tax: null,
      total: null,
      savings: null,
      source: 'text',
      createdAt: 0,
    };
    // eggs were bought: perBuy for "eggs 0" is 1 → set a dozen per purchase
    pantry[0].perBuy = 12;
    const changed = restockFromReceipt(pantry, receipt);
    expect(changed.find((c) => c.name === 'Eggs')?.qty).toBe(12);
    expect(changed.find((c) => c.name === 'Milk')?.level).toBe('full');

    const after = pantry.map((p) => changed.find((c) => c.id === p.id) ?? p);
    const lines = buildList(after, [], [receipt], '2026-11-19', (key) => (key.includes('bread') ? { price: 2.5, from: 'last paid' } : null));
    expect(lines.map((l) => l.name)).toEqual(['Bread']);
    const trip = estimateTrip(lines, 0.04);
    expect(trip.subtotal).toBe(2.5);
    expect(trip.total).toBe(2.6);
  });
});

describe('gas station receipts', () => {
  it('finds the pump line in a few formats', () => {
    expect(findFuel('REG UNL 10.123 GAL @ $3.459/GAL')).toEqual({ gallons: 10.123, perGallon: 3.459, grade: 'Regular' });
    expect(findFuel('Pump 05\nGallons: 8.250\nPrice/Gal: $3.299\nPremium')).toEqual({ gallons: 8.25, perGallon: 3.299, grade: 'Premium' });
    expect(findFuel('MILK 3.49')).toBeNull();
  });

  it('splits a Circle K stop into gas, nicotine, drinks and snacks', () => {
    const r = parseReceipt(
      L(`CIRCLE K #2709
COLORADO SPRINGS CO
11/18/2026 06:12
PUMP 04 UNLEADED
10.123 GAL @ $3.459/GAL     35.01
ZYN COOL MINT 6MG           5.49
MONSTER ENERGY 16OZ         3.29
DORITOS NACHO               2.49
SUBTOTAL                    46.28
TAX                          0.73
TOTAL                       47.01`),
    );
    expect(r.store).toBe('Circle K');
    expect(r.fuel).toEqual({ gallons: 10.123, perGallon: 3.459, grade: 'Regular' });
    const dept = (n: string) => r.items.find((i) => i.name.toLowerCase().includes(n))?.dept;
    expect(dept('gas')).toBe('fuel');
    expect(dept('zyn')).toBe('tobacco');
    expect(dept('monster')).toBe('drinks');
    expect(dept('doritos')).toBe('snacks');
    const spend = receiptSpendByDept([{ ...r, id: 'x', source: 'text', createdAt: 0 }], '2026-11');
    expect(spend[0].dept).toBe('fuel');
    expect(spend.find((s) => s.dept === 'tobacco')?.total).toBeGreaterThan(5.49);
    // a gas stop isn't a grocery trip
    expect(analyzeGroceries([{ ...r, id: 'x', source: 'text', createdAt: 0 }], '2026-11-19')?.items.some((i) => i.dept === 'fuel') ?? false).toBe(false);
  });
});

describe('nearby gas', () => {
  const home = { lat: 38.8339, lon: -104.8214 };
  it('reads OpenStreetMap stations and sorts by distance', () => {
    const st = parseOverpass(
      JSON.stringify({
        elements: [
          { type: 'node', id: 2, lat: 38.86, lon: -104.82, tags: { amenity: 'fuel', name: 'Conoco' } },
          { type: 'way', id: 1, center: { lat: 38.835, lon: -104.822 }, tags: { amenity: 'fuel', brand: 'Circle K', 'addr:housenumber': '10', 'addr:street': 'Main St' } },
        ],
      }),
      home,
    );
    expect(st.map((s) => s.name)).toEqual(['Circle K', 'Conoco']);
    expect(st[0].address).toBe('10 Main St');
    expect(milesBetween(home, { lat: 38.86, lon: -104.82 })).toBeCloseTo(1.8, 0);
  });

  it('reads Google posted prices', () => {
    const st = parsePlaces(
      JSON.stringify({ places: [{ id: 'abc', displayName: { text: 'Shell' }, location: { latitude: 38.84, longitude: -104.82 }, fuelOptions: { fuelPrices: [{ type: 'REGULAR_UNLEADED', price: { currencyCode: 'USD', units: '3', nanos: 199000000 }, updateTime: '2026-11-19T10:00:00Z' }] } }] }),
      home,
    );
    expect(st[0].live?.perGallon).toBe(3.199);
  });

  it('uses your own receipts for prices and checks if a far station is worth it', () => {
    const st = parseOverpass(JSON.stringify({ elements: [{ type: 'node', id: 2, lat: 38.835, lon: -104.822, tags: { name: 'Circle K' } }, { type: 'node', id: 3, lat: 38.9, lon: -104.82, tags: { name: 'Costco Gas' } }] }), home);
    const priced = priceStations(st, [{ id: 'p1', station: 'Circle K', stationId: null, lat: 38.8351, lon: -104.8221, perGallon: 3.459, grade: 'Regular', date: '2026-11-18', source: 'receipt' }, { id: 'p2', station: 'Costco Gas', stationId: 'osm:node/3', lat: null, lon: null, perGallon: 3.099, grade: 'Regular', date: '2026-11-17', source: 'manual' }], '2026-11-19');
    expect(priced[0].price).toBe(3.459);
    expect(priced[1].price).toBe(3.099);
    expect(worthTheDrive(priced[1], priced[0], 12, 25)).toBeGreaterThan(0);
  });
});

describe('Google gas price errors explain the fix', async () => {
  const { googleMessage } = await import('../data/pantryActions');
  it('maps Google errors to steps', () => {
    expect(googleMessage('Places API (New) has not been used in project 123 before or it is disabled')).toMatch(/Enable/);
    expect(googleMessage('Requests from this Android client application <empty> are blocked.')).toMatch(/restrictions/);
    expect(googleMessage('API key not valid. Please pass a valid API key.')).toMatch(/isn’t valid/);
    expect(googleMessage('This API project is not authorized to use this API. Please ensure billing')).toMatch(/billing|restrictions/);
  });
});
