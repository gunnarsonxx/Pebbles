// Meals from what's already in your kitchen. Built-in recipes lean quick, air fryer and meal prep
// friendly (good for coming home after a night shift); you can add your own.
import { stockOf } from './pantry';
import type { MealPlanEntry, PantryItem, Recipe, RecipeIngredient } from './types';

const I = (name: string, match: string[], extra: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ name, match, ...extra });
const opt = (name: string, match: string[], extra: Partial<RecipeIngredient> = {}) => I(name, match, { ...extra, optional: true });

// shared ingredient patterns
const CHICKEN = I('Chicken', ['chicken breast', 'chicken thigh', 'chicken tender', 'rotisserie', 'chicken'], { not: ['popcorn', 'nugget', 'soup', 'broth', 'ramen', 'noodle', 'wing', 'patty', 'stock', 'breaded', 'chunks', 'tender', 'strip', 'fried'] });
const BEEF = I('Ground beef or turkey', ['ground beef', 'ground turkey', 'hamburger', 'ground chuck'], { qty: '1 lb' });
const RICE = I('Rice', ['rice'], { not: ['krispie', 'cake', 'a roni', 'roni'] });
const EGGS = I('Eggs', ['egg'], { not: ['egg roll', 'eggplant', 'egg noodle', 'nog'] });
const TORTILLAS = I('Tortillas', ['tortilla'], { not: ['chip'] });
const CHEESE = I('Shredded cheese', ['cheese', 'cheddar', 'mozzarella', 'colby', 'pepper jack', 'mexican blend'], { not: ['mac', 'cream cheese', 'cheez', 'stick', 'cheesecake', 'puff'] });
const VEG = I('Veggies (frozen is great)', ['broccoli', 'mixed vegetable', 'frozen vegetable', 'stir fry', 'green bean', 'peas', 'carrot', 'spinach', 'pepper', 'corn', 'veggie'], { not: ['chip', 'dr pepper', 'pepperoni', 'corn dog', 'popcorn', 'cornbread', 'bell pepper flakes'] });
const BREAD = I('Bread', ['bread', 'texas toast', 'sourdough'], { not: ['crumb', 'stick'] });
const MAYO = I('Mayo', ['mayo', 'mayonnaise', 'miracle whip']);
const PASTA = I('Pasta', ['pasta', 'spaghetti', 'penne', 'rotini', 'macaroni', 'fettuccine', 'elbow', 'noodle'], { not: ['ramen', 'mac and cheese', 'mac & cheese', 'kraft dinner', 'cup'] });
const BEANS = I('Beans', ['black bean', 'pinto', 'refried', 'kidney bean', 'beans'], { not: ['green bean', 'jelly bean', 'coffee'] });
const SALSA = I('Salsa', ['salsa', 'pico'], {});
const AIR_FRYER = I('Something frozen for the air fryer', ['pizza roll', 'popcorn chicken', 'nugget', 'chicken tender', 'chicken strip', 'tater tot', 'fries', 'egg roll', 'taquito', 'mozzarella stick', 'corn dog', 'hot pocket', 'wings', 'fish stick', 'bagel bite', 'pizza bite', 'popper', 'onion ring', 'potsticker', 'pot sticker', 'dumpling', 'chimichanga']);

const RECIPES: Recipe[] = [
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
  // ---------- more quick ones (15 minutes or less) ----------
  {
    id: 'blt',
    name: 'BLT Sandwiches',
    minutes: 15,
    servings: 2,
    tags: ['quick', 'lunch', 'sandwich', 'air fryer'],
    ingredients: [I('Bacon', ['bacon'], { not: ['bits'] }), BREAD, I('Lettuce', ['lettuce', 'romaine', 'salad']), opt('Tomato', ['tomato'], { not: ['sauce', 'paste', 'soup', 'diced', 'crushed'] }), opt('Mayo', MAYO.match)],
    steps: ['Air fry the bacon at 375°F for 8–10 minutes (or pan fry).', 'Toast the bread.', 'Mayo, lettuce, tomato, bacon. Cut corner to corner.'],
  },
  {
    id: 'turkey-wrap',
    name: 'Turkey & Cheese Wraps',
    minutes: 5,
    servings: 2,
    tags: ['quick', 'lunch', 'no cook'],
    ingredients: [I('Deli turkey or ham', ['deli turkey', 'deli ham', 'lunch meat', 'turkey breast', 'shaved', 'sliced turkey', 'sliced ham']), { ...TORTILLAS, uses: 2 }, opt('Cheese', CHEESE.match, { not: CHEESE.not }), opt('Lettuce', ['lettuce', 'spinach', 'salad']), opt('Ranch or mayo', ['ranch', 'mayo', 'mustard'])],
    steps: ['Lay out a tortilla, add meat, cheese and lettuce.', 'Add a stripe of ranch or mayo, roll tight, cut in half.'],
  },
  {
    id: 'breakfast-sandwich',
    name: 'Breakfast Sandwiches',
    minutes: 10,
    servings: 2,
    tags: ['quick', 'breakfast'],
    ingredients: [I('English muffins or bagels', ['english muffin', 'bagel', 'biscuit'], { uses: 2 }), { ...EGGS, uses: 2 }, opt('Cheese', ['cheese', 'american'], { not: ['cream cheese', 'mac'] }), opt('Sausage or bacon', ['sausage', 'bacon', 'ham'])],
    steps: ['Toast the muffins.', 'Fry the eggs (break the yolk if you want them neat) with cheese on top.', 'Warm the sausage or bacon and stack it all up.'],
  },
  {
    id: 'french-toast',
    name: 'French Toast',
    minutes: 15,
    servings: 2,
    tags: ['quick', 'breakfast'],
    ingredients: [BREAD, { ...EGGS, uses: 2 }, I('Milk', ['milk'], { not: ['chocolate'] }), opt('Syrup', ['syrup']), opt('Cinnamon', ['cinnamon'])],
    steps: ['Whisk 2 eggs, ½ cup milk and a pinch of cinnamon.', 'Dip each slice, cook in a buttered pan 2–3 minutes a side.', 'Syrup and eat.'],
  },
  {
    id: 'pizza-bagels',
    name: 'Pizza Bagels',
    minutes: 10,
    servings: 2,
    tags: ['quick', 'air fryer', 'snack'],
    ingredients: [I('Bagels or English muffins', ['bagel', 'english muffin'], { not: ['bite'], uses: 2 }), I('Pasta or pizza sauce', ['pizza sauce', 'pasta sauce', 'marinara']), I('Mozzarella', ['mozzarella', 'shredded cheese', 'italian blend', 'pizza blend']), opt('Pepperoni', ['pepperoni', 'salami'])],
    steps: ['Split the bagels, spoon on sauce, top with cheese and pepperoni.', 'Air fry at 360°F for 5–6 minutes (or bake at 400°F for 8).'],
  },
  {
    id: 'smoothie',
    name: 'Fruit Smoothie',
    minutes: 5,
    servings: 1,
    tags: ['quick', 'breakfast', 'no cook'],
    ingredients: [I('Frozen fruit or a banana', ['frozen fruit', 'frozen berr', 'frozen strawberr', 'frozen mango', 'banana', 'berr']), I('Yogurt or milk', ['yogurt', 'milk'], { not: ['chocolate'] }), opt('Peanut butter or honey', ['peanut butter', 'honey'])],
    steps: ['Blend a cup of fruit with a cup of yogurt or milk until smooth.', 'Too thick: a splash more milk. Too thin: more frozen fruit.'],
  },
  {
    id: 'hot-dogs-fries',
    name: 'Hot Dogs & Fries',
    minutes: 15,
    servings: 2,
    tags: ['quick', 'air fryer'],
    ingredients: [I('Hot dogs', ['hot dog', 'frank', 'wiener', 'bratwurst', 'brat'], { uses: 4 }), I('Buns', ['bun', 'hot dog bun', 'roll'], { not: ['egg roll', 'pizza roll', 'cinnamon'], uses: 4 }), opt('Fries or tots', ['fries', 'tater tot', 'tots']), opt('Ketchup and mustard', ['ketchup', 'mustard'])],
    steps: ['Air fry the fries at 400°F for 12 minutes, shaking halfway; add the hot dogs for the last 5.', 'Toast the buns for a minute. Load them up.'],
  },
  {
    id: 'doctored-soup',
    name: 'Better Canned Soup',
    minutes: 10,
    servings: 2,
    tags: ['quick', 'soup'],
    ingredients: [I('Canned soup', ['soup'], { not: ['cream of', 'mix', 'bowl'], uses: 1 }), opt('Leftover chicken or meat', ['chicken', 'rotisserie', 'ham', 'sausage'], { not: ['soup', 'broth', 'nugget', 'popcorn'] }), opt('Frozen veggies', VEG.match, { not: VEG.not }), opt('Crackers or bread', ['cracker', 'oyster', 'bread'])],
    steps: ['Heat the soup with a handful of frozen veggies and any leftover meat.', 'Season with pepper and garlic powder. Crackers on the side.'],
  },
  {
    id: 'egg-salad',
    name: 'Egg Salad Sandwiches',
    minutes: 15,
    servings: 2,
    tags: ['quick', 'lunch', 'sandwich'],
    ingredients: [{ ...EGGS, uses: 4 }, I('Mayo', MAYO.match), BREAD, opt('Mustard', ['mustard']), opt('Lettuce', ['lettuce'])],
    steps: ['Hard boil 4 eggs (10 minutes in boiling water), then cool in cold water.', 'Peel, mash with 3 tbsp mayo, a little mustard, salt and pepper.', 'On bread with lettuce.'],
  },
  {
    id: 'omelet',
    name: 'Cheese Omelet',
    minutes: 10,
    servings: 1,
    tags: ['quick', 'breakfast'],
    ingredients: [{ ...EGGS, uses: 3 }, opt('Cheese', ['cheese'], { not: ['cream cheese', 'mac'] }), opt('Ham, peppers or onion', ['ham', 'pepper', 'onion', 'spinach', 'mushroom'], { not: ['dr pepper', 'pepperoni', 'ring', 'powder'] })],
    steps: ['Whisk 3 eggs with salt. Pour into a hot buttered pan.', 'Pull the edges in as it sets; add fillings to one side.', 'Fold over, slide out.'],
  },
  {
    id: 'chicken-salad',
    name: 'Chicken Salad Sandwiches',
    minutes: 10,
    servings: 3,
    tags: ['quick', 'lunch', 'no cook', 'meal prep'],
    ingredients: [I('Cooked or canned chicken', ['canned chicken', 'chunk chicken', 'rotisserie', 'chicken breast', 'chicken'], { not: ['nugget', 'popcorn', 'soup', 'broth', 'ramen', 'breaded', 'chunks', 'tender', 'strip', 'fried'] }), I('Mayo', MAYO.match), I('Bread or croissants', ['bread', 'croissant', 'roll', 'tortilla'], { not: ['crumb', 'egg roll', 'pizza roll'] }), opt('Celery or grapes', ['celery', 'grape'])],
    steps: ['Chop or shred the chicken. Mix with mayo, salt, pepper (and chopped celery or grapes).', 'Pile on bread. Keeps 3 days in the fridge.'],
  },
  {
    id: 'snack-plate',
    name: 'Snack Plate',
    minutes: 5,
    servings: 1,
    tags: ['quick', 'snack', 'no cook'],
    ingredients: [I('Crackers or pita', ['cracker', 'pita', 'triscuit', 'ritz', 'wheat thin', 'pretzel']), opt('Cheese', ['cheese', 'string cheese'], { not: ['cream cheese', 'mac'] }), opt('Lunch meat or pepperoni', ['salami', 'pepperoni', 'deli', 'lunch meat']), opt('Hummus or dip', ['hummus', 'dip', 'ranch']), opt('Fruit or veggies', ['apple', 'grape', 'carrot', 'cucumber', 'celery', 'berr'])],
    steps: ['Slice whatever you have and arrange it on a plate. Dinner for one, done.'],
  },
  // ---------- weeknight dinners (20–45 minutes) ----------
  {
    id: 'beef-broccoli',
    name: 'Beef & Broccoli',
    minutes: 25,
    servings: 3,
    tags: ['dinner', 'one pan'],
    ingredients: [I('Steak or ground beef', ['steak', 'flank', 'sirloin', 'stir fry beef', 'ground beef']), I('Broccoli', ['broccoli']), I('Soy sauce', ['soy sauce', 'teriyaki']), opt('Rice', RICE.match, { not: RICE.not }), opt('Brown sugar or honey', ['brown sugar', 'honey'])],
    steps: ['Slice the beef thin against the grain.', 'Sear it in a very hot oiled pan, then set aside.', 'Cook the broccoli with a splash of water, covered, 3 minutes.', 'Add back the beef with ¼ cup soy sauce and 1 tbsp brown sugar; simmer 2 minutes. Over rice.'],
  },
  {
    id: 'stir-fry-noodles',
    name: 'Chicken Stir Fry Noodles',
    minutes: 25,
    servings: 3,
    tags: ['dinner', 'one pan'],
    ingredients: [CHICKEN, I('Noodles', ['lo mein', 'noodle', 'spaghetti', 'ramen', 'udon'], { not: ['egg noodle soup', 'cup'] }), VEG, I('Soy or stir fry sauce', ['soy sauce', 'stir fry sauce', 'teriyaki', 'hoisin', 'oyster sauce'])],
    steps: ['Boil the noodles and drain.', 'Brown bite-size chicken in a hot pan, add the veggies for 4 minutes.', 'Toss in the noodles and sauce until everything is coated.'],
  },
  {
    id: 'spaghetti-meatballs',
    name: 'Spaghetti & Meatballs',
    minutes: 20,
    servings: 4,
    tags: ['dinner', 'pasta'],
    ingredients: [PASTA, I('Frozen meatballs', ['meatball']), I('Pasta sauce', ['pasta sauce', 'marinara', 'spaghetti sauce', 'ragu', 'prego']), opt('Parmesan', ['parmesan'])],
    steps: ['Boil the pasta.', 'Simmer the frozen meatballs in the sauce, covered, 15 minutes.', 'Spoon over the pasta, parmesan on top.'],
  },
  {
    id: 'fajitas',
    name: 'Sheet Pan Chicken Fajitas',
    minutes: 30,
    servings: 4,
    tags: ['dinner', 'one pan'],
    ingredients: [CHICKEN, I('Bell peppers', ['bell pepper', 'pepper'], { not: ['dr pepper', 'pepperoni', 'flake', 'black pepper', 'jack'] }), I('Onion', ['onion'], { not: ['ring', 'powder'] }), { ...TORTILLAS, uses: 8 }, opt('Fajita or taco seasoning', ['fajita', 'taco seasoning']), opt('Sour cream or salsa', ['sour cream', 'salsa'])],
    steps: ['Heat the oven to 425°F.', 'Slice chicken, peppers and onion; toss with oil and seasoning on a sheet pan.', 'Roast 20 minutes. Fill warm tortillas.'],
  },
  {
    id: 'salmon-rice',
    name: 'Honey Garlic Salmon & Rice',
    minutes: 25,
    servings: 2,
    tags: ['dinner', 'air fryer'],
    ingredients: [I('Salmon', ['salmon'], { not: ['canned'] }), RICE, opt('Honey', ['honey']), opt('Soy sauce', ['soy sauce']), opt('Veggies', VEG.match, { not: VEG.not })],
    steps: ['Cook the rice.', 'Brush the salmon with 2 tbsp honey, 1 tbsp soy sauce and garlic powder.', 'Air fry at 390°F for 8–10 minutes (or bake at 400°F for 12).'],
  },
  {
    id: 'shrimp-scampi',
    name: 'Shrimp Scampi Pasta',
    minutes: 20,
    servings: 3,
    tags: ['dinner', 'pasta'],
    ingredients: [I('Shrimp', ['shrimp'], { not: ['ramen'] }), PASTA, I('Butter', ['butter'], { not: ['peanut'] }), opt('Lemon', ['lemon']), opt('Parmesan', ['parmesan'])],
    steps: ['Boil the pasta.', 'Melt 4 tbsp butter with garlic, add the shrimp and cook 2 minutes a side until pink.', 'Squeeze in lemon, toss with the pasta and some pasta water.'],
  },
  {
    id: 'pork-chops',
    name: 'Pork Chops & Potatoes',
    minutes: 35,
    servings: 2,
    tags: ['dinner', 'air fryer'],
    ingredients: [I('Pork chops', ['pork chop', 'pork loin', 'boneless pork'], { uses: 2 }), I('Potatoes', ['potato'], { not: ['chip', 'tot', 'fries', 'hash brown'], uses: 3 }), opt('Green beans or veggie', ['green bean', 'broccoli', 'corn', 'carrot'])],
    steps: ['Cube the potatoes, toss with oil and salt, air fry at 400°F for 15 minutes.', 'Season the chops and air fry at 380°F for 10–12 minutes, flipping once, until 145°F inside.', 'Rest 5 minutes and serve with a veggie.'],
  },
  {
    id: 'chicken-parm',
    name: 'Air Fryer Chicken Parmesan',
    minutes: 30,
    servings: 3,
    tags: ['dinner', 'air fryer', 'pasta'],
    ingredients: [I('Chicken breasts or breaded chicken', ['chicken breast', 'breaded chicken', 'chicken patty', 'chicken tender', 'chicken strip']), I('Pasta sauce', ['pasta sauce', 'marinara']), I('Mozzarella', ['mozzarella', 'italian blend']), opt('Pasta', PASTA.match, { not: PASTA.not }), opt('Breadcrumbs', ['breadcrumb', 'panko'])],
    steps: ['Coat chicken in egg and breadcrumbs (or use breaded chicken from the freezer).', 'Air fry at 380°F for 12–15 minutes.', 'Top with sauce and cheese, 2 more minutes. With pasta if you like.'],
  },
  {
    id: 'philly',
    name: 'Philly Cheesesteaks',
    minutes: 25,
    servings: 3,
    tags: ['dinner', 'sandwich'],
    ingredients: [I('Thin steak or roast beef', ['steak', 'shaved beef', 'roast beef', 'sirloin']), I('Hoagie rolls or buns', ['hoagie', 'sub roll', 'roll', 'bun'], { not: ['egg roll', 'pizza roll', 'cinnamon'], uses: 3 }), I('Provolone or American', ['provolone', 'american', 'cheese'], { not: ['cream cheese', 'mac'] }), opt('Onion and peppers', ['onion', 'pepper'], { not: ['ring', 'powder', 'dr pepper', 'pepperoni'] })],
    steps: ['Cook sliced onions and peppers until soft.', 'Add the thin-sliced beef, chop it up as it browns, season.', 'Lay cheese over it to melt, scoop into toasted rolls.'],
  },
  {
    id: 'burgers',
    name: 'Cheeseburgers',
    minutes: 20,
    servings: 4,
    tags: ['dinner', 'air fryer'],
    ingredients: [BEEF, I('Buns', ['bun', 'hamburger bun'], { not: ['hot dog', 'cinnamon'], uses: 4 }), I('Sliced cheese', ['american', 'cheese', 'cheddar'], { not: ['cream cheese', 'mac', 'shredded'] }), opt('Lettuce, tomato, onion', ['lettuce', 'tomato', 'onion'], { not: ['sauce', 'paste', 'soup', 'ring', 'powder'] }), opt('Ketchup and mustard', ['ketchup', 'mustard'])],
    steps: ['Shape 4 patties, press a thumbprint in the middle, season well.', 'Pan fry 4 minutes a side (or air fry at 370°F for 10), cheese on for the last minute.', 'Toast the buns and build them.'],
  },
  {
    id: 'breakfast-hash',
    name: 'Breakfast Hash',
    minutes: 30,
    servings: 3,
    tags: ['breakfast', 'one pan'],
    ingredients: [I('Potatoes or hash browns', ['potato', 'hash brown'], { not: ['chip'], uses: 3 }), I('Sausage or bacon', ['sausage', 'bacon', 'ham', 'chorizo']), { ...EGGS, uses: 3 }, opt('Onion and peppers', ['onion', 'pepper'], { not: ['ring', 'powder', 'dr pepper', 'pepperoni'] }), opt('Cheese', CHEESE.match, { not: CHEESE.not })],
    steps: ['Brown the sausage, then crisp the diced potatoes in the same pan (about 15 minutes).', 'Make wells and crack in the eggs; cover until set.', 'Cheese on top.'],
  },
  {
    id: 'pot-pie',
    name: 'Easy Chicken Pot Pie',
    minutes: 45,
    servings: 4,
    tags: ['dinner', 'baking'],
    ingredients: [CHICKEN, I('Cream of chicken soup', ['cream of chicken', 'cream of mushroom', 'cream of'], { uses: 1 }), I('Frozen mixed veggies', ['mixed vegetable', 'frozen vegetable', 'peas and carrots', 'veggie']), I('Crescent dough or pie crust', ['crescent', 'pie crust', 'biscuit dough', 'puff pastry'])],
    steps: ['Heat the oven to 375°F.', 'Mix cooked chopped chicken, the soup, frozen veggies and ½ cup milk in a baking dish.', 'Lay the dough over the top, cut a few slits, bake 25–30 minutes until golden.'],
  },
  {
    id: 'taco-soup',
    name: 'Taco Soup',
    minutes: 30,
    servings: 6,
    tags: ['dinner', 'soup', 'meal prep', 'freezer'],
    ingredients: [BEEF, BEANS, I('Canned tomatoes', ['diced tomato', 'rotel', 'crushed tomato']), opt('Corn', ['corn'], { not: ['chip', 'dog', 'bread', 'popcorn', 'starch'] }), opt('Taco seasoning', ['taco seasoning']), opt('Chips and cheese for topping', ['tortilla chip', 'cheese'], { not: ['cream cheese', 'mac'] })],
    steps: ['Brown the beef and drain.', 'Add beans, tomatoes, corn, taco seasoning and 2 cups water.', 'Simmer 20 minutes. Top with cheese and crushed chips.'],
  },
  {
    id: 'tuna-pasta-salad',
    name: 'Tuna Pasta Salad',
    minutes: 20,
    servings: 4,
    tags: ['lunch', 'meal prep', 'pasta'],
    ingredients: [PASTA, I('Tuna', ['tuna'], { uses: 2 }), I('Mayo', MAYO.match), opt('Peas or celery', ['peas', 'celery']), opt('Shredded cheese', CHEESE.match, { not: CHEESE.not })],
    steps: ['Cook the pasta, rinse it cold.', 'Mix with drained tuna, mayo, peas, salt and pepper.', 'Chill. Lunches for days.'],
  },
  {
    id: 'egg-muffins',
    name: 'Egg Muffins',
    minutes: 25,
    servings: 6,
    tags: ['breakfast', 'meal prep', 'freezer'],
    ingredients: [{ ...EGGS, uses: 10 }, opt('Cheese', CHEESE.match, { not: CHEESE.not }), opt('Ham, sausage or bacon', ['ham', 'sausage', 'bacon']), opt('Spinach or peppers', ['spinach', 'pepper', 'onion'], { not: ['dr pepper', 'pepperoni', 'ring', 'powder'] })],
    steps: ['Heat the oven to 350°F and grease a 12-cup muffin pan.', 'Whisk 10 eggs with salt, pour into the cups over the fillings.', 'Bake 20 minutes. Fridge 5 days or freeze; microwave 45 seconds.'],
  },
  {
    id: 'teriyaki-bowls',
    name: 'Teriyaki Salmon Bowls',
    minutes: 25,
    servings: 3,
    tags: ['dinner', 'meal prep', 'air fryer'],
    ingredients: [I('Salmon', ['salmon'], { not: ['canned'] }), RICE, I('Teriyaki sauce', ['teriyaki']), opt('Edamame or broccoli', ['edamame', 'broccoli', 'cucumber'])],
    steps: ['Cook the rice.', 'Air fry the salmon at 390°F for 8–10 minutes, brushing with teriyaki at the end.', 'Build bowls with rice, salmon and veggies.'],
  },
  {
    id: 'quesadilla-pizza',
    name: 'Pizza Quesadillas',
    minutes: 10,
    servings: 2,
    tags: ['quick', 'air fryer'],
    ingredients: [{ ...TORTILLAS, uses: 2 }, I('Mozzarella', ['mozzarella', 'cheese'], { not: ['cream cheese', 'mac'] }), opt('Pepperoni', ['pepperoni']), opt('Pizza sauce for dipping', ['pizza sauce', 'pasta sauce', 'marinara'])],
    steps: ['Fill tortillas with cheese and pepperoni, fold.', 'Air fry at 375°F for 5 minutes or crisp in a pan. Dip in warm sauce.'],
  },
  // ---------- slow cooker and weekend cooking (an hour or more, mostly hands-off) ----------
  {
    id: 'pulled-pork',
    name: 'Slow Cooker Pulled Pork',
    minutes: 480,
    servings: 8,
    tags: ['slow cooker', 'meal prep', 'freezer', 'dinner'],
    ingredients: [I('Pork shoulder or butt', ['pork shoulder', 'pork butt', 'pork roast', 'boston butt']), I('BBQ sauce', ['bbq', 'barbecue']), opt('Buns', ['bun', 'roll'], { not: ['egg roll', 'pizza roll', 'cinnamon'] }), opt('Coleslaw', ['coleslaw', 'slaw'])],
    steps: ['Rub the pork with salt, pepper, garlic powder and brown sugar.', 'Slow cook on low 8 hours with ½ cup water.', 'Shred with two forks, stir in BBQ sauce. On buns; freezes great.'],
  },
  {
    id: 'slow-chicken-tacos',
    name: 'Slow Cooker Salsa Chicken Tacos',
    minutes: 240,
    servings: 6,
    tags: ['slow cooker', 'meal prep', 'dinner'],
    ingredients: [I('Chicken breasts or thighs', ['chicken breast', 'chicken thigh'], { not: ['nugget', 'popcorn', 'breaded'] }), I('Salsa', ['salsa']), opt('Taco seasoning', ['taco seasoning']), opt('Tortillas', ['tortilla'], { not: ['chip'] }), opt('Cheese and sour cream', ['cheese', 'sour cream'], { not: ['cream cheese', 'mac'] })],
    steps: ['Put the chicken in the slow cooker, sprinkle with taco seasoning, pour a jar of salsa over.', 'Cook on low 4–6 hours (high 3).', 'Shred in the juices. Tacos, bowls or nachos all week.'],
  },
  {
    id: 'pot-roast',
    name: 'Pot Roast',
    minutes: 480,
    servings: 6,
    tags: ['slow cooker', 'dinner'],
    ingredients: [I('Beef roast (chuck)', ['chuck roast', 'beef roast', 'pot roast', 'rump roast']), I('Potatoes', ['potato'], { not: ['chip', 'tot', 'fries', 'hash brown'], uses: 4 }), I('Carrots', ['carrot']), opt('Onion', ['onion'], { not: ['ring', 'powder', 'soup mix'] }), opt('Beef broth or onion soup mix', ['beef broth', 'onion soup', 'beef stock'])],
    steps: ['Season the roast and brown it on all sides (optional but tastier).', 'Potatoes and carrots in the slow cooker, roast on top, 1 cup broth.', 'Low 8 hours until it falls apart.'],
  },
  {
    id: 'beef-stew',
    name: 'Beef Stew',
    minutes: 150,
    servings: 6,
    tags: ['soup', 'dinner', 'freezer'],
    ingredients: [I('Stew meat', ['stew meat', 'beef chuck', 'chuck roast']), I('Potatoes', ['potato'], { not: ['chip', 'tot', 'fries'], uses: 3 }), I('Carrots', ['carrot']), I('Beef broth', ['beef broth', 'beef stock', 'bouillon']), opt('Onion', ['onion'], { not: ['ring', 'powder'] }), opt('Tomato paste', ['tomato paste'])],
    steps: ['Brown the beef in batches in a big pot.', 'Add onion, a spoon of tomato paste, 4 cups broth; simmer covered 1½ hours.', 'Add chunked potatoes and carrots, 30–40 minutes more until tender.'],
  },
  {
    id: 'lasagna',
    name: 'Lasagna',
    minutes: 90,
    servings: 8,
    tags: ['dinner', 'baking', 'meal prep', 'freezer', 'pasta'],
    ingredients: [I('Lasagna noodles', ['lasagna']), BEEF, I('Pasta sauce', ['pasta sauce', 'marinara', 'spaghetti sauce']), I('Mozzarella', ['mozzarella', 'italian blend']), opt('Ricotta or cottage cheese', ['ricotta', 'cottage']), opt('Parmesan', ['parmesan'])],
    steps: ['Brown the beef, stir in the sauce.', 'Layer sauce, noodles (oven-ready need no boiling), ricotta and mozzarella; repeat 3 times.', 'Cover with foil, bake at 375°F 45 minutes, uncover 15 more. Rest 15 before cutting.'],
  },
  {
    id: 'baked-mac',
    name: 'Baked Mac & Cheese',
    minutes: 45,
    servings: 6,
    tags: ['dinner', 'baking', 'pasta'],
    ingredients: [I('Elbow pasta', ['elbow', 'macaroni', 'pasta', 'shells'], { not: ['mac and cheese', 'kraft dinner'] }), I('Shredded cheddar', ['cheddar', 'shredded cheese', 'colby']), I('Milk', ['milk'], { not: ['chocolate'] }), I('Butter', ['butter'], { not: ['peanut'] }), opt('Flour', ['flour'], { not: ['tortilla'] })],
    steps: ['Boil 1 lb pasta 2 minutes short of done.', 'Melt 4 tbsp butter, whisk in 3 tbsp flour, then 3 cups milk; stir until thick. Off the heat, stir in 3 cups cheese.', 'Mix with the pasta, top with more cheese, bake at 375°F 20 minutes.'],
  },
  {
    id: 'roast-chicken',
    name: 'Roast Chicken & Veggies',
    minutes: 90,
    servings: 4,
    tags: ['dinner', 'one pan'],
    ingredients: [I('Whole chicken or thighs', ['whole chicken', 'chicken thigh', 'chicken leg', 'drumstick']), I('Potatoes', ['potato'], { not: ['chip', 'tot', 'fries'], uses: 4 }), opt('Carrots', ['carrot']), opt('Onion', ['onion'], { not: ['ring', 'powder'] }), opt('Lemon', ['lemon'])],
    steps: ['Heat the oven to 425°F.', 'Chunk the veggies onto a pan, oil and salt. Chicken on top, rubbed with oil, salt, pepper and garlic powder.', 'Roast until 165°F in the thickest part: thighs ~40 minutes, a whole chicken 60–75. Rest 10 minutes.'],
  },
  {
    id: 'enchiladas',
    name: 'Chicken Enchiladas',
    minutes: 45,
    servings: 5,
    tags: ['dinner', 'baking', 'freezer'],
    ingredients: [CHICKEN, I('Enchilada sauce', ['enchilada']), { ...TORTILLAS, uses: 10 }, I('Shredded cheese', ['shredded cheese', 'mexican blend', 'cheddar', 'monterey']), opt('Sour cream', ['sour cream']), opt('Black beans', ['black bean'])],
    steps: ['Heat the oven to 375°F.', 'Mix shredded cooked chicken with a cup of cheese and a little sauce; roll into tortillas, seam down in a dish.', 'Pour the rest of the sauce over, cover with cheese, bake 20–25 minutes.'],
  },
  {
    id: 'shepherds-pie',
    name: 'Shepherd’s Pie',
    minutes: 60,
    servings: 6,
    tags: ['dinner', 'baking', 'freezer'],
    ingredients: [BEEF, I('Potatoes or instant mashed', ['potato', 'mashed', 'instant potato'], { not: ['chip', 'tot', 'fries'] }), I('Frozen mixed veggies', ['mixed vegetable', 'frozen vegetable', 'peas and carrots', 'corn', 'peas']), opt('Gravy or beef broth', ['gravy', 'beef broth']), opt('Cheese', CHEESE.match, { not: CHEESE.not })],
    steps: ['Make mashed potatoes (instant is fine).', 'Brown the beef, stir in the veggies and a cup of gravy or thickened broth.', 'Spread in a dish, top with mashed potatoes and cheese, bake at 400°F 20 minutes.'],
  },
  {
    id: 'meatloaf',
    name: 'Meatloaf',
    minutes: 75,
    servings: 6,
    tags: ['dinner', 'baking', 'meal prep'],
    ingredients: [BEEF, { ...EGGS, uses: 1 }, I('Breadcrumbs or crackers', ['breadcrumb', 'panko', 'cracker', 'oats']), I('Ketchup', ['ketchup']), opt('Onion', ['onion'], { not: ['ring', 'powder'] })],
    steps: ['Heat the oven to 350°F.', 'Mix 2 lb beef, an egg, ¾ cup crumbs, ½ cup ketchup, salt and pepper; shape a loaf.', 'Top with ketchup and bake about an hour, to 160°F.'],
  },
  {
    id: 'white-chicken-chili',
    name: 'White Chicken Chili',
    minutes: 240,
    servings: 6,
    tags: ['slow cooker', 'soup', 'meal prep', 'freezer'],
    ingredients: [I('Chicken breasts', ['chicken breast', 'chicken thigh'], { not: ['nugget', 'popcorn', 'breaded'] }), I('White beans', ['great northern', 'cannellini', 'white bean'], { uses: 2 }), I('Chicken broth', ['chicken broth', 'chicken stock']), opt('Green chiles', ['green chile', 'green chili']), opt('Cream cheese', ['cream cheese'])],
    steps: ['Chicken, beans, a can of chiles, 3 cups broth, cumin and garlic in the slow cooker.', 'Low 4–6 hours. Shred the chicken.', 'Stir in 4 oz cream cheese until creamy.'],
  },
  {
    id: 'chicken-rice-casserole',
    name: 'Cheesy Chicken & Rice Casserole',
    minutes: 60,
    servings: 6,
    tags: ['dinner', 'baking', 'meal prep'],
    ingredients: [CHICKEN, RICE, I('Cream of chicken soup', ['cream of chicken', 'cream of mushroom'], { uses: 1 }), I('Broccoli', ['broccoli']), I('Shredded cheddar', ['cheddar', 'shredded cheese'])],
    steps: ['Heat the oven to 375°F.', 'Mix cooked rice, cooked chicken, the soup, ½ cup milk and broccoli in a dish.', 'Cover with cheese, bake 25–30 minutes until bubbly.'],
  },
  {
    id: 'breakfast-casserole',
    name: 'Breakfast Casserole',
    minutes: 60,
    servings: 8,
    tags: ['breakfast', 'baking', 'meal prep'],
    ingredients: [{ ...EGGS, uses: 10 }, I('Sausage', ['sausage', 'bacon', 'ham']), I('Hash browns or bread', ['hash brown', 'tater tot', 'bread']), I('Cheese', CHEESE.match, { not: CHEESE.not }), opt('Milk', ['milk'], { not: ['chocolate'] })],
    steps: ['Heat the oven to 350°F.', 'Brown the sausage. Layer hash browns, sausage and cheese in a 9×13.', 'Whisk 10 eggs with a cup of milk, pour over, bake 45 minutes until set. Slices reheat all week.'],
  },
  {
    id: 'stuffed-peppers',
    name: 'Stuffed Peppers',
    minutes: 50,
    servings: 4,
    tags: ['dinner', 'baking'],
    ingredients: [I('Bell peppers', ['bell pepper', 'pepper'], { not: ['dr pepper', 'pepperoni', 'flake', 'black pepper', 'jack'], uses: 4 }), BEEF, RICE, I('Pasta sauce or tomatoes', ['pasta sauce', 'marinara', 'diced tomato', 'tomato sauce', 'rotel']), opt('Cheese', CHEESE.match, { not: CHEESE.not })],
    steps: ['Heat the oven to 375°F. Cut the tops off the peppers and scoop them out.', 'Mix browned beef, cooked rice and sauce; fill the peppers.', 'Bake covered 30 minutes, cheese on top, 10 more uncovered.'],
  },
  {
    id: 'banana-bread',
    name: 'Banana Bread',
    minutes: 75,
    servings: 10,
    tags: ['baking', 'snack', 'breakfast'],
    ingredients: [I('Ripe bananas', ['banana'], { uses: 3 }), I('Flour', ['flour'], { not: ['tortilla'] }), I('Sugar', ['sugar'], { not: ['free'] }), { ...EGGS, uses: 2 }, I('Butter', ['butter'], { not: ['peanut'] }), opt('Baking soda', ['baking soda'])],
    steps: ['Heat the oven to 350°F and grease a loaf pan.', 'Mash 3 bananas; stir in ⅓ cup melted butter, ¾ cup sugar, 2 eggs, 1 tsp baking soda, a pinch of salt, then 1½ cups flour.', 'Bake 55–65 minutes until a toothpick comes out clean.'],
  },
  {
    id: 'chicken-noodle-soup',
    name: 'Homemade Chicken Noodle Soup',
    minutes: 45,
    servings: 6,
    tags: ['soup', 'dinner', 'freezer'],
    ingredients: [CHICKEN, I('Egg noodles', ['egg noodle', 'noodle'], { not: ['ramen', 'cup'] }), I('Chicken broth', ['chicken broth', 'chicken stock', 'bouillon']), I('Carrots and celery', ['carrot', 'celery']), opt('Onion', ['onion'], { not: ['ring', 'powder'] })],
    steps: ['Soften chopped onion, carrots and celery in a pot with a little oil.', 'Add 8 cups broth and the chicken; simmer 20 minutes, then shred the chicken.', 'Add the noodles for the last 8 minutes.'],
  },
  {
    id: 'chili-mac',
    name: 'One-Pot Chili Mac',
    minutes: 30,
    servings: 5,
    tags: ['dinner', 'one pot', 'pasta'],
    ingredients: [BEEF, PASTA, BEANS, I('Canned tomatoes', ['diced tomato', 'tomato sauce', 'crushed tomato', 'rotel']), CHEESE, opt('Chili powder', ['chili powder', 'chili seasoning'])],
    steps: ['Brown the beef in a big pot, drain.', 'Add beans, tomatoes, 2 tbsp chili powder, 2 cups pasta and 2½ cups water.', 'Simmer covered 12–15 minutes, stirring, until the pasta is tender. Stir in cheese.'],
  },
];

// how many of a counted thing one batch uses, for "I Made This" (3 eggs, 8 tortillas); 1 when not listed
const USES: Record<string, Record<string, number>> = {
  'breakfast-burritos': { Eggs: 10, Tortillas: 8 },
  'egg-fried-rice': { Eggs: 2 },
  quesadillas: { Tortillas: 2 },
  'eggs-toast': { Eggs: 3 },
  'ramen-upgrade': { Ramen: 1, Egg: 1 },
  'sloppy-joes': { Buns: 4 },
  'loaded-potatoes': { Potatoes: 4 },
  'sheet-pan-sausage': { Potatoes: 3 },
  'mac-hot-dogs': { 'Hot dogs': 3 },
  chili: { Beans: 2 },
  'chicken-wraps': { Tortillas: 2 },
  'burrito-bowls': { Beans: 1 },
};

export const BUILT_IN_RECIPES: Recipe[] = RECIPES.map((r) => (USES[r.id] ? { ...r, ingredients: r.ingredients.map((i) => (USES[r.id][i.name] != null ? { ...i, uses: USES[r.id][i.name] } : i)) } : r));

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
/**
 * What cooking it uses up, as a suggestion you can change before saving: counted things go down by what the
 * recipe uses (3 eggs, 4 tortillas; 1 if it doesn't say), amounts by about a quarter of a package, and things
 * tracked by level go down a step (Full → Half → Low → Out).
 */
export function usedUp(m: RecipeMatch, batches = 1): PantryItem[] {
  const out = new Map<string, PantryItem>();
  for (const { ing, item } of m.have) {
    const p = out.get(item.id) ?? item;
    if (p.mode === 'level') out.set(p.id, { ...p, level: p.level === 'full' ? 'half' : p.level === 'half' ? 'low' : 'out' });
    else if (p.mode === 'count') out.set(p.id, { ...p, qty: Math.max(0, p.qty - (ing.uses ?? 1) * batches) });
    else out.set(p.id, { ...p, qty: Math.max(0, Math.round((p.qty - p.perBuy * 0.25 * batches) * 100) / 100) });
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
