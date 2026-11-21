import { describe, expect, it } from 'vitest';
import { findRecipes, loadRecipe, pantryOverlap } from './recipeSearch';
import type { HttpFn } from './market';

const fake =
  (routes: Record<string, unknown>): HttpFn =>
  async (url) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    return hit ? { status: 200, text: JSON.stringify(hit[1]) } : { status: 404, text: '' };
  };

describe('recipes from everywhere, by what you have', () => {
  it('matches pantry names to ingredients by whole word, singular or plural', () => {
    expect(pantryOverlap(['2 cups chickpeas', 'gochujang paste', 'green onion'], ['Chickpea', 'Gochujang', 'Onions', 'Rice'])).toEqual(['Chickpea', 'Gochujang', 'Onions']);
    expect(pantryOverlap(['pineapple'], ['Apple'])).toEqual([]);
  });

  it('searches every source you have keys for and ranks by how much of yours each uses', async () => {
    const http = fake({
      'filter.php?i=gochujang': { meals: [{ idMeal: '1', strMeal: 'Gochujang Chicken' }] },
      'filter.php?i=chicken': {
        meals: [
          { idMeal: '1', strMeal: 'Gochujang Chicken' },
          { idMeal: '2', strMeal: 'Roast Chicken' },
        ],
      },
      findByIngredients: [{ id: 77, title: 'Spicy Gochujang Tofu Rice Bowl', usedIngredients: [{ name: 'gochujang' }, { name: 'tofu' }, { name: 'rice' }], missedIngredientCount: 1 }],
      'api.edamam.com': {
        hits: [
          {
            recipe: {
              uri: 'x#recipe_abc',
              label: 'Roast Chicken',
              ingredients: [
                { food: 'chicken', text: '1 whole chicken' },
                { food: 'lemon', text: '1 lemon' },
              ],
            },
          },
        ],
      },
    });
    const r = await findRecipes(http, { spoonacularKey: 'k', edamamAppId: 'a', edamamKey: 'b' }, ['Gochujang', 'Chicken', 'Tofu', 'Rice'], null);
    expect(r.sources).toEqual(['mealdb', 'spoonacular', 'edamam']);
    expect(r.hits[0].name).toBe('Spicy Gochujang Tofu Rice Bowl'); // uses 3 of yours
    expect(r.hits.map((h) => h.name)).toContain('Gochujang Chicken');
    // the same dish from two places shows once
    expect(r.hits.filter((h) => h.name === 'Roast Chicken')).toHaveLength(1);
  });

  it('opens a Spoonacular recipe with its steps, ready to save', async () => {
    const http = fake({
      '/recipes/77/information': {
        id: 77,
        title: 'Spicy Gochujang Tofu Rice Bowl',
        readyInMinutes: 25,
        servings: 2,
        extendedIngredients: [
          { name: 'gochujang', original: '2 tbsp gochujang', amount: 2, unit: 'tbsp' },
          { name: 'salt', original: 'salt' },
        ],
        analyzedInstructions: [{ steps: [{ step: 'Press the tofu.' }, { step: 'Fry it.' }] }],
      },
    });
    const d = await loadRecipe(http, { spoonacularKey: 'k' }, { id: 'spoonacular:77', source: 'spoonacular', name: 'x', thumb: null, have: [], missing: null });
    expect(d!.recipe.minutes).toBe(25);
    expect(d!.recipe.ingredients.map((i) => i.name)).toEqual(['gochujang']);
    expect(d!.recipe.steps).toEqual(['Press the tofu.', 'Fry it.']);
  });
});
