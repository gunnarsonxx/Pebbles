// Meals from what's already in your kitchen. Built-in recipes lean quick, air fryer and meal prep
// friendly (good for coming home after a night shift); you can add your own.
import { stockOf } from './pantry';
import type { MealPlanEntry, PantryItem, Recipe, RecipeIngredient } from './types';

const I = (name: string, match: string[], extra: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ name, match, ...extra });
const opt = (name: string, match: string[], extra: Partial<RecipeIngredient> = {}) => I(name, match, { ...extra, optional: true });

// shared ingredient patterns
const CHICKEN = I('Chicken', ['chicken breast', 'chicken thigh', 'chicken tender', 'rotisserie', 'chicken'], { not: ['popcorn', 'nugget', 'soup', 'broth', 'ramen', 'noodle', 'wing', 'patty', 'stock'] });
const BEEF = I('Ground beef or turkey', ['ground beef', 'ground turkey', 'hamburger', 'ground chuck'], { qty: '1 lb' });
const RICE = I('Rice', ['rice'], { not: ['krispie', 'cake', 'a roni', 'roni'] });
const EGGS = I('Eggs', ['egg'], { not: ['egg roll', 'eggplant', 'egg noodle', 'nog'] });
const TORTILLAS = I('Tortillas', ['tortilla'], { not: ['chip'] });
const CHEESE = I('Shredded cheese', ['cheese', 'cheddar', 'mozzarella', 'colby', 'pepper jack', 'mexican blend'], { not: ['mac', 'cream cheese', 'cheez', 'stick', 'cheesecake', 'puff'] });
const VEG = I('Veggies (frozen is great)', ['broccoli', 'mixed vegetable', 'frozen vegetable', 'stir fry', 'green bean', 'peas', 'carrot', 'spinach', 'pepper', 'corn', 'veggie'], { not: ['chip', 'dr pepper', 'pepperoni', 'corn dog', 'popcorn', 'cornbread', 'bell pepper flakes'] });
const BREAD = I('Bread', ['bread', 'texas toast', 'sourdough'], { not: ['crumb', 'stick'] });
const PASTA = I('Pasta', ['pasta', 'spaghetti', 'penne', 'rotini', 'macaroni', 'fettuccine', 'elbow', 'noodle'], { not: ['ramen', 'mac and cheese', 'mac & cheese', 'kraft dinner', 'cup'] });
const BEANS = I('Beans', ['black bean', 'pinto', 'refried', 'kidney bean', 'beans'], { not: ['green bean', 'jelly bean', 'coffee'] });
const SALSA = I('Salsa', ['salsa', 'pico'], {});
const AIR_FRYER = I('Something frozen for the air fryer', ['pizza roll', 'popcorn chicken', 'nugget', 'chicken tender', 'chicken strip', 'tater tot', 'fries', 'egg roll', 'taquito', 'mozzarella stick', 'corn dog', 'hot pocket', 'wings', 'fish stick', 'bagel bite', 'pizza bite', 'popper', 'onion ring', 'potsticker', 'pot sticker', 'dumpling', 'chimichanga']);

export const BUILT_IN_RECIPES: Recipe[] = [
  {
    id: 'air-fryer-plate',
    name: 'Air Fryer Plate',
    minutes: 15,
    servings: 1,
    tags: ['air fryer', 'quick'],
    ingredients: [AIR_FRYER, opt('A veggie or fruit on the side', ['broccoli', 'carrot', 'green bean', 'apple', 'banana', 'grape', 'salad', 'baby carrot', 'cucumber']), opt('Dipping sauce', ['ranch', 'ketchup', 'bbq', 'honey mustard', 'sweet and sour', 'buffalo'])],
    steps: ['Air fry at 380–400°F for 8–12 minutes, shaking the basket halfway.', 'Microwave or steam a veggie, or slice some fruit, while it cooks.', 'Plate it with a dip. Done.'],
  },
  {
    id: 'chicken-rice-bowls',
    name: 'Chicken & Rice Bowls',
    minutes: 35,
    servings: 4,
    tags: ['meal prep'],
    ingredients: [CHICKEN, RICE, VEG, opt('Sauce (teriyaki, soy, BBQ…)', ['teriyaki', 'soy sauce', 'bbq', 'sweet chili', 'stir fry sauce', 'orange sauce'])],
    steps: ['Cook 2 cups of rice.', 'Season the chicken (salt, pepper, garlic powder) and air fry at 380°F for 18–22 minutes or pan cook until 165°F inside.', 'Steam or roast the veggies.', 'Slice the chicken and split everything into 4 containers with sauce. Keeps 4 days in the fridge.'],
  },
  {
    id: 'taco-bowls',
    name: 'Ground Beef Taco Bowls',
    minutes: 25,
    servings: 4,
    tags: ['meal prep'],
    ingredients: [BEEF, RICE, opt('Beans', BEANS.match, { not: BEANS.not }), CHEESE, opt('Salsa', SALSA.match), opt('Taco seasoning', ['taco seasoning', 'taco mix'])],
    steps: ['Cook the rice.', 'Brown the beef, drain, and add taco seasoning with a splash of water.', 'Warm the beans.', 'Split rice, beef and beans into 4 containers; top with cheese and salsa when you eat.'],
  },
  {
    id: 'breakfast-burritos',
    name: 'Freezer Breakfast Burritos',
    minutes: 35,
    servings: 8,
    tags: ['meal prep', 'freezer', 'breakfast'],
    ingredients: [EGGS, TORTILLAS, CHEESE, opt('Sausage or bacon', ['sausage', 'bacon', 'chorizo', 'ham']), opt('Potatoes or tots', ['potato', 'hash brown', 'tater tot'])],
    steps: ['Cook the sausage or bacon and the potatoes.', 'Scramble 10–12 eggs soft.', 'Fill 8 tortillas with eggs, meat, potatoes and cheese; roll tight.', 'Wrap each in foil and freeze. Reheat: 2 minutes in the microwave, or 10 minutes in the air fryer at 350°F.'],
  },
  {
    id: 'egg-fried-rice',
    name: 'Egg Fried Rice',
    minutes: 15,
    servings: 2,
    tags: ['quick', 'one pan'],
    ingredients: [RICE, EGGS, VEG, opt('Soy sauce', ['soy sauce', 'teriyaki']), opt('Leftover meat', ['ham', 'chicken', 'spam', 'bacon', 'sausage'])],
    steps: ['Day-old rice works best (or cook it and spread it out to cool).', 'Scramble 2 eggs in a hot oiled pan and set aside.', 'Fry the rice and veggies for 5 minutes, add soy sauce, then stir the eggs back in.'],
  },
  {
    id: 'pasta-meat-sauce',
    name: 'Pasta with Meat Sauce',
    minutes: 25,
    servings: 4,
    tags: ['meal prep', 'one pot'],
    ingredients: [PASTA, BEEF, I('Pasta sauce', ['pasta sauce', 'marinara', 'spaghetti sauce', 'ragu', 'prego', 'tomato sauce']), opt('Parmesan', ['parmesan'])],
    steps: ['Boil the pasta.', 'Brown the beef, drain, and stir in the sauce. Simmer 10 minutes.', 'Toss with the pasta. Portions keep 4 days or freeze well.'],
  },
  {
    id: 'quesadillas',
    name: 'Quesadillas',
    minutes: 10,
    servings: 2,
    tags: ['quick'],
    ingredients: [TORTILLAS, CHEESE, opt('Chicken or beef', [...CHICKEN.match, ...BEEF.match], { not: CHICKEN.not }), opt('Salsa or sour cream', ['salsa', 'sour cream', 'pico'])],
    steps: ['Fill half a tortilla with cheese (and meat), fold it.', 'Cook in a dry pan 2–3 minutes a side, or air fry at 375°F for 5 minutes.', 'Cut and dip.'],
  },
  {
    id: 'grilled-cheese-soup',
    name: 'Grilled Cheese & Tomato Soup',
    minutes: 15,
    servings: 1,
    tags: ['quick'],
    ingredients: [BREAD, I('Sliced cheese', ['cheese', 'american', 'cheddar'], { not: ['mac', 'cream cheese', 'cheez', 'stick', 'puff'] }), I('Butter', ['butter'], { not: ['peanut', 'popcorn'] }), opt('Tomato soup', ['tomato soup'])],
    steps: ['Butter the outside of two slices, cheese in the middle.', 'Cook on medium 3 minutes a side until golden.', 'Heat the soup and dunk.'],
  },
  {
    id: 'ramen-upgrade',
    name: 'Upgraded Ramen',
    minutes: 10,
    servings: 1,
    tags: ['quick'],
    ingredients: [I('Ramen', ['ramen', 'instant noodle', 'cup noodle', 'maruchan', 'top ramen']), opt('Egg', EGGS.match, { not: EGGS.not }), opt('Frozen veggies', VEG.match, { not: VEG.not }), opt('Leftover meat', ['chicken', 'ham', 'pork'])],
    steps: ['Boil the noodles with the veggies.', 'Crack an egg in for the last 2 minutes (or add a soft-boiled one).', 'Stir in half the seasoning packet and any leftover meat.'],
  },
  {
    id: 'chili',
    name: 'Easy Chili',
    minutes: 40,
    servings: 6,
    tags: ['meal prep', 'freezer', 'one pot'],
    ingredients: [BEEF, BEANS, I('Canned tomatoes', ['diced tomato', 'crushed tomato', 'tomato sauce', 'rotel']), opt('Chili seasoning', ['chili seasoning', 'chili powder', 'chili mix']), opt('Onion', ['onion'], { not: ['ring', 'powder'] }), opt('Cheese for the top', CHEESE.match, { not: CHEESE.not })],
    steps: ['Brown the beef (and onion), drain.', 'Add beans, tomatoes and seasoning with a cup of water.', 'Simmer 25 minutes. Portion and freeze half.'],
  },
  {
    id: 'sheet-pan-sausage',
    name: 'Sheet Pan Sausage & Veggies',
    minutes: 30,
    servings: 3,
    tags: ['meal prep', 'one pan'],
    ingredients: [I('Smoked sausage', ['sausage', 'kielbasa', 'bratwurst', 'brat']), I('Potatoes', ['potato'], { not: ['chip', 'sweet potato fries'] }), VEG],
    steps: ['Heat the oven to 425°F.', 'Cut everything bite size, toss with oil, salt, pepper and garlic powder.', 'Roast 25 minutes, flipping once. Or air fry in two batches at 400°F for 15 minutes.'],
  },
  {
    id: 'air-fryer-chicken',
    name: 'Air Fryer Chicken & Rice',
    minutes: 30,
    servings: 2,
    tags: ['air fryer', 'meal prep'],
    ingredients: [CHICKEN, RICE, opt('Veggies', VEG.match, { not: VEG.not })],
    steps: ['Cook the rice.', 'Season the chicken and air fry at 380°F: breasts 18–22 minutes, thighs 20–24, flipping once.', 'Let it rest 5 minutes, slice, and serve over rice with veggies.'],
  },
  {
    id: 'mac-hot-dogs',
    name: 'Mac & Cheese with Hot Dogs',
    minutes: 15,
    servings: 2,
    tags: ['quick', 'one pot'],
    ingredients: [I('Mac and cheese', ['mac and cheese', 'mac & cheese', 'macaroni and cheese', 'kraft dinner', 'velveeta shells']), opt('Hot dogs', ['hot dog', 'frank', 'wiener']), opt('Milk and butter', ['milk', 'butter'], { not: ['peanut', 'chocolate milk'] })],
    steps: ['Make the mac and cheese per the box.', 'Slice the hot dogs and brown them in a pan, or air fry at 380°F for 5 minutes.', 'Stir together.'],
  },
  {
    id: 'tuna-melt',
    name: 'Tuna Melts',
    minutes: 12,
    servings: 2,
    tags: ['quick'],
    ingredients: [I('Tuna', ['tuna']), I('Mayo', ['mayo', 'mayonnaise', 'miracle whip']), BREAD, opt('Cheese', ['cheese'], { not: ['mac', 'cream cheese', 'cheez'] })],
    steps: ['Mix the tuna with mayo, salt and pepper.', 'Pile on bread, top with cheese.', 'Air fry at 370°F for 5 minutes or broil until melty.'],
  },
  {
    id: 'overnight-oats',
    name: 'Overnight Oats',
    minutes: 5,
    servings: 4,
    tags: ['meal prep', 'breakfast', 'no cook'],
    ingredients: [I('Oats', ['oats', 'oatmeal'], { not: ['cookie', 'bar'] }), I('Milk', ['milk'], { not: ['chocolate'] }), opt('Yogurt', ['yogurt']), opt('Fruit', ['banana', 'berr', 'strawberr', 'blueberr', 'apple']), opt('Peanut butter or honey', ['peanut butter', 'honey'])],
    steps: ['In 4 jars: ½ cup oats, ½ cup milk, a spoon of yogurt and a little honey or peanut butter.', 'Top with fruit, lid on, fridge overnight.', 'Grab one on the way out. Keeps 4 days.'],
  },
  {
    id: 'pb-sandwich',
    name: 'PB&J or PB Banana',
    minutes: 3,
    servings: 1,
    tags: ['quick', 'no cook'],
    ingredients: [BREAD, I('Peanut butter', ['peanut butter', 'pb ']), opt('Jelly or banana', ['jelly', 'jam', 'preserves', 'banana'])],
    steps: ['Spread, stack, eat. Toast the bread first if you want it warm.'],
  },
  {
    id: 'loaded-potatoes',
    name: 'Loaded Baked Potatoes',
    minutes: 45,
    servings: 4,
    tags: ['air fryer'],
    ingredients: [I('Potatoes', ['potato'], { not: ['chip', 'tot', 'fries', 'hash brown'] }), CHEESE, opt('Sour cream', ['sour cream']), opt('Bacon bits or bacon', ['bacon']), opt('Broccoli', ['broccoli'])],
    steps: ['Poke the potatoes, rub with oil and salt.', 'Air fry at 400°F for 35–40 minutes (or microwave 8–10 minutes, then air fry 5 to crisp).', 'Split and load them up.'],
  },
  {
    id: 'chicken-alfredo',
    name: 'Chicken Alfredo',
    minutes: 25,
    servings: 4,
    tags: ['meal prep'],
    ingredients: [PASTA, CHICKEN, I('Alfredo sauce', ['alfredo']), opt('Broccoli', ['broccoli'])],
    steps: ['Boil the pasta (add broccoli for the last 3 minutes).', 'Cook and slice the chicken.', 'Warm the sauce and toss it all together.'],
  },
  {
    id: 'burrito-bowls',
    name: 'Chicken Burrito Bowls',
    minutes: 35,
    servings: 4,
    tags: ['meal prep'],
    ingredients: [CHICKEN, RICE, BEANS, opt('Salsa', SALSA.match), opt('Cheese', CHEESE.match, { not: CHEESE.not }), opt('Corn', ['corn'], { not: ['chip', 'dog', 'bread', 'popcorn', 'starch'] })],
    steps: ['Cook the rice.', 'Season the chicken with taco seasoning or chili powder and cook it.', 'Warm the beans and corn.', 'Build 4 bowls; add salsa and cheese when you eat.'],
  },
  {
    id: 'eggs-toast',
    name: 'Scrambled Eggs & Toast',
    minutes: 8,
    servings: 1,
    tags: ['quick', 'breakfast'],
    ingredients: [EGGS, BREAD, opt('Butter', ['butter'], { not: ['peanut'] }), opt('Cheese', ['cheese'], { not: ['mac', 'cream cheese', 'cheez'] })],
    steps: ['Whisk 2–3 eggs with a pinch of salt.', 'Cook low and slow in butter, stirring, until just set (add cheese at the end).', 'Toast and eat.'],
  },
  {
    id: 'pancakes',
    name: 'Pancakes',
    minutes: 20,
    servings: 3,
    tags: ['breakfast', 'freezer'],
    ingredients: [I('Pancake mix', ['pancake', 'bisquick', 'waffle mix'], { not: ['syrup', 'frozen'] }), opt('Eggs', EGGS.match, { not: EGGS.not }), opt('Milk', ['milk'], { not: ['chocolate'] }), opt('Syrup', ['syrup'])],
    steps: ['Mix per the box.', 'Cook on a medium pan until bubbles pop, then flip.', 'Freeze extras flat; toast them to reheat.'],
  },
  {
    id: 'teriyaki-chicken',
    name: 'Teriyaki Chicken & Broccoli',
    minutes: 25,
    servings: 3,
    tags: ['meal prep', 'one pan'],
    ingredients: [CHICKEN, I('Teriyaki sauce', ['teriyaki']), I('Broccoli', ['broccoli']), opt('Rice', RICE.match, { not: RICE.not })],
    steps: ['Cut the chicken bite size and brown it in a hot pan.', 'Add the broccoli and a splash of water, cover 3 minutes.', 'Stir in teriyaki and simmer 2 minutes. Serve over rice.'],
  },
  {
    id: 'cheesy-beef-pasta',
    name: 'Cheesy Beef Pasta (Homemade Helper)',
    minutes: 25,
    servings: 4,
    tags: ['one pot', 'meal prep'],
    ingredients: [BEEF, PASTA, I('Milk', ['milk'], { not: ['chocolate'] }), CHEESE],
    steps: ['Brown the beef and drain.', 'Add 2 cups pasta, 1½ cups milk, 1½ cups water, salt, pepper and garlic powder.', 'Simmer covered 12 minutes, stirring, until the pasta is tender.', 'Stir in a big handful of cheese.'],
  },
  {
    id: 'sloppy-joes',
    name: 'Sloppy Joes',
    minutes: 20,
    servings: 4,
    tags: ['quick', 'one pan'],
    ingredients: [BEEF, I('Buns', ['bun', 'roll', 'hawaiian'], { not: ['egg roll', 'pizza roll', 'cinnamon'] }), I('Sloppy joe sauce or ketchup', ['sloppy joe', 'manwich', 'ketchup', 'bbq'])],
    steps: ['Brown the beef and drain.', 'Stir in the sauce (or ketchup with a little mustard and brown sugar) and simmer 5 minutes.', 'Pile on toasted buns.'],
  },
  {
    id: 'frozen-pizza',
    name: 'Frozen Pizza Night',
    minutes: 20,
    servings: 2,
    tags: ['quick'],
    ingredients: [I('Frozen pizza', ['frozen pizza', 'digiorno', 'totino', 'red baron', 'tombstone', 'jack', 'pizza'], { not: ['roll', 'bite', 'sauce', 'pocket'] }), opt('Salad or veggie', ['salad', 'lettuce', 'broccoli', 'carrot'])],
    steps: ['Bake per the box (or cut in quarters and air fry at 375°F for 6–8 minutes).', 'Bagged salad on the side if you have it.'],
  },
  {
    id: 'chicken-wraps',
    name: 'Chicken Caesar Wraps',
    minutes: 10,
    servings: 2,
    tags: ['quick', 'no cook'],
    ingredients: [CHICKEN, TORTILLAS, I('Lettuce or salad kit', ['lettuce', 'romaine', 'salad']), opt('Caesar or ranch dressing', ['caesar', 'ranch', 'dressing']), opt('Parmesan', ['parmesan'])],
    steps: ['Use leftover, rotisserie, or air fried chicken.', 'Toss lettuce with dressing and parmesan.', 'Wrap it all up tight. Cut in half.'],
  },
  {
    id: 'yogurt-parfait',
    name: 'Yogurt Parfait',
    minutes: 3,
    servings: 1,
    tags: ['quick', 'no cook', 'breakfast'],
    ingredients: [I('Yogurt', ['yogurt']), opt('Granola', ['granola']), opt('Fruit', ['berr', 'banana', 'strawberr', 'blueberr', 'peach'])],
    steps: ['Layer yogurt, fruit and granola.'],
  },
  {
    id: 'nachos',
    name: 'Loaded Nachos',
    minutes: 15,
    servings: 2,
    tags: ['quick', 'air fryer'],
    ingredients: [I('Tortilla chips', ['tortilla chip', 'chips'], { not: ['potato chip', 'chocolate chip', 'pita'] }), CHEESE, opt('Beef or beans', [...BEEF.match, ...BEANS.match], { not: BEANS.not }), opt('Salsa', SALSA.match), opt('Sour cream', ['sour cream'])],
    steps: ['Spread chips on a sheet pan or in the air fryer basket.', 'Top with cheese and warm beef or beans.', 'Bake at 400°F for 6 minutes (air fryer: 350°F for 4). Add salsa and sour cream.'],
  },
];

/** Things everyone has, never required: salt, pepper, oil, water, spices. */
export const BASICS_NOTE = 'Assumes you have salt, pepper, oil and basic spices.';

const lc = (s: string) => s.toLowerCase();

/** The pantry item that covers an ingredient (and isn't out), if any. */
export function haveFor(ing: RecipeIngredient, pantry: PantryItem[]): PantryItem | null {
  return (
    pantry.find((p) => {
      if (p.archived || stockOf(p) === 'out') return false;
      const n = ` ${lc(p.name)} `;
      return ing.match.some((m) => n.includes(lc(m))) && !(ing.not ?? []).some((x) => n.includes(lc(x)));
    }) ?? null
  );
}

export interface RecipeMatch {
  recipe: Recipe;
  have: { ing: RecipeIngredient; item: PantryItem }[];
  missing: RecipeIngredient[]; // required ones you don't have
  extras: RecipeIngredient[]; // optional ones you don't have
  ready: boolean;
  score: number; // for sorting: ready first, then fewer missing, then more of the optional
}

export function matchRecipe(recipe: Recipe, pantry: PantryItem[]): RecipeMatch {
  const have: RecipeMatch['have'] = [];
  const missing: RecipeIngredient[] = [];
  const extras: RecipeIngredient[] = [];
  for (const ing of recipe.ingredients) {
    const item = haveFor(ing, pantry);
    if (item) have.push({ ing, item });
    else (ing.optional ? extras : missing).push(ing);
  }
  const required = recipe.ingredients.filter((i) => !i.optional).length || 1;
  const ready = missing.length === 0;
  const score = (ready ? 100 : 0) - missing.length * 20 + (have.length / recipe.ingredients.length) * 10 + (1 - missing.length / required) * 5;
  return { recipe, have, missing, extras, ready, score };
}

export function allRecipes(custom: Recipe[]): Recipe[] {
  const hidden = new Set(custom.filter((r) => r.hidden).map((r) => r.id));
  const mine = custom.filter((r) => r.custom && !r.hidden);
  return [...mine, ...BUILT_IN_RECIPES.filter((r) => !hidden.has(r.id))];
}

/** What you can cook now, and what's one or two items away. */
export function whatCanIMake(recipes: Recipe[], pantry: PantryItem[]): { ready: RecipeMatch[]; almost: RecipeMatch[] } {
  const all = recipes.map((r) => matchRecipe(r, pantry)).sort((a, b) => b.score - a.score || a.recipe.minutes - b.recipe.minutes);
  return { ready: all.filter((m) => m.ready), almost: all.filter((m) => !m.ready && m.missing.length <= 2 && m.have.length > 0) };
}

/** Meal prep: everything the plan still needs to buy, combined. */
export function prepShopping(plan: MealPlanEntry[], recipes: Recipe[], pantry: PantryItem[]): { name: string; for: string[] }[] {
  const need = new Map<string, string[]>();
  for (const e of plan) {
    if (e.cookedAt) continue;
    const r = recipes.find((x) => x.id === e.id);
    if (!r) continue;
    for (const ing of matchRecipe(r, pantry).missing) need.set(ing.name, [...(need.get(ing.name) ?? []), r.name]);
  }
  return [...need.entries()].map(([name, f]) => ({ name, for: f }));
}

/** Cooking uses things up: level items drop a step, counted items lose one serving's worth. */
export function usedUp(m: RecipeMatch): PantryItem[] {
  const out = new Map<string, PantryItem>();
  for (const { item } of m.have) {
    const p = out.get(item.id) ?? item;
    if (p.mode === 'level') out.set(p.id, { ...p, level: p.level === 'full' ? 'half' : p.level === 'half' ? 'low' : 'out' });
    else out.set(p.id, { ...p, qty: Math.max(0, Math.round((p.qty - (p.mode === 'count' ? 1 : p.perBuy * 0.25)) * 100) / 100) });
  }
  return [...out.values()];
}

/** Your own recipe from plain text: one ingredient per line ("optional" or "(opt)" to mark extras). */
export function parseIngredients(text: string): RecipeIngredient[] {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .map((l) => {
      const optional = /\b(optional|opt\.?)\b|\(opt\)/i.test(l);
      const name = l.replace(/\(?\b(optional|opt\.?)\)?/gi, '').replace(/^[\d½¼¾/.\s]+(cups?|tbsp|tsp|lbs?|oz|cans?|g)?\s+/i, '').trim();
      const key = lc(name).replace(/s\b/g, '').trim();
      return { name: l.replace(/\(?\b(optional|opt\.?)\)?/gi, '').trim(), match: key ? [key] : [], optional };
    });
}
