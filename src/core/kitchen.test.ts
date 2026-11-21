import { describe, expect, it } from 'vitest';
import { applyPicks, claimForStaple, defaultPicks, newStaple, STAPLE_PRESETS, stapleStatus } from './kitchen';
import { buildList, newPantryItem } from './pantry';
import { matchRecipe, BUILT_IN_RECIPES, whatCanIMake, usedUp, parseIngredients, prepShopping } from './recipes';
import type { Receipt } from './types';

const item = (name: string, price = 3.99) => ({ raw: name, name, key: name.toLowerCase().replace(/[^a-z]/g, ''), price, qty: 1, dept: 'frozen' as const });
const receipt = (date: string): Pick<Receipt, 'items' | 'date'> => ({ date, items: [item('Pizza Rolls'), item('Popcorn Chicken'), item('Milk'), item('Rice'), item('Coupon', 0)] });
const airFryer = newStaple(STAPLE_PRESETS[0].name, STAPLE_PRESETS[0].keywords);

describe('receipts only fill the pantry with what you pick', () => {
  it('an old receipt starts with nothing picked; a fresh one starts full', () => {
    expect(defaultPicks(receipt('2026-10-02'), '2026-11-20', [], []).every((p) => p.left === 'gone')).toBe(true);
    expect(defaultPicks(receipt('2026-11-19'), '2026-11-20', [], []).every((p) => p.left === 'full')).toBe(true);
    // the same product twice is one line; $0 lines (coupons) are skipped
    expect(defaultPicks(receipt('2026-11-19'), '2026-11-20', [], []).map((p) => p.item.name)).toEqual(['Pizza Rolls', 'Popcorn Chicken', 'Milk', 'Rice']);
  });
  it('adds only picked items, with how much is left, and files them under a staple', () => {
    const picks = defaultPicks(receipt('2026-10-02'), '2026-11-20', [], [airFryer], new Set(['milk']));
    expect(picks.find((p) => p.item.name === 'Milk')?.always).toBe(true); // bought most trips: a staple
    expect(picks.find((p) => p.item.name === 'Pizza Rolls')?.stapleId).toBe(airFryer.id); // guessed from the staple
    picks[0].left = 'half'; // pizza rolls
    picks[3].left = 'low'; // rice
    const res = applyPicks(picks, [], [airFryer], '2026-10-02');
    // milk is gone but it's a staple: it goes in as Out so the list asks for it
    expect(res.pantry.map((p) => [p.name, p.level, p.stapleId ?? null, !!p.always])).toEqual([
      ['Pizza Rolls', 'half', airFryer.id, false],
      ['Milk', 'out', null, true],
      ['Rice', 'low', null, false],
    ]);
    expect(res.staples[0].examples).toEqual(['Pizza Rolls']);
  });
});

describe('staples', () => {
  it('the list asks for the kind of food once everything in it is out, not each product', () => {
    const rolls = { ...newPantryItem('Pizza Rolls'), level: 'out' as const, stapleId: airFryer.id };
    const chicken = { ...newPantryItem('Popcorn Chicken'), level: 'out' as const, stapleId: airFryer.id };
    const milk = { ...newPantryItem('Milk'), level: 'out' as const };
    const lines = buildList([rolls, chicken, milk], [], [], '2026-11-20', () => null, [{ ...airFryer, examples: ['Pizza Rolls'] }]);
    expect(lines.map((l) => l.name)).toEqual(['Air Fryer Frozen Food', 'Milk']);
    expect(lines[0].staple?.options).toEqual(['Pizza Rolls', 'Popcorn Chicken']);
    // one still in the freezer: no staple line
    const some = buildList([{ ...rolls, level: 'half' }, chicken], [], [], '2026-11-20', () => null, [airFryer]);
    expect(some.length).toBe(0);
    expect(stapleStatus([airFryer], [{ ...rolls, level: 'half' }, chicken])[0].stock).toBe('ok');
  });
  it('a new staple claims matching pantry items', () => {
    const claimed = claimForStaple(airFryer, [newPantryItem('Tyson Chicken Nuggets'), newPantryItem('Milk')]);
    expect(claimed.map((p) => p.name)).toEqual(['Tyson Chicken Nuggets']);
  });
});

describe('meals from the pantry', () => {
  const pantry = ['Rice', 'Chicken breast', 'Frozen broccoli', 'Eggs', 'Pizza Rolls', 'Popcorn Chicken', 'Tortillas', 'Shredded cheddar cheese'].map((n) => newPantryItem(n));
  it('finds what you can make, without mixing up popcorn chicken and chicken breast', () => {
    const { ready } = whatCanIMake(BUILT_IN_RECIPES, pantry);
    const names = ready.map((m) => m.recipe.name);
    expect(names).toEqual(expect.arrayContaining(['Air Fryer Plate', 'Chicken & Rice Bowls', 'Egg Fried Rice', 'Quesadillas']));
    const plate = matchRecipe(BUILT_IN_RECIPES.find((r) => r.id === 'air-fryer-plate')!, pantry);
    expect(['Pizza Rolls', 'Popcorn Chicken']).toContain(plate.have[0].item.name);
    const noChicken = pantry.filter((p) => p.name !== 'Chicken breast');
    expect(matchRecipe(BUILT_IN_RECIPES.find((r) => r.id === 'chicken-rice-bowls')!, noChicken).missing.map((x) => x.name)).toEqual(['Chicken']);
  });
  it('cooking uses things up, and meal prep lists what to buy', () => {
    const m = matchRecipe(BUILT_IN_RECIPES.find((r) => r.id === 'egg-fried-rice')!, pantry);
    expect(usedUp(m).every((p) => p.level === 'half')).toBe(true);
    const need = prepShopping([{ id: 'chili', batches: 1, addedAt: 0 }], BUILT_IN_RECIPES, pantry);
    expect(need.map((n) => n.name)).toEqual(['Ground beef or turkey', 'Beans', 'Canned tomatoes']);
  });
  it('reads your own ingredient list', () => {
    expect(parseIngredients('2 cups Rice\nChicken breasts\nCheese (optional)')).toEqual([
      { name: '2 cups Rice', match: ['rice'], optional: false },
      { name: 'Chicken breasts', match: ['chicken breast'], optional: false },
      { name: 'Cheese', match: ['cheese'], optional: true },
    ]);
  });
});

describe('filling the pantry from old receipts', () => {
  it('lists what you bought that isn’t in the pantry, most-bought first, and keeps each one’s date', async () => {
    const { pastItems, applyPicks } = await import('./kitchen');
    const r = (date: string, names: string[]) => ({
      id: date,
      store: 'King Soopers',
      date,
      items: names.map((n) => item(n)),
      subtotal: null,
      tax: null,
      total: null,
      savings: null,
      source: 'pdf' as const,
      createdAt: 0,
    });
    const receipts = [r('2026-09-01', ['Rice', 'Sugar']), r('2026-10-01', ['Rice', 'Coffee']), r('2026-11-01', ['Rice', 'Milk'])];
    const list = pastItems(receipts, [newPantryItem('Milk')], new Set(['rice']));
    expect(list.map((x) => [x.item.name, x.trips, x.date, x.usual])).toEqual([
      ['Rice', 3, '2026-11-01', true],
      ['Coffee', 1, '2026-10-01', false],
      ['Sugar', 1, '2026-09-01', false],
    ]);
    const sugar = list.find((x) => x.item.name === 'Sugar')!;
    const out = applyPicks([{ item: sugar.item, left: 'half', count: null, always: false, stapleId: null, date: sugar.date }], [], [], '2026-11-20');
    expect(out.pantry[0]).toMatchObject({ name: 'Sugar', level: 'half', lastBought: '2026-09-01' });
  });
});

describe('adding something whose name is inside another item’s name', () => {
  it('Coffee is added next to Coffee Creamer, not merged into it (and Milk next to Chocolate Milk)', async () => {
    const { matches } = await import('./pantry');
    const creamer = newPantryItem('Coffee Creamer');
    const choc = newPantryItem('Chocolate Milk');
    expect(matches(creamer, 'coffee', 'Coffee')).toBe(false);
    expect(matches(newPantryItem('Coffee'), 'coffeecreamer', 'Coffee Creamer')).toBe(false);
    expect(matches(choc, 'milk', 'Milk')).toBe(false);
    // still the same thing: plurals, and a long receipt line for a plain pantry name
    expect(matches(newPantryItem('Egg'), 'eggs', 'Eggs')).toBe(true);
    expect(matches(newPantryItem('Eggs'), 'largeeggs', 'Large Eggs')).toBe(true);
    const coffee = {
      raw: 'Kroger Classic Blend Medium Roast Ground Coffee, 29 oz',
      desc: 'Kroger Classic Blend Medium Roast Ground Coffee, 29 oz',
      name: 'Coffee',
      key: 'coffee',
      price: 12.99,
      qty: 1,
      dept: 'drinks' as const,
    };
    const res = applyPicks([{ item: coffee, left: 'full', count: null, always: false, stapleId: null }], [creamer, choc], [], '2026-10-27');
    expect(res.added).toEqual(['Coffee']);
    expect(res.updated).toEqual([]);
    expect(res.pantry[0]).toMatchObject({ name: 'Coffee', level: 'full', desc: 'Kroger Classic Blend Medium Roast Ground Coffee, 29 oz' });
  });
});

describe('different things that share a word', () => {
  it('coffee filters are their own thing, and never update the coffee', async () => {
    const { cleanItemName } = await import('./groceries');
    const { findSame } = await import('./kitchen');
    expect(cleanItemName('Melitta Basket Coffee Filters 200 ct').name).toBe('Melitta Basket Coffee Filters');
    expect(cleanItemName("Reese's Peanut Butter Cups").name).not.toBe('Peanut Butter');
    expect(cleanItemName('Ziploc Gallon Storage Bags').name).toBe('Ziploc Gallon Storage Bags');
    expect(cleanItemName('King Soopers City Market Vitamin D Whole Milk Gallon').name).toBe('Milk');
    const grounds = { ...newPantryItem('Coffee'), desc: 'Kroger Classic Blend Medium Roast Ground Coffee, 29 oz' };
    // even if a filter came in named "Coffee", its description says otherwise
    expect(findSame([grounds], { key: 'coffee', name: 'Coffee', raw: 'Melitta Basket Coffee Filters', desc: 'Melitta Basket Coffee Filters 200 ct' })).toBeUndefined();
    // the same coffee in another size is the same pantry item
    expect(findSame([grounds], { key: 'coffee', name: 'Coffee', raw: 'x', desc: 'Kroger Classic Blend Medium Roast Ground Coffee, 11.5 oz' })).toBe(grounds);
    // a pick marked "keep separate" is added on its own
    const res = applyPicks(
      [{ item: { raw: 'Kroger Classic Blend Coffee', name: 'Coffee', key: 'coffee', price: 0, qty: 1, dept: 'drinks' }, left: 'full', count: null, always: false, stapleId: null, separate: true }],
      [grounds],
      [],
      '2026-11-20',
    );
    expect(res.added).toEqual(['Coffee']);
  });
});

describe('I Made This takes off what the recipe uses', () => {
  it('counted things by the recipe’s amount, others a step', async () => {
    const { usedUp, matchRecipe, BUILT_IN_RECIPES } = await import('./recipes');
    const eggs = { ...newPantryItem('Eggs'), mode: 'count' as const, qty: 12, unit: 'ct', perBuy: 12 };
    const cheese = newPantryItem('Shredded cheddar cheese');
    const omelet = BUILT_IN_RECIPES.find((r) => r.id === 'omelet')!;
    const after = usedUp(matchRecipe(omelet, [eggs, cheese]));
    expect(after.find((p) => p.name === 'Eggs')?.qty).toBe(9);
    expect(after.find((p) => p.name === 'Shredded cheddar cheese')?.level).toBe('half');
    // two batches of breakfast burritos: 20 eggs, but never below zero
    const burritos = BUILT_IN_RECIPES.find((r) => r.id === 'breakfast-burritos')!;
    expect(usedUp(matchRecipe(burritos, [eggs, newPantryItem('Tortillas'), cheese]), 2).find((p) => p.name === 'Eggs')?.qty).toBe(0);
    expect(BUILT_IN_RECIPES.length).toBeGreaterThanOrEqual(70);
  });
});

describe('recipe ingredients mean what they say', () => {
  it('corn starch isn’t a vegetable, sliced American isn’t mozzarella, taquitos aren’t chicken', async () => {
    const { haveFor, BUILT_IN_RECIPES } = await import('./recipes');
    const ing = (id: string, name: string) => BUILT_IN_RECIPES.find((r) => r.id === id)!.ingredients.find((i) => i.name.startsWith(name))!;
    const veg = ing('chicken-rice-bowls', 'Veggies');
    expect(haveFor(veg, [newPantryItem('Corn Starch')])).toBeNull();
    expect(haveFor(veg, [{ ...newPantryItem('Corn'), desc: 'Argo Corn Starch 16 oz' }])).toBeNull();
    expect(haveFor(veg, [newPantryItem('Frozen Corn')])?.name).toBe('Frozen Corn');
    const mozz = ing('lasagna', 'Mozzarella');
    expect(haveFor(mozz, [newPantryItem('Sliced Cheese'), { ...newPantryItem('American Singles') }])).toBeNull();
    expect(haveFor(mozz, [newPantryItem('Shredded Mozzarella')])?.name).toBe('Shredded Mozzarella');
    const shredded = ing('taco-bowls', 'Shredded cheese');
    expect(haveFor(shredded, [newPantryItem('Sliced Cheese')])).toBeNull();
    const chicken = ing('chicken-rice-bowls', 'Chicken');
    expect(haveFor(chicken, [{ ...newPantryItem('Taquitos'), desc: 'El Monterey Chicken & Cheese Frozen Flour Taquitos' }])).toBeNull();
  });
});
