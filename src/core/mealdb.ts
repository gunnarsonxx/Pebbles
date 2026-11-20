// Recipes from TheMealDB (free, no account): search by name or main ingredient, then save any to your recipes.
import type { HttpFn } from './market';
import type { Recipe, RecipeIngredient } from './types';

export const MEALDB = 'https://www.themealdb.com/api/json/v1/1';

export interface MealHit {
  id: string;
  name: string;
  thumb: string | null;
}

export interface MealDetail extends MealHit {
  category: string | null;
  area: string | null;
  source: string | null;
  recipe: Recipe; // ready to save
}

// salt, pepper, oil and water are assumed in every kitchen
const BASICS = /^(salt|pepper|black pepper|sea salt|kosher salt|water|oil|olive oil|vegetable oil|cooking oil|sunflower oil|canola oil)$/i;

const singular = (w: string) =>
  w
    .replace(/(ies)$/i, 'y')
    .replace(/(oes)$/i, 'o')
    .replace(/([^s])s$/i, '$1');

function hits(text: string): MealHit[] {
  const meals = (JSON.parse(text)?.meals ?? []) as { idMeal: string; strMeal: string; strMealThumb?: string }[];
  return (meals ?? []).map((m) => ({ id: m.idMeal, name: m.strMeal, thumb: m.strMealThumb ?? null }));
}

/** What a recipe's ingredient looks like on a pantry shelf: "Chicken Breasts" → match "chicken breast". */
export function toIngredient(name: string, measure: string): RecipeIngredient {
  const n = name.trim();
  const key = singular(n.toLowerCase());
  return { name: n, match: [key], qty: measure.trim() || undefined };
}

/** Steps from TheMealDB's one big block of instructions. */
export function toSteps(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?])\s{2,}/)
    .map((s) => s.replace(/^\s*(step\s*\d+[:.)-]?|\d+[.)])\s*/i, '').trim())
    .filter((s) => s.length > 2 && !/^step\s*\d+$/i.test(s));
}

export function parseMeal(text: string): MealDetail | null {
  const m = (JSON.parse(text)?.meals ?? [])[0] as Record<string, string | null> | undefined;
  if (!m?.idMeal) return null;
  const ingredients: RecipeIngredient[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m[`strIngredient${i}`] ?? '').trim();
    if (!name || BASICS.test(name)) continue;
    ingredients.push(toIngredient(name, m[`strMeasure${i}`] ?? ''));
  }
  const steps = toSteps(m.strInstructions ?? '');
  const tags = [(m.strCategory ?? '').toLowerCase(), ...(m.strTags ?? '').split(',').map((t) => t.trim().toLowerCase())].filter(Boolean);
  // TheMealDB doesn't list a time: a rough guess from how much there is to do
  const minutes = Math.max(20, Math.min(120, Math.round((steps.length * 8 + ingredients.length * 2) / 5) * 5));
  return {
    id: m.idMeal,
    name: m.strMeal ?? 'Recipe',
    thumb: m.strMealThumb ?? null,
    category: m.strCategory ?? null,
    area: m.strArea ?? null,
    source: m.strSource || m.strYoutube || null,
    recipe: {
      id: `mealdb_${m.idMeal}`,
      name: m.strMeal ?? 'Recipe',
      minutes,
      servings: 4,
      tags: [...new Set(['online', ...tags.filter((t) => t.length < 20)])].slice(0, 5),
      ingredients,
      steps: steps.length ? steps : ['See the original recipe.'],
      custom: true,
    },
  };
}

/** Search by meal name, and by main ingredient; both lists together, no repeats. Never throws. */
export async function searchMeals(http: HttpFn, q: string): Promise<{ hits: MealHit[]; error: string | null }> {
  const term = q.trim();
  if (!term) return { hits: [], error: null };
  const out = new Map<string, MealHit>();
  let reached = false;
  for (const url of [`${MEALDB}/search.php?s=${encodeURIComponent(term)}`, `${MEALDB}/filter.php?i=${encodeURIComponent(term.toLowerCase().replace(/\s+/g, '_'))}`]) {
    try {
      const res = await http(url);
      if (res.status === 200) {
        reached = true;
        for (const h of hits(res.text)) out.set(h.id, h);
      }
    } catch {
      /* try the other */
    }
  }
  return { hits: [...out.values()], error: reached ? null : 'Couldn’t reach the recipe site. Check your internet and try again.' };
}

export async function loadMeal(http: HttpFn, id: string): Promise<MealDetail | null> {
  try {
    const res = await http(`${MEALDB}/lookup.php?i=${encodeURIComponent(id)}`);
    return res.status === 200 ? parseMeal(res.text) : null;
  } catch {
    return null;
  }
}
