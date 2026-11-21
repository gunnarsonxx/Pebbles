// Recipes from three places, searched together: TheMealDB (free), Spoonacular (365k+ recipes, "find by what I have")
// and Edamam (2.3M+ recipes from food sites). Spoonacular and Edamam need your own free keys. Results are ranked by
// how many of their ingredients you already have.
import type { HttpFn } from './market';
import { MEALDB, loadMeal, toIngredient, toSteps, type MealDetail } from './mealdb';
import type { Recipe } from './types';

export type RecipeSource = 'mealdb' | 'spoonacular' | 'edamam';
export const SOURCE_NAME: Record<RecipeSource, string> = { mealdb: 'TheMealDB', spoonacular: 'Spoonacular', edamam: 'Edamam' };

export interface RecipeKeys {
  spoonacularKey?: string;
  edamamAppId?: string;
  edamamKey?: string;
}

export interface RecipeHit {
  id: string; // source:id
  source: RecipeSource;
  name: string;
  thumb: string | null;
  have: string[]; // your pantry things it uses
  missing: number | null; // ingredients you don't have (when known up front)
  url?: string; // Edamam: the original recipe page
  edamam?: EdamamRecipe; // Edamam sends the whole recipe in the search
}

interface EdamamRecipe {
  uri: string;
  label: string;
  image?: string;
  url?: string;
  source?: string;
  yield?: number;
  totalTime?: number;
  ingredientLines?: string[];
  ingredients?: { food: string; text: string; quantity?: number; measure?: string | null }[];
  dishType?: string[];
  cuisineType?: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const singular = (w: string) =>
  w
    .replace(/(ies)$/, 'y')
    .replace(/(oes)$/, 'o')
    .replace(/([^s])s$/, '$1');

/** Which of your pantry names show up in a list of ingredient names (whole words, singular/plural alike). */
export function pantryOverlap(ingredients: string[], pantry: string[]): string[] {
  const ing = ingredients.map((i) => ` ${norm(i).split(' ').map(singular).join(' ')} `);
  return pantry.filter((p) => {
    const key = norm(p).split(' ').map(singular).join(' ');
    return key.length > 1 && ing.some((i) => i.includes(` ${key} `));
  });
}

async function getJson<T>(http: HttpFn, url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const r = await http(url, headers ? { headers } : undefined);
    return r.status === 200 ? (JSON.parse(r.text) as T) : null;
  } catch {
    return null;
  }
}

// ---------------- TheMealDB: one ingredient at a time, then ranked by how many of yours each meal came up for ----------------
async function mealdbSearch(http: HttpFn, terms: string[], query: string | null): Promise<RecipeHit[]> {
  const found = new Map<string, RecipeHit>();
  const add = (m: { idMeal: string; strMeal: string; strMealThumb?: string }, via: string | null) => {
    const id = `mealdb:${m.idMeal}`;
    const cur = found.get(id) ?? { id, source: 'mealdb' as const, name: m.strMeal, thumb: m.strMealThumb ?? null, have: [], missing: null };
    if (via && !cur.have.includes(via)) cur.have.push(via);
    found.set(id, cur);
  };
  if (query) {
    const r = await getJson<{ meals: { idMeal: string; strMeal: string; strMealThumb?: string }[] | null }>(http, `${MEALDB}/search.php?s=${encodeURIComponent(query)}`);
    for (const m of r?.meals ?? []) add(m, null);
  }
  for (const t of terms.slice(0, 12)) {
    const r = await getJson<{ meals: { idMeal: string; strMeal: string; strMealThumb?: string }[] | null }>(http, `${MEALDB}/filter.php?i=${encodeURIComponent(t.toLowerCase().replace(/\s+/g, '_'))}`);
    for (const m of r?.meals ?? []) add(m, t);
  }
  return [...found.values()];
}

// ---------------- Spoonacular ----------------
interface SpoonFind {
  id: number;
  title: string;
  image?: string;
  usedIngredients: { name: string }[];
  missedIngredientCount: number;
}
async function spoonSearch(http: HttpFn, key: string, pantry: string[], query: string | null): Promise<RecipeHit[] | { error: string }> {
  if (query) {
    const r = await getJson<{ results: { id: number; title: string; image?: string; usedIngredients?: { name: string }[]; missedIngredientCount?: number }[] }>(
      http,
      `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(query)}&number=20&fillIngredients=true&includeIngredients=${encodeURIComponent(pantry.slice(0, 10).join(','))}&sort=max-used-ingredients&apiKey=${encodeURIComponent(key)}`,
    );
    if (!r) return { error: 'Spoonacular didn’t answer (check the key in Settings → Connections, or the free daily limit may be used up).' };
    return r.results.map((x) => ({
      id: `spoonacular:${x.id}`,
      source: 'spoonacular' as const,
      name: x.title,
      thumb: x.image ?? null,
      have: pantryOverlap(
        (x.usedIngredients ?? []).map((u) => u.name),
        pantry,
      ),
      missing: x.missedIngredientCount ?? null,
    }));
  }
  const r = await getJson<SpoonFind[]>(
    http,
    `https://api.spoonacular.com/recipes/findByIngredients?ingredients=${encodeURIComponent(pantry.slice(0, 25).join(','))}&number=30&ranking=1&ignorePantry=true&apiKey=${encodeURIComponent(key)}`,
  );
  if (!r) return { error: 'Spoonacular didn’t answer (check the key in Settings → Connections, or the free daily limit may be used up).' };
  return r.map((x) => ({
    id: `spoonacular:${x.id}`,
    source: 'spoonacular' as const,
    name: x.title,
    thumb: x.image ?? null,
    have: pantryOverlap(
      x.usedIngredients.map((u) => u.name),
      pantry,
    ),
    missing: x.missedIngredientCount,
  }));
}

// ---------------- Edamam ----------------
async function edamamSearch(http: HttpFn, id: string, key: string, terms: string[], query: string | null, pantry: string[]): Promise<RecipeHit[] | { error: string }> {
  const qs = query ? [query] : terms.slice(0, 3);
  const out: RecipeHit[] = [];
  let answered = false;
  for (const q of qs) {
    const r = await getJson<{ hits: { recipe: EdamamRecipe }[] }>(
      http,
      `https://api.edamam.com/api/recipes/v2?type=public&q=${encodeURIComponent(q)}&app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}`,
      { 'Edamam-Account-User': 'pebbles' },
    );
    if (!r) continue;
    answered = true;
    for (const h of r.hits) {
      const rec = h.recipe;
      const names = (rec.ingredients ?? []).map((i) => i.food);
      const have = pantryOverlap(names, pantry);
      out.push({
        id: `edamam:${rec.uri.split('#recipe_')[1] ?? rec.uri}`,
        source: 'edamam',
        name: rec.label,
        thumb: rec.image ?? null,
        have,
        missing: Math.max(0, new Set(names.map(norm)).size - have.length),
        url: rec.url,
        edamam: rec,
      });
    }
  }
  return answered ? out : { error: 'Edamam didn’t answer (check the app ID and key in Settings → Connections).' };
}

/**
 * Search every source you have set up. With no words, it searches by what's in your pantry. Best matches first: the
 * most of your things used, then the fewest missing.
 */
export async function findRecipes(http: HttpFn, keys: RecipeKeys, pantry: string[], query: string | null): Promise<{ hits: RecipeHit[]; errors: string[]; sources: RecipeSource[] }> {
  const terms = query ? [] : pantry;
  const errors: string[] = [];
  const sources: RecipeSource[] = ['mealdb'];
  const jobs: Promise<RecipeHit[]>[] = [mealdbSearch(http, query ? [] : terms, query)];
  if (keys.spoonacularKey?.trim()) {
    sources.push('spoonacular');
    jobs.push(spoonSearch(http, keys.spoonacularKey.trim(), pantry, query).then((r) => ('error' in r ? (errors.push(r.error), []) : r)));
  }
  if (keys.edamamAppId?.trim() && keys.edamamKey?.trim()) {
    sources.push('edamam');
    jobs.push(edamamSearch(http, keys.edamamAppId.trim(), keys.edamamKey.trim(), terms, query, pantry).then((r) => ('error' in r ? (errors.push(r.error), []) : r)));
  }
  const all = (await Promise.all(jobs)).flat();
  // the same dish from two places: keep the one that knows more
  const seen = new Map<string, RecipeHit>();
  for (const h of all) {
    const k = norm(h.name);
    const cur = seen.get(k);
    if (!cur || h.have.length > cur.have.length) seen.set(k, h);
  }
  const hits = [...seen.values()].sort((a, b) => b.have.length - a.have.length || (a.missing ?? 99) - (b.missing ?? 99) || a.name.localeCompare(b.name));
  return { hits, errors, sources };
}

const recipeOf = (id: string, name: string, minutes: number, servings: number, tags: string[], ingredients: Recipe['ingredients'], steps: string[]): Recipe => ({
  id,
  name,
  minutes,
  servings,
  tags: [...new Set(['online', ...tags.map((t) => t.toLowerCase()).filter((t) => t && t.length < 20)])].slice(0, 5),
  ingredients,
  steps: steps.length ? steps : ['See the original recipe.'],
  custom: true,
});

const BASICS = /^(salt|pepper|black pepper|sea salt|kosher salt|water|oil|olive oil|vegetable oil|cooking oil|canola oil|ice)$/i;

/** The whole recipe, ready to preview and save. */
export async function loadRecipe(http: HttpFn, keys: RecipeKeys, hit: RecipeHit): Promise<MealDetail | null> {
  const raw = hit.id.split(':').slice(1).join(':');
  if (hit.source === 'mealdb') return loadMeal(http, raw);
  if (hit.source === 'spoonacular') {
    const r = await getJson<{
      id: number;
      title: string;
      image?: string;
      readyInMinutes?: number;
      servings?: number;
      sourceUrl?: string;
      dishTypes?: string[];
      cuisines?: string[];
      extendedIngredients?: { name: string; original: string; amount?: number; unit?: string }[];
      analyzedInstructions?: { steps: { step: string }[] }[];
      instructions?: string;
    }>(http, `https://api.spoonacular.com/recipes/${encodeURIComponent(raw)}/information?apiKey=${encodeURIComponent(keys.spoonacularKey ?? '')}`);
    if (!r) return null;
    const ings = (r.extendedIngredients ?? []).filter((i) => !BASICS.test(i.name)).map((i) => toIngredient(i.name, `${i.amount ?? ''} ${i.unit ?? ''}`.trim()));
    const steps = (r.analyzedInstructions ?? []).flatMap((a) => a.steps.map((s) => s.step.trim())).filter(Boolean);
    return {
      id: String(r.id),
      name: r.title,
      thumb: r.image ?? null,
      category: r.dishTypes?.[0] ?? null,
      area: r.cuisines?.[0] ?? null,
      source: r.sourceUrl ?? null,
      recipe: recipeOf(
        `spoon_${r.id}`,
        r.title,
        r.readyInMinutes ?? 30,
        r.servings ?? 4,
        [...(r.dishTypes ?? []), ...(r.cuisines ?? [])],
        ings,
        steps.length ? steps : toSteps((r.instructions ?? '').replace(/<[^>]+>/g, '\n')),
      ),
    };
  }
  const e = hit.edamam;
  if (!e) return null;
  const ings = (e.ingredients ?? []).filter((i) => !BASICS.test(i.food)).map((i) => toIngredient(i.food, i.text.replace(new RegExp(i.food, 'i'), '').trim()));
  return {
    id: raw,
    name: e.label,
    thumb: e.image ?? null,
    category: e.dishType?.[0] ?? null,
    area: e.cuisineType?.[0] ?? null,
    source: e.url ?? null,
    recipe: recipeOf(
      `edamam_${raw.slice(0, 24)}`,
      e.label,
      e.totalTime && e.totalTime > 0 ? e.totalTime : 30,
      e.yield && e.yield > 0 ? Math.round(e.yield) : 4,
      [...(e.dishType ?? []), ...(e.cuisineType ?? [])],
      ings,
      [`Edamam shares the ingredients; the steps are on ${e.source ?? 'the original site'}${e.url ? `: ${e.url}` : ''}.`],
    ),
  };
}
