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
    const picks = defaultPicks(receipt('2026-10-02'), '2026-11-20', [], [airFryer]);
    expect(picks.find((p) => p.item.name === 'Pizza Rolls')?.stapleId).toBe(airFryer.id); // guessed from the staple
    picks[0].left = 'half'; // pizza rolls
    picks[3].left = 'low'; // rice
    const res = applyPicks(picks, [], [airFryer], '2026-10-02');
    expect(res.pantry.map((p) => [p.name, p.level, p.stapleId ?? null])).toEqual([
      ['Pizza Rolls', 'half', airFryer.id],
      ['Rice', 'low', null],
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
