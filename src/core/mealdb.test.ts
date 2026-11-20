import { describe, expect, it } from 'vitest';
import { parseMeal, searchMeals, toSteps } from './mealdb';
import { matchRecipe } from './recipes';
import { newPantryItem } from './pantry';

const meal = {
  meals: [
    {
      idMeal: '52795',
      strMeal: 'Chicken Handi',
      strCategory: 'Chicken',
      strArea: 'Indian',
      strTags: null,
      strMealThumb: 'https://www.themealdb.com/images/media/meals/wyxwsp1486979827.jpg',
      strSource: '',
      strYoutube: 'https://www.youtube.com/watch?v=IO0issT0Rmc',
      strInstructions: 'STEP 1\\r\\nTake a large pot and heat the oil.\\r\\nSTEP 2\\r\\nAdd the onions and fry until golden.\\r\\n\\r\\nAdd the chicken and cook through.',
      strIngredient1: 'Chicken',
      strMeasure1: '1.2 kg',
      strIngredient2: 'Onion',
      strMeasure2: '5 thinly sliced',
      strIngredient3: 'Tomatoes',
      strMeasure3: '2 finely chopped',
      strIngredient4: 'Vegetable Oil',
      strMeasure4: '1/4 cup',
      strIngredient5: 'Salt',
      strMeasure5: 'to taste',
      strIngredient6: '',
      strMeasure6: '',
    },
  ],
};

describe('TheMealDB', () => {
  it('turns a meal into a recipe you can save, without salt and oil', () => {
    const d = parseMeal(JSON.stringify(meal).replace(/\\\\r\\\\n/g, '\\r\\n'))!;
    expect(d.recipe.name).toBe('Chicken Handi');
    expect(d.recipe.id).toBe('mealdb_52795');
    expect(d.recipe.ingredients.map((i) => [i.name, i.match[0], i.qty])).toEqual([
      ['Chicken', 'chicken', '1.2 kg'],
      ['Onion', 'onion', '5 thinly sliced'],
      ['Tomatoes', 'tomato', '2 finely chopped'],
    ]);
    expect(d.recipe.steps).toEqual(['Take a large pot and heat the oil.', 'Add the onions and fry until golden.', 'Add the chicken and cook through.']);
    expect(d.recipe.tags).toContain('online');
    // and it checks against the pantry like any recipe
    expect(matchRecipe(d.recipe, [newPantryItem('Chicken Thighs'), newPantryItem('Onions')]).missing.map((i) => i.name)).toEqual(['Tomatoes']);
  });
  it('splits steps written as one paragraph block', () => {
    expect(toSteps('1. Boil water.\n2. Add pasta.')).toEqual(['Boil water.', 'Add pasta.']);
  });
  it('searches by name and by ingredient, and never throws offline', async () => {
    const calls: string[] = [];
    const ok = await searchMeals(async (url) => {
      calls.push(url);
      return { status: 200, text: JSON.stringify({ meals: url.includes('filter') ? [{ idMeal: '1', strMeal: 'Rice Bowl' }] : null }) };
    }, 'Chicken Breast');
    expect(ok.hits.map((h) => h.name)).toEqual(['Rice Bowl']);
    expect(calls[1]).toContain('filter.php?i=chicken_breast');
    const off = await searchMeals(async () => Promise.reject(new Error('offline')), 'rice');
    expect(off.error).toMatch(/Couldn’t reach/);
  });
});
