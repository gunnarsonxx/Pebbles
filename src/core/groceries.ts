// Grocery items: friendly names, store departments, and what you usually buy.
import { diffDays } from './dates';
import { round2 } from './money';
import type { GroceryDept, ISODate, ItemRule, Receipt, ReceiptItem } from './types';

export const DEPT_LABEL: Record<GroceryDept, string> = {
  produce: 'Produce',
  meat: 'Meat & seafood',
  dairy: 'Dairy & eggs',
  bakery: 'Bread & bakery',
  pantry: 'Pantry',
  frozen: 'Frozen',
  snacks: 'Snacks & sweets',
  drinks: 'Drinks',
  alcohol: 'Beer, wine & liquor',
  household: 'Household',
  personal: 'Personal care',
  baby: 'Baby',
  pet: 'Pet',
  other: 'Other',
};

/** Departments that are usually wants rather than needs. */
export const WANT_DEPTS: GroceryDept[] = ['snacks', 'alcohol', 'drinks'];

// Receipt abbreviations (Kroger/King Soopers, Walmart, Safeway...)
const ABBR: [RegExp, string][] = [
  [/\bKRO\b|\bKROGER\b|\bKS\b|\bSIMTRU\b|\bSIMPLE TRUTH\b|\bPRIV SEL\b|\bP\$\$T\b|\bGV\b|\bGREAT VALUE\b|\bMKTSD\b|\bMARKETSIDE\b|\bEQUATE\b|\bSIGNATURE\b|\bSIG\b|\bO ORGANICS\b|\bHT\b|\bCB\b/g, ''],
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

export function cleanItemName(raw: string): { name: string; key: string } {
  let s = ` ${raw.toUpperCase()} `;
  s = s
    .replace(/\b\d{6,}\b/g, ' ') // UPCs
    .replace(/\b\d+(\.\d+)?\s*(OZ|FZ|FL OZ|LB|LBS|CT|PK|PACK|ML|L|G|KG|QT|PT)\b/g, ' ') // sizes
    .replace(/\b(HALF\s+)?(GAL|GALLON|DZ|DOZ|DOZEN)\b/g, ' ')
    .replace(/[^A-Z&' ]/g, ' ');
  for (const [re, rep] of ABBR) s = s.replace(re, rep);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = raw.trim().toUpperCase();
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
  [/BEER|WINE|VODKA|WHISK|TEQUILA|RUM\b|SELTZER HARD|IPA\b|LAGER|BUD LIGHT|COORS|MICHELOB|CORONA|MODELO|WHITE CLAW|TRULY|LIQUOR|CABERNET|MERLOT|CHARDONNAY|PINOT/, 'alcohol'],
  [/DIAPER|WIPES|BABY|FORMULA|PULL UPS|HUGGIES|PAMPERS/, 'baby'],
  [/DOG|CAT\b|PET\b|KIBBLE|LITTER|PURINA|MEOW|BLUE BUFFALO/, 'pet'],
  [/SHAMPOO|CONDITIONER|SOAP|BODY WASH|DEODORANT|TOOTH|FLOSS|RAZOR|LOTION|TAMPON|PAD\b|PADS\b|COTTON|ADVIL|TYLENOL|IBUPROFEN|VITAMIN|BANDAGE|COLGATE|CREST|DOVE\b|SUNSCREEN|MAKEUP/, 'personal'],
  [/TOILET PAPER|PAPER TOWELS|NAPKIN|DETERGENT|DISH|BLEACH|CLEANER|LYSOL|CLOROX|TRASH BAG|GARBAGE BAG|FOIL|PLASTIC WRAP|ZIPLOC|SPONGE|BATTER(Y|IES)|LIGHT BULB|TIDE|DAWN|GAIN\b|SWIFFER|KLEENEX|TISSUE/, 'household'],
  [/CHIPS|DORITOS|CHEETOS|LAYS|PRINGLES|COOKIE|OREO|CANDY|CHOCOLATE|SNICKERS|M&M|REESE|GUMMY|GUM\b|ICE CREAM|POPCORN|PRETZEL|CRACKER|DONUT|CAKE|BROWNIE|PIE\b|SNACK|JERKY|TRAIL MIX|SKITTLES|KIT KAT|TWIX|HERSHEY/, 'snacks'],
  [/SODA|COKE|PEPSI|SPRITE|DR PEPPER|MOUNTAIN DEW|ENERGY|MONSTER|RED BULL|CELSIUS|GATORADE|POWERADE|JUICE|WATER|SPARKLING|LA CROIX|COFFEE|TEA\b|KOMBUCHA|LEMONADE/, 'drinks'],
  [/FROZEN|FRZ|ICE\b|TOTINO|STOUFFER|HOT POCKET|LEAN CUISINE|EGGO|WAFFLES|TATER TOTS|FRIES/, 'frozen'],
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

export function analyzeGroceries(receipts: Receipt[], asOf: ISODate): GroceryStats | null {
  const recent = receipts.filter((r) => diffDays(asOf, r.date) <= WINDOW_DAYS && diffDays(asOf, r.date) >= -1).sort((a, b) => a.date.localeCompare(b.date));
  if (!recent.length) return null;
  const map = new Map<string, ItemStat & { sum: number; count: number }>();
  for (const r of recent) {
    const seen = new Set<string>();
    for (const it of r.items) {
      if (!it.key || it.price <= 0) continue;
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
      if (usualKeys.has(it.key) || it.price <= 0) continue;
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
  return {
    trips,
    spanDays,
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
  if (!stats || stats.trips < 3 || stats.usualTrip <= 0) return null;
  return round2(stats.usualTrip * stats.tripsPerMonth * (1 + (stats.taxRate ?? fallbackTax)));
}
