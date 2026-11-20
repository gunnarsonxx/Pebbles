// Grocery items: friendly names, store departments, and what you usually buy.
import { diffDays } from './dates';
import { round2 } from './money';
import type { GroceryDept, ISODate, ItemRule, Receipt, ReceiptItem } from './types';

export const DEPT_LABEL: Record<GroceryDept, string> = {
  produce: 'Produce',
  meat: 'Meat & Seafood',
  dairy: 'Dairy & Eggs',
  bakery: 'Bread & Bakery',
  pantry: 'Pantry',
  frozen: 'Frozen',
  snacks: 'Snacks & Sweets',
  drinks: 'Drinks',
  alcohol: 'Beer, Wine & Liquor',
  household: 'Household',
  personal: 'Personal Care',
  baby: 'Baby',
  pet: 'Pet',
  fuel: 'Gas',
  tobacco: 'Nicotine & Tobacco',
  prepared: 'Hot Food & Fountain Drinks',
  lottery: 'Lottery',
  auto: 'Car Care',
  other: 'Other',
};

/** Departments that are usually wants rather than needs. */
export const WANT_DEPTS: GroceryDept[] = ['snacks', 'alcohol', 'drinks', 'tobacco', 'prepared', 'lottery'];

/** Not groceries at all: kept out of the grocery budget and the pantry. */
export const NON_GROCERY_DEPTS: GroceryDept[] = ['fuel', 'tobacco', 'lottery', 'auto'];

// Receipt abbreviations (Kroger/King Soopers, Walmart, Safeway...)
const ABBR: [RegExp, string][] = [
  [/\bKING SOOPERS?\b|\bCITY MARKET\b|\bKINGS? SOOP\b|\bKSCM\b|\bCM\b|\bKRO\b|\bKROGER\b|\bKS\b|\bLUCERNE\b|\bKIRKLAND\b|\bGOOD ?& ?GATHER\b|\bMARKET PANTRY\b|\bSIGNATURE SELECT\b|\bPRIVATE SELECTION\b|\bCOMFORT ZONE\b|\bHOME CHEF\b|\bSMART WAY\b|\bBIG K\b|\bSIMTRU\b|\bSIMPLE TRUTH\b|\bPRIV SEL\b|\bP\$\$T\b|\bGV\b|\bGREAT VALUE\b|\bMKTSD\b|\bMARKETSIDE\b|\bEQUATE\b|\bSIGNATURE\b|\bSIG\b|\bO ORGANICS\b|\bHT\b|\bCB\b/g, ''],
  [/\bORG\b/g, 'ORGANIC'],
  [/\bWHL\b|\bWHLE\b/g, 'WHOLE'],
  [/\bMLK\b|\bMILKK\b/g, 'MILK'],
  [/\bCHS\b|\bCHSE\b|\bCHEES\b/g, 'CHEESE'],
  [/\bSHRD\b|\bSHRED\b/g, 'SHREDDED'],
  [/\bBRD\b/g, 'BREAD'],
  [/\bCHKN\b|\bCHIX\b|\bCHK\b/g, 'CHICKEN'],
  [/\bBNLS\b/g, 'BONELESS'],
  [/\bSKNLS\b|\bSKLS\b/g, 'SKINLESS'],
  [/\bBRST\b|\bBRS\b/g, 'BREAST'],
  [/\bGRD\b|\bGRND\b/g, 'GROUND'],
  [/\bBF\b|\bBEEF\b/g, 'BEEF'],
  [/\bTKY\b|\bTRKY\b/g, 'TURKEY'],
  [/\bYGRT\b|\bYOG\b|\bYGT\b/g, 'YOGURT'],
  [/\bBNNA\b|\bBANAN\b|\bBANANA\b/g, 'BANANAS'],
  [/\bPOT\b|\bPOTATOS\b/g, 'POTATOES'],
  [/\bTOM\b|\bTOMATOS\b/g, 'TOMATOES'],
  [/\bLTTC\b|\bLETT\b/g, 'LETTUCE'],
  [/\bAVO\b|\bAVOCADOS\b/g, 'AVOCADO'],
  [/\bAPPL\b/g, 'APPLES'],
  [/\bSTRWB\b|\bSTRAWB\b|\bSTRWBRY\b/g, 'STRAWBERRIES'],
  [/\bCRM\b/g, 'CREAM'],
  [/\bSCE\b/g, 'SAUCE'],
  [/\bPNT\b|\bPB\b/g, 'PEANUT'],
  [/\bBTR\b|\bBUTR\b/g, 'BUTTER'],
  [/\bCRL\b|\bCEREL\b/g, 'CEREAL'],
  [/\bTORT\b|\bTORTLA\b/g, 'TORTILLAS'],
  [/\bFRZ\b|\bFRZN\b/g, 'FROZEN'],
  [/\bPZA\b|\bPIZ\b/g, 'PIZZA'],
  [/\bPSTA\b/g, 'PASTA'],
  [/\bSPAG\b/g, 'SPAGHETTI'],
  [/\bRCE\b/g, 'RICE'],
  [/\bOJ\b/g, 'ORANGE JUICE'],
  [/\bJCE\b|\bJUCE\b/g, 'JUICE'],
  [/\bWTR\b/g, 'WATER'],
  [/\bSODA\b|\bPOP\b/g, 'SODA'],
  [/\bTP\b|\bBATH TISS\b|\bBATH TISSUE\b/g, 'TOILET PAPER'],
  [/\bPPR TWL\b|\bPAPER TWL\b|\bTWL\b/g, 'PAPER TOWELS'],
  [/\bDET\b|\bDTRGNT\b/g, 'DETERGENT'],
  [/\bLG\b/g, 'LARGE'],
  [/\bDZ\b|\bDOZ\b/g, 'DOZEN'],
  [/\bGAL\b/g, 'GALLON'],
  [/\bVEG\b/g, 'VEGETABLE'],
  [/\bSTK\b/g, 'STEAK'],
  [/\bSAUS\b/g, 'SAUSAGE'],
  [/\bBCN\b/g, 'BACON'],
];

// What it is, in plain words: a gallon of "KS CM VIT D MILK" is just Milk. First match wins.
const BASE: [RegExp, string][] = [
  // things whose names contain another food's word (Cream of WHEAT, Bad APPLE energy drink)
  [/CREAM OF WHEAT/, 'Cream of Wheat'],
  [/\bMONSTER\b/, 'Monster Energy'],
  [/RED ?BULL/, 'Red Bull'],
  [/\bCELSIUS\b/, 'Celsius'],
  [/ENERGY DRINK|\bBANG\b ENERGY|\bREIGN\b|\bROCKSTAR\b/, 'Energy Drink'],
  [/BROWN SUGAR/, 'Brown Sugar'],
  [/POWDERED SUGAR/, 'Powdered Sugar'],
  [/\bSUGAR\b(?! FREE| COOKIE)/, 'Sugar'],
  [/\bFLOUR\b(?! TORTILLA)/, 'Flour'],
  [/ENGLISH MUFFIN/, 'English Muffins'],
  [/CHOC(OLATE)? MILK/, 'Chocolate Milk'],
  [/ALMOND ?MILK|ALMOND BEVERAGE/, 'Almond Milk'],
  [/OAT ?MILK|OATMILK/, 'Oat Milk'],
  [/COCONUT MILK/, 'Coconut Milk'],
  [/\bMILK\b(?! CHOC| BONE)|\bVIT(AMIN)? ?D\b|\b[12] ?% ?(RF|LF|REDUCED|LOW)?\b(?!.*(YOGURT|CHEESE|COTTAGE))|\bSKIM\b|FAT FREE MILK|\bHALF GALLON\b/, 'Milk'],
  [/HALF ?& ?HALF|HALF N HALF/, 'Half & Half'],
  [/CREAMER/, 'Coffee Creamer'],
  [/COFFEE|FOLGERS|MAXWELL|STARBUCKS|DUNKIN|K ?CUP/, 'Coffee'],
  [/CREAM CHEESE/, 'Cream Cheese'],
  [/SOUR CREAM/, 'Sour Cream'],
  [/COTTAGE/, 'Cottage Cheese'],
  [/\bEGGS?\b(?! ?ROLL| ?NOODLE|PLANT| ?NOG)|GRADE A (LARGE|LG)|\bLARGE (WHITE|BROWN)\b/, 'Eggs'],
  [/PEANUT BUTTER|\bPEANUT\b.*\b(CREAMY|CRUNCHY)\b/, 'Peanut Butter'],
  [/\bBUTTER\b(?!MILK)|\bMARGARINE\b/, 'Butter'],
  [/SHREDDED.*CHEESE|CHEESE.*SHREDDED|MEXICAN BLEND|FINELY SHRED/, 'Shredded Cheese'],
  [/SLICED.*CHEESE|CHEESE.*SLICE|\bAMERICAN SINGLES?\b|\bSINGLES\b/, 'Sliced Cheese'],
  [/\bYOGURT\b|\bYOPLAIT\b|\bCHOBANI\b/, 'Yogurt'],
  [/HAMBURGER BUN|HOT DOG BUN|\bBUNS\b/, 'Buns'],
  [/\bBAGELS?\b(?! BITE)/, 'Bagels'],
  [/ENGLISH MUFFIN/, 'English Muffins'],
  [/\bTORTILLAS?\b(?! CHIP)/, 'Tortillas'],
  [/\bBREAD\b(?! CRUMB)|\bSANDWICH (WHITE|WHEAT)\b|\bTEXAS TOAST\b|\bWHITE BRD\b|\bWHEAT\b(?! THIN)/, 'Bread'],
  [/PIZZA ROLL/, 'Pizza Rolls'],
  [/POPCORN CHICKEN/, 'Popcorn Chicken'],
  [/NUGGET/, 'Chicken Nuggets'],
  [/CHICKEN (BREAST|TENDERLOIN)|BONELESS SKINLESS/, 'Chicken Breast'],
  [/CHICKEN THIGH/, 'Chicken Thighs'],
  [/CHICKEN WING|\bWINGS\b/, 'Chicken Wings'],
  [/GROUND BEEF|\bHAMBURGER\b|GROUND CHUCK|\d\d ?% ?LEAN/, 'Ground Beef'],
  [/GROUND TURKEY/, 'Ground Turkey'],
  [/\bBACON\b/, 'Bacon'],
  [/HOT DOG|\bFRANKS?\b|WIENER/, 'Hot Dogs'],
  [/LUNCH ?MEAT|DELI (TURKEY|HAM)|SLICED (TURKEY|HAM)/, 'Lunch Meat'],
  [/\bBANANAS?\b/, 'Bananas'],
  [/\bAPPLES?\b(?! JUICE| SAUCE)/, 'Apples'],
  [/STRAWBERR/, 'Strawberries'],
  [/BLUEBERR/, 'Blueberries'],
  [/\bGRAPES?\b/, 'Grapes'],
  [/\bPOTATO(ES)?\b(?! CHIP)/, 'Potatoes'],
  [/\bONIONS?\b(?! RING)/, 'Onions'],
  [/BROCCOLI/, 'Broccoli'],
  [/\bLETTUCE\b|\bROMAINE\b|SALAD KIT|SALAD MIX/, 'Salad'],
  [/ORANGE JUICE/, 'Orange Juice'],
  [/\bRICE\b(?! KRISP| CAKE| A RONI)/, 'Rice'],
  [/MAC(ARONI)? ?(&|AND|N) ?CHEESE|KRAFT DINNER/, 'Mac & Cheese'],
  [/SPAGHETTI SAUCE|PASTA SAUCE|MARINARA/, 'Pasta Sauce'],
  [/\bSPAGHETTI\b|\bPENNE\b|\bROTINI\b|\bPASTA\b|\bELBOW/, 'Pasta'],
  [/\bRAMEN\b|TOP RAMEN|MARUCHAN/, 'Ramen'],
  [/\bCEREAL\b|CHEERIOS|FROSTED FLAKES|CINNAMON TOAST CRUNCH/, 'Cereal'],
  [/\bOATS\b|OATMEAL/, 'Oatmeal'],
  [/TOILET PAPER/, 'Toilet Paper'],
  [/PAPER TOWEL/, 'Paper Towels'],
  [/BOTTLED WATER|SPRING WATER|PURIFIED WATER|DRINKING WATER/, 'Water'],
];

// a fruit or vegetable word inside something else (apple juice, banana bread, strawberry yogurt) isn't that fruit
const PRODUCE = new Set(['Bananas', 'Apples', 'Strawberries', 'Blueberries', 'Grapes', 'Potatoes', 'Onions', 'Broccoli', 'Salad']);
const MADE_FROM = /DRINK|JUICE|SODA|FLAVOR|CANDY|CHOC|\bBAR\b|BARS|CEREAL|SAUCE|\bPIE\b|CHIP|YOGURT|MUFFIN|BREAD|CAKE|SNACK|POUCH|GUMM|\bTEA\b|JAM|JELLY|PRESERVES|SYRUP|CIDER|WATER|SPREAD|POP ?TART|TOASTER|OATMEAL|SOUP|SEASONING|DIP\b/;

/** The plain name for a cleaned receipt line, or null to keep it as is. */
export function baseName(upper: string): string | null {
  const s = ` ${upper.toUpperCase()} `;
  for (const [re, name] of BASE) if (re.test(s) && !(PRODUCE.has(name) && MADE_FROM.test(s))) return name;
  return null;
}

/** How many come in one package, from the name: "6 ct", "12CT", "dozen", "2 pc", "18 count". */
export function packOf(raw: string): number | null {
  const t = raw.toUpperCase();
  const m = t.match(/\b(\d{1,3})\s*(?:CT|COUNT|PC|PCS|PK|PACK|CAN PACK)\b/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  if (/\b(\d)\s*DOZ(EN)?\b/.test(t)) return parseInt(t.match(/\b(\d)\s*DOZ/)![1], 10) * 12;
  if (/\bDOZ(EN)?\b|\bDZ\b/.test(t)) return 12;
  return null;
}

export function cleanItemName(raw: string): { name: string; key: string } {
  let s = ` ${raw.toUpperCase()} `;
  s = s
    .replace(/\b\d{6,}\b/g, ' ') // UPCs
    .replace(/\b\d+(\.\d+)?\s*(OZ|FZ|FL OZ|LB|LBS|CT|PK|PACK|PC|PCS|ML|L|G|KG|QT|PT)\b/g, ' ') // sizes
    .replace(/\bFL OZ\b|\bCAN\b(?= *,|$)/g, ' ')
    .replace(/\b(FILLED WITH|WITH|BY)\b.*$/, ' ') // "...Filled With Pumpkin Spice Cream", "...By Snowfox"
    .replace(/\b(HALF\s+)?(GAL|GALLON|DZ|DOZ|DOZEN)\b/g, ' ')
    .replace(/[^A-Z&' ]/g, ' ');
  for (const [re, rep] of ABBR) s = s.replace(re, rep);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = raw.trim().toUpperCase();
  // plain names for the everyday stuff (milk, bread, eggs, coffee…)
  const base = baseName(s);
  if (base) return { name: base, key: base.toLowerCase().replace(/[^a-z]/g, '').slice(0, 24) };
  // otherwise drop filler words a receipt adds
  s = s.replace(/\b(GRADE A|ORIGINAL|CLASSIC|FAMILY SIZE|VALUE PACK|FAMILY PACK|REGULAR|FRESH)\b/g, ' ').replace(/\s+/g, ' ').trim() || s;
  const name = s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
  const key = s.toLowerCase().replace(/[^a-z]/g, '').slice(0, 24);
  return { name, key };
}

const DEPTS: [RegExp, GroceryDept][] = [
  [/\bUNLEADED\b|\bUNL\b|\bUNLD\b|REG(ULAR)? UNL|\bPREMIUM UNL|\bPLUS UNL|\bMIDGRADE\b|\bDIESEL\b|\bFUEL\b|\bGASOLINE\b|\bPUMP\b|\bE ?85\b|^GAS\b|\bGAS SALE|\bPREPAY\b/, 'fuel'],
  [/MARLBORO|NEWPORT|CAMEL|PALL MALL|WINSTON|AMERICAN SPIRIT|\bCIG(S|ARETTE|ARETTES|AR|ARS)?\b|\bZYN\b|\bVELO\b|\bROGUE\b|\bON NICOTINE|NICOTINE|\bPOUCH(ES)?\b|\bVUSE\b|\bJUUL\b|\bVAPE\b|\bNJOY\b|GEEK ?BAR|ELF ?BAR|BREEZE|\bSKOAL\b|COPENHAGEN|GRIZZLY|\bKODIAK\b|\bSNUFF\b|\bDIP\b|BLACK ?N ?MILD|SWISHER|\bBACKWOODS\b|\bTOBACCO\b|\bLUCY\b|\bSESH\b/, 'tobacco'],
  [/LOTTERY|LOTTO|POWERBALL|MEGA ?MILLIONS|SCRATCH|SCRATCHER|\bQUICK ?PICK\b|CASH ?5\b|PICK ?3\b/, 'lottery'],
  [/MOTOR OIL|\b5W ?\d0\b|\b10W ?\d0\b|WASHER FLUID|WIPER|ANTIFREEZE|COOLANT|CAR WASH|AIR FRESHENER|\bWASH\b.*\bCAR\b|TIRE/, 'auto'],
  [/CREAM OF WHEAT|OATMEAL|\bGRITS\b|\bCEREAL\b|BROWN SUGAR|\bFLOUR\b|\bSUGAR\b/, 'pantry'],
  // boxed freezer snacks, before 'popcorn' (snacks) and 'rolls' (bakery) can claim them
  [/PIZZA ROLL|POPCORN CHICKEN|NUGGET|EGG ROLL|MOZZ(ARELLA)? STICK|CORN DOG|BAGEL BITE|PIZZA BITE|FISH STICK|POT ?STICKER|TATER TOT|ONION RING|CHICKEN STRIP|DINO (NUGGET|BITE)/, 'frozen'],
  [/FOUNTAIN|\bPOLAR POP\b|\bBIG GULP\b|SLURPEE|FROZEN DRINK|HOT DOG ROLLER|\bROLLER\b|TAQUITO|PIZZA SLICE|\bSLICE\b|\bBURRITO\b|HOT FOOD|\bDELI SAND|\bSANDWICH\b|\bCOFFEE CUP\b|\bHOT COFFEE\b|\bCAPPUCCINO\b|\bFRAPPE\b|\bNACHOS\b|\bCHICKEN TENDER|\bFRIED CHICKEN\b|\bEMPANADA/, 'prepared'],
  [/BEER|WINE|VODKA|WHISK|TEQUILA|RUM\b|SELTZER HARD|IPA\b|LAGER|BUD LIGHT|COORS|MICHELOB|CORONA|MODELO|WHITE CLAW|TRULY|LIQUOR|CABERNET|MERLOT|CHARDONNAY|PINOT/, 'alcohol'],
  [/DIAPER|WIPES|BABY|FORMULA|PULL UPS|HUGGIES|PAMPERS/, 'baby'],
  [/DOG|CAT\b|PET\b|KIBBLE|LITTER|PURINA|MEOW|BLUE BUFFALO/, 'pet'],
  [/SHAMPOO|CONDITIONER|SOAP|BODY WASH|DEODORANT|TOOTH|FLOSS|RAZOR|LOTION|TAMPON|PAD\b|PADS\b|COTTON|ADVIL|TYLENOL|IBUPROFEN|VITAMIN|BANDAGE|COLGATE|CREST|DOVE\b|SUNSCREEN|MAKEUP/, 'personal'],
  [/TOILET PAPER|PAPER TOWELS|NAPKIN|DETERGENT|DISH|BLEACH|CLEANER|LYSOL|CLOROX|TRASH BAG|GARBAGE BAG|FOIL|PLASTIC WRAP|ZIPLOC|SPONGE|BATTER(Y|IES)|LIGHT BULB|TIDE|DAWN|GAIN\b|SWIFFER|KLEENEX|TISSUE/, 'household'],
  [/CHIPS|DORITOS|CHEETOS|LAYS|PRINGLES|COOKIE|OREO|CANDY|CHOCOLATE|SNICKERS|M&M|REESE|GUMMY|GUM\b|ICE CREAM|POPCORN|PRETZEL|CRACKER|DONUT|CAKE|BROWNIE|PIE\b|SNACK|JERKY|TRAIL MIX|SKITTLES|KIT KAT|TWIX|HERSHEY/, 'snacks'],
  [/SODA|COKE|PEPSI|SPRITE|DR PEPPER|MOUNTAIN DEW|ENERGY|MONSTER|RED BULL|CELSIUS|GATORADE|POWERADE|JUICE|WATER|SPARKLING|LA CROIX|COFFEE|TEA\b|KOMBUCHA|LEMONADE/, 'drinks'],
  [/FROZEN|FRZ|\bICE\b|TOTINO|STOUFFER|HOT POCKET|LEAN CUISINE|EGGO|WAFFLES|TATER TOTS|FRIES/, 'frozen'],
  [/BREAD|BUN|BUNS|BAGEL|TORTILLA|ROLLS|MUFFIN|CROISSANT|BAGUETTE|PITA|ENGLISH MUFFIN/, 'bakery'],
  [/MILK|CHEESE|YOGURT|BUTTER|EGGS|EGG\b|CREAM|SOUR CREAM|COTTAGE|HALF & HALF|CREAMER|MARGARINE|DOZEN/, 'dairy'],
  [/CHICKEN|BEEF|PORK|TURKEY|HAM\b|BACON|SAUSAGE|STEAK|GROUND|FISH|SALMON|TILAPIA|SHRIMP|TUNA\b|HOT DOG|BRATS|DELI|SALAMI|PEPPERONI|LUNCH MEAT|RIBS|ROAST|WINGS|THIGHS|BREAST/, 'meat'],
  [/BANANAS|APPLES|AVOCADO|LETTUCE|SPINACH|TOMATOES|POTATOES|ONION|GARLIC|CARROT|CELERY|PEPPER|CUCUMBER|BROCCOLI|STRAWBERRIES|BLUEBERR|GRAPES|ORANGE\b|ORANGES|LEMON|LIME|CILANTRO|SALAD|BERRIES|PEACH|PEAR|MELON|WATERMELON|PINEAPPLE|MANGO|CORN\b|ZUCCHINI|SQUASH|MUSHROOM|KALE|CABBAGE|JALAPENO|PRODUCE/, 'produce'],
  [/PASTA|SPAGHETTI|RICE|BEANS|SAUCE|CEREAL|OATS|OATMEAL|FLOUR|SUGAR|OIL\b|SALT|SPICE|SEASONING|SOUP|BROTH|CANNED|PEANUT|JELLY|JAM\b|HONEY|SYRUP|KETCHUP|MUSTARD|MAYO|DRESSING|SALSA|NOODLE|RAMEN|MAC|TUNA|STOCK|VINEGAR|CORNSTARCH|BAKING|GRANOLA|BAR\b|BARS\b/, 'pantry'],
];

export function deptFor(name: string, key: string, rules: ItemRule[] = []): GroceryDept {
  const r = rules.find((x) => x.id === key);
  if (r) return r.dept;
  const up = name.toUpperCase();
  for (const [re, d] of DEPTS) if (re.test(up)) return d;
  return 'other';
}

// ---------------- analysis ----------------

export interface ItemStat {
  key: string;
  name: string;
  dept: GroceryDept;
  trips: number; // how many trips included it
  share: number; // fraction of trips
  avgPrice: number;
  lastPrice: number;
  lastStore: string;
  byStore: Record<string, { avg: number; last: number; count: number }>;
}

export interface GroceryStats {
  trips: number;
  spanDays: number;
  tripsPerMonth: number;
  avgTrip: number;
  usual: ItemStat[];
  usualTrip: number; // what a needs-based trip costs (before tax)
  needsPerMonth: number; // groceries you need, per month, from all trips (before tax)
  extrasPerTrip: number;
  extrasByDept: { dept: GroceryDept; perTrip: number }[];
  taxRate: number | null; // learned from your receipts
  stores: { store: string; trips: number; avg: number }[];
  items: ItemStat[];
}

const WINDOW_DAYS = 120;

export function receiptItemsTotal(r: Receipt): number {
  return round2(r.items.reduce((s, i) => s + i.price, 0));
}

/** A grocery trip has at least one grocery item (a gas-station stop for just gas and a vape isn't one). */
export function isGroceryTrip(r: Receipt): boolean {
  return r.items.some((i) => i.price > 0 && !NON_GROCERY_DEPTS.includes(i.dept) && i.dept !== 'prepared');
}

export function analyzeGroceries(receipts: Receipt[], asOf: ISODate): GroceryStats | null {
  const recent = receipts
    .filter((r) => diffDays(asOf, r.date) <= WINDOW_DAYS && diffDays(asOf, r.date) >= -1 && isGroceryTrip(r))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!recent.length) return null;
  const map = new Map<string, ItemStat & { sum: number; count: number }>();
  for (const r of recent) {
    const seen = new Set<string>();
    for (const it of r.items) {
      if (!it.key || it.price <= 0 || NON_GROCERY_DEPTS.includes(it.dept)) continue;
      const cur =
        map.get(it.key) ??
        ({ key: it.key, name: it.name, dept: it.dept, trips: 0, share: 0, avgPrice: 0, lastPrice: 0, lastStore: r.store, byStore: {}, sum: 0, count: 0 } as ItemStat & { sum: number; count: number });
      if (!seen.has(it.key)) cur.trips++;
      seen.add(it.key);
      const unit = it.price / Math.max(1, it.qty || 1);
      cur.sum += unit;
      cur.count++;
      cur.lastPrice = unit;
      cur.lastStore = r.store;
      cur.dept = it.dept;
      cur.name = it.name;
      const bs = cur.byStore[r.store] ?? { avg: 0, last: 0, count: 0 };
      bs.avg = (bs.avg * bs.count + unit) / (bs.count + 1);
      bs.last = unit;
      bs.count++;
      cur.byStore[r.store] = bs;
      map.set(it.key, cur);
    }
  }
  const trips = recent.length;
  const items: ItemStat[] = [...map.values()].map(({ sum, count, ...s }) => ({ ...s, avgPrice: round2(sum / count), share: s.trips / trips }));
  // "usual" = shows up in a good share of trips (or 3+ times)
  const usual = items
    .filter((i) => (trips >= 3 ? i.share >= 0.4 || i.trips >= 3 : i.trips >= 2) && !WANT_DEPTS.includes(i.dept))
    .sort((a, b) => b.share - a.share || b.avgPrice - a.avgPrice);
  const usualKeys = new Set(usual.map((u) => u.key));
  const usualTrip = round2(usual.reduce((s, i) => s + i.avgPrice * i.share, 0));
  const extrasDept = new Map<GroceryDept, number>();
  let extrasTotal = 0;
  for (const r of recent)
    for (const it of r.items) {
      if (usualKeys.has(it.key) || it.price <= 0 || NON_GROCERY_DEPTS.includes(it.dept)) continue;
      extrasTotal += it.price;
      extrasDept.set(it.dept, (extrasDept.get(it.dept) ?? 0) + it.price);
    }
  const spanDays = Math.max(7, diffDays(asOf, recent[0].date) + 1);
  const tripsPerMonth = (trips / spanDays) * 30.4;
  // learned sales tax: tax ÷ (subtotal or item total)
  const taxRates = recent
    .filter((r) => r.tax != null && r.tax > 0)
    .map((r) => (r.tax as number) / (r.subtotal ?? receiptItemsTotal(r)))
    .filter((x) => x > 0 && x < 0.15);
  const taxRate = taxRates.length ? round2((taxRates.reduce((s, x) => s + x, 0) / taxRates.length) * 10000) / 10000 : null;
  const storeMap = new Map<string, { trips: number; sum: number }>();
  for (const r of recent) {
    const s = storeMap.get(r.store) ?? { trips: 0, sum: 0 };
    s.trips++;
    s.sum += r.total ?? receiptItemsTotal(r);
    storeMap.set(r.store, s);
  }
  // what needs cost per month, counting every trip, big or small
  let needs = 0;
  for (const r of recent) for (const it of r.items) if (it.price > 0 && !NON_GROCERY_DEPTS.includes(it.dept) && !WANT_DEPTS.includes(it.dept)) needs += it.price;
  return {
    trips,
    spanDays,
    needsPerMonth: round2((needs / spanDays) * 30.4),
    tripsPerMonth: round2(tripsPerMonth),
    avgTrip: round2(recent.reduce((s, r) => s + (r.total ?? receiptItemsTotal(r)), 0) / trips),
    usual,
    usualTrip,
    extrasPerTrip: round2(extrasTotal / trips),
    extrasByDept: [...extrasDept.entries()].map(([dept, v]) => ({ dept, perTrip: round2(v / trips) })).sort((a, b) => b.perTrip - a.perTrip),
    taxRate,
    stores: [...storeMap.entries()].map(([store, v]) => ({ store, trips: v.trips, avg: round2(v.sum / v.trips) })).sort((a, b) => b.trips - a.trips),
    items: items.sort((a, b) => b.trips - a.trips),
  };
}

/** Items on a receipt that aren't part of your usual needs-based trip. */
export function extrasOn(receipt: Receipt, stats: GroceryStats | null): ReceiptItem[] {
  if (!stats) return [];
  const usual = new Set(stats.usual.map((u) => u.key));
  return receipt.items.filter((i) => i.price > 0 && !usual.has(i.key));
}

/** Monthly grocery need from receipts: usual trips, with tax. */
export function monthlyGroceryNeed(stats: GroceryStats | null, fallbackTax = 0.0407): number | null {
  if (!stats || stats.trips < 3 || stats.needsPerMonth <= 0) return null;
  // lots of small trips or a few big ones: both come out as what you actually need each month
  return round2(stats.needsPerMonth * (1 + (stats.taxRate ?? fallbackTax)));
}

/** What you spent on each kind of thing, from every receipt in a month (gas, nicotine, snacks…). */
export function receiptSpendByDept(receipts: Receipt[], month: string): { dept: GroceryDept; total: number; stores: string[] }[] {
  const map = new Map<GroceryDept, { total: number; stores: Set<string> }>();
  for (const r of receipts) {
    if (r.date.slice(0, 7) !== month) continue;
    const taxShare = r.tax && r.items.length ? r.tax / Math.max(0.01, r.items.reduce((s, i) => s + Math.max(0, i.price), 0)) : 0;
    for (const it of r.items) {
      if (it.price <= 0) continue;
      const cur = map.get(it.dept) ?? { total: 0, stores: new Set<string>() };
      cur.total += it.price * (1 + (it.dept === 'fuel' ? 0 : taxShare));
      cur.stores.add(r.store);
      map.set(it.dept, cur);
    }
  }
  return [...map.entries()].map(([dept, v]) => ({ dept, total: round2(v.total), stores: [...v.stores] })).sort((a, b) => b.total - a.total);
}

/** A plain name for something already saved ("King Soopers City Market Vitamin D" → Milk), or null if it's fine. */
export function plainNameFor(name: string): { name: string; key: string } | null {
  const c = cleanItemName(name);
  return baseName(c.name) && c.name !== name ? c : null;
}
