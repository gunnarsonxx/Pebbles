// Shared data model for Pebbles. Every synced record lives in a "collection"
// and carries sync metadata (updatedAt / deleted) handled by the store.

export type ISODate = string; // 'YYYY-MM-DD'

export type FilingStatus = 'single' | 'married_joint' | 'married_separate' | 'head_of_household';

export interface W4Settings {
  step2MultipleJobs: boolean; // W-4 step 2 checkbox
  childrenUnder17: number; // step 3
  otherDependents: number; // step 3
  otherIncome: number; // step 4(a), annual
  deductions: number; // step 4(b), annual
  extraWithholding: number; // step 4(c), per paycheck
}

export interface StateTaxSettings {
  state: string; // 'CO'
  city: string; // 'Colorado Springs'
  county: string; // 'El Paso'
  dr0004Allowance: number | null; // Colorado DR 0004 line 2 (annual), null = not filed
  extraWithholding: number; // per paycheck
  customFlatRate: number | null; // for states Pebbles doesn't model in detail
  famliEnabled: boolean; // Colorado FAMLI employee premium
  localTax: string | null; // key into localTaxes (e.g. 'Denver'), null = none
}

export type DeductionKind =
  | 'traditional_401k' // pre-tax for income tax, not FICA
  | 'roth_401k' // after tax
  | 'section125' // health/dental/vision: pre-tax for income tax AND FICA
  | 'hsa' // payroll HSA: pre-tax for income tax AND FICA
  | 'post_tax'; // anything else after tax (union dues, garnishment, etc.)

export interface PayrollDeduction {
  id: string;
  name: string;
  kind: DeductionKind;
  mode: 'percent' | 'fixed';
  amount: number; // percent (e.g. 5 = 5%) or dollars per paycheck
}

export interface OvertimeSettings {
  weeklyThreshold: number; // 40
  dailyThreshold: number | null; // Colorado: 12
  multiplier: number; // 1.5
  method: 'weighted' | 'base'; // FLSA weighted regular rate, or 1.5x base rate
}

export interface PaySettings {
  frequency: 'biweekly';
  periodAnchor: ISODate; // any date on which a pay period started
  paydayOffset: number; // days after the period's last day that payday falls
  baseRate: number;
  hoursPerDay: number; // 8 (paid hours in a normal day shift)
  workDays: number[]; // 0=Sun..6=Sat: days a shift STARTS (default Mon-Fri)
  shiftStart: string | null; // '21:30' for overnight shifts; null = simple day shifts
  shiftEnd: string | null; // '06:00'
  breakMinutes: number; // unpaid break
  breakAfterMidnight: boolean; // which side of midnight the break falls
  overtime: OvertimeSettings;
  holidayMultiplier: number; // pay multiplier for working a holiday (1 = none)
  holidays: {
    ids: string[]; // which holidays your employer pays (see core/holidays.ts)
    observed: boolean; // weekend holidays move to Friday/Monday
    rule: 'calendar' | 'shiftStart'; // hours worked on the holiday's date, or whole shifts that start on it
    confirmed: boolean; // you said which holidays your job pays (until then, no automatic holiday pay)
  };
  dailyPay?: { enabled: boolean; fee: number }; // your job offers DailyPay (pay before payday), and its fee per instant transfer
}

export interface HouseholdSettings {
  adults: number;
  children: number;
  seniors: number;
  foodPlan: 'thrifty' | 'low' | 'moderate' | 'liberal';
  vehicleMpg: number | null;
  milesPerMonth: number | null;
  otherEssentialsMonthly: number; // toiletries, pet food, etc.
}

export interface BudgetSettings {
  savingsTargetPct: number; // aim, e.g. 20
  wantsMaxPct: number; // keep spending money near this share once bills are known, e.g. 30
  minSavingsPct: number; // keep making progress, e.g. 5
  personalFloorPct: number; // always keep at least this % for you, e.g. 10
  billsMode: 'due_dates' | 'even';
  emergencyMonths: number; // e.g. 3
  roundTo: number; // round suggestions to $5
  billsAccountId?: string | null; // the account that holds bill money only
  spendingAccountId?: string | null; // the account for everything else
  paypalFromAccountId?: string | null; // the bank account PayPal pulls from ('paypal-balance' = PayPal's own balance)
}

export interface IntegrationSettings {
  eiaApiKey: string;
  taxRulesUrl: string;
  autoUpdate: boolean;
  plaidClientId: string;
  plaidSecret: string;
  plaidEnv: 'production' | 'sandbox';
  krogerClientId: string;
  krogerSecret: string;
  krogerLocationId: string;
  krogerLocationName: string;
  krogerStores: { id: string; name: string }[]; // every King Soopers you shop at
  zip: string;
  homeAddress: string; // for nearby gas stations
  homeLat: number | null;
  homeLon: number | null;
  googlePlacesKey: string; // optional: live station prices from Google Maps
  hiddenStations?: { id: string; name: string }[]; // closed, or not really a gas station
}

export interface FireSettings {
  age: number;
  retireAge: number;
  invested: number; // 401(k)/IRA/brokerage balances today
  extraMonthly: number; // IRA or brokerage deposits outside your paycheck
  matchPct: number; // employer 401(k) match, % of gross pay
  returnPct: number;
  inflationPct: number;
  withdrawalPct: number;
  annualSpending: number | null; // null = use your current spending
}

export interface Settings {
  id: 'settings';
  onboarded: boolean;
  tourDone?: boolean; // false = show the look-around tour (set when setup finishes)
  name: string;
  filingStatus: FilingStatus;
  w4: W4Settings;
  stateTax: StateTaxSettings;
  deductions: PayrollDeduction[];
  pay: PaySettings;
  household: HouseholdSettings;
  budget: BudgetSettings;
  integrations: IntegrationSettings;
  theme: 'auto' | 'light' | 'dark';
  fire: FireSettings;
  palette: string; // limestone | sandstone | slate | redrock | forest
  accent: string; // moss | jade | sapphire | amethyst | garnet | citrine | copper
  notifications: boolean;
}

export interface PayRate {
  id: string;
  name: string;
  rate: number;
  gem: GemName;
  isBase?: boolean;
  archived?: boolean;
}

export type DayStatus =
  | 'worked'
  | 'missed' // unpaid absence
  | 'pto' // paid time off
  | 'sick' // paid sick leave
  | 'holiday'; // paid holiday (not worked)

export interface WorkSegment {
  hours: number;
  rateId: string | null; // preset rate
  rate: number | null; // custom rate when rateId is null
}

/** An override for one calendar day. Days without an override use the default schedule. */
export interface WorkDay {
  id: ISODate;
  date: ISODate;
  status: DayStatus;
  segments: WorkSegment[]; // for 'worked' (can be split across rates)
  paidHours: number; // for pto/sick/holiday
  workedHoliday?: boolean; // worked a holiday Pebbles doesn't know about -> holiday multiplier applies
  start?: string | null; // this shift's own start time ('21:30'), when it differs from usual
  end?: string | null; // and end time ('04:00')
  note: string;
}

export interface PaycheckRecord {
  id: ISODate; // period start
  periodStart: ISODate;
  payday: ISODate;
  estimatedNet: number; // what Pebbles showed (after calibration)
  estimatedNetRaw?: number; // before calibration: used to learn the gap
  estimatedGross: number;
  actualNet: number | null;
  actualGross: number | null;
  received: boolean;
  savingsOverride: number | null; // you moved the savings slider for this check
  split: { bills: number; essentials: number; savings: number; personal: number } | null;
  goalAllocations: { goalId: string; amount: number }[];
  depositPending?: boolean; // the bank still shows the deposit as pending
  note: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'other';
  institution?: string;
  mask?: string;
  balance?: number | null; // current balance, when known
  available?: number | null;
  balanceDate?: ISODate | null;
  apy?: number | null; // savings interest rate, e.g. 3.65 (%)
  holdsGoals?: boolean; // this savings account is where your goals live (e.g. Marcus)
  source?: 'import' | 'plaid';
  plaidAccountId?: string;
  linkId?: string;
}

/** A bank connected through Plaid. */
export interface BankLink {
  id: string; // Plaid item_id
  institution: string;
  institutionId: string;
  accessToken: string;
  cursor: string | null;
  createdAt: number;
  lastSync: number | null;
  error: string | null;
}

export type GroceryDept =
  | 'produce'
  | 'meat'
  | 'dairy'
  | 'bakery'
  | 'pantry'
  | 'frozen'
  | 'snacks'
  | 'drinks'
  | 'alcohol'
  | 'household'
  | 'personal'
  | 'baby'
  | 'pet'
  | 'fuel' // gas for the car
  | 'tobacco' // cigarettes, vapes, nicotine pouches
  | 'prepared' // hot food, fountain drinks, deli counter
  | 'lottery'
  | 'auto' // oil, washer fluid, car wash
  | 'other';

export interface ReceiptItem {
  raw: string; // as printed
  name: string; // cleaned
  key: string; // for matching the same product across trips
  price: number; // what you paid for the line, after any discount
  qty: number; // how many you bought (3 cans)
  dept: GroceryDept;
  lowConfidence?: boolean;
  desc?: string; // the full name as the store wrote it ("Kroger Classic Blend Medium Roast Ground Coffee, 29 oz")
  pack?: number | null; // how many in one package (a dozen eggs = 12, 6 ct muffins = 6)
  regular?: number | null; // shelf price for one, before the deal
  deal?: Deal | null;
  upc?: string | null;
}

/** A sale, coupon or buy-one-get-one on a receipt line. */
export interface Deal {
  kind: 'sale' | 'coupon' | 'bogo' | 'free';
  saved: number;
  note?: string;
}

export interface Receipt {
  id: string;
  store: string;
  date: ISODate;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  savings: number | null; // store discounts printed on the receipt
  fees?: number | null; // delivery / service fees and tip (online orders)
  discount?: number | null; // coupons off the whole order (not one item)
  source: 'photo' | 'pdf' | 'text';
  createdAt: number;
  fuel?: { gallons: number; perGallon: number; grade: string } | null; // gas pump line, when there is one
}

/** Something you keep at home. Pebbles tracks it three ways: */
export interface PantryItem {
  id: string;
  name: string;
  key: string; // matches receipt item keys, so receipts restock it
  dept: GroceryDept;
  mode: 'count' | 'amount' | 'level'; // 12 eggs · 2.5 lb rice · milk: full/half/low/out
  qty: number; // on hand (count and amount)
  unit: string; // 'ct', 'lb', 'oz', 'gal', 'can', 'bag'…
  perBuy: number; // how much one purchase adds (a dozen eggs = 12)
  lowAt: number; // on the list at or below this (count and amount)
  level: 'full' | 'half' | 'low' | 'out'; // level mode
  lastBought: ISODate | null;
  archived?: boolean;
  desc?: string; // the full product name, from the receipt or barcode ("Folgers Classic Roast Ground Coffee")
  always?: boolean; // a staple: something you always get (milk, bread, coffee)
  stapleId?: string | null; // swaps with similar things in a group, e.g. pizza rolls → "Air Fryer Frozen Food"
}

/** A group of similar things that swap for each other, whichever you grab: "Air Fryer Frozen Food". */
export interface Staple {
  id: string;
  name: string;
  keywords: string[]; // items whose names include one of these count (lowercase)
  examples: string[]; // what you've bought for it, e.g. "Pizza Rolls", "Popcorn Chicken"
  createdAt: number;
}

export interface RecipeIngredient {
  name: string; // "Rice"
  match: string[]; // pantry names that count: ["rice"]
  not?: string[]; // ...unless they also say one of these: ["krispies"]
  optional?: boolean;
  qty?: string; // "2 cups"
  uses?: number; // how many of a counted item one batch uses (3 eggs, 4 tortillas)
}

/** A recipe (built in, or your own). */
export interface Recipe {
  id: string;
  name: string;
  minutes: number;
  servings: number;
  tags: string[]; // 'air fryer', 'meal prep', 'quick', 'breakfast', 'freezer', 'no cook'
  ingredients: RecipeIngredient[];
  steps: string[];
  custom?: boolean;
  hidden?: boolean; // a built-in recipe you don't want to see
}

/** This week's meal prep: recipes and how many batches. */
export interface MealPlanEntry {
  id: string; // recipe id
  batches: number;
  addedAt: number;
  cookedAt?: number | null;
}

/** A shopping-list line you added yourself (low pantry items are added automatically). */
export interface ShopItem {
  id: string;
  name: string;
  key: string;
  qty: number;
  pantryId: string | null;
  done: boolean;
  doneAt: number | null;
  addedAt: number;
}

/** An odometer reading (and maybe a fill-up) from your car. */
export interface DriveEntry {
  id: string;
  date: ISODate;
  at: number; // when you logged it (ms)
  odometer: number; // miles on the car
  dashMpg?: number | null; // the car's own average mpg readout, if you have one
  gallons?: number | null; // filled up: how many gallons
  perGallon?: number | null;
  full?: boolean; // filled to full (needed for exact mpg)
  note?: string;
}

/** A gas price you paid or saw. */
export interface GasPrice {
  id: string;
  station: string;
  stationId: string | null; // OpenStreetMap or Google place id
  lat: number | null;
  lon: number | null;
  perGallon: number;
  grade: string;
  date: ISODate;
  source: 'receipt' | 'manual' | 'google' | 'screenshot';
  areaAvg?: number | null; // the Colorado average that week, to learn how this station compares
}

export interface ItemRule {
  id: string; // item key
  name: string;
  dept: GroceryDept;
}

export interface PaystubLine {
  label: string;
  kind: 'federal' | 'social_security' | 'medicare' | 'state' | 'famli' | 'local' | 'pretax' | 'posttax' | 'other';
  current: number;
  ytd: number | null;
  lowConfidence?: boolean;
}

export interface Paystub {
  id: string;
  payDate: ISODate | null;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  gross: number | null;
  net: number | null;
  lines: PaystubLine[];
  hours: { label: string; hours: number; rate: number | null; amount: number }[];
  ytdGross: number | null;
  createdAt: number;
}

/** A store price for one of your usual grocery items. */
export interface StorePrice {
  id: string; // item key
  store: string;
  description: string;
  regular: number | null;
  promo: number | null;
  size: string;
  fetchedAt: number;
}

/** Payday checklist state ("move $280 to Marcus"). */
export interface MoveState {
  id: string; // `${periodStart}:${move}`
  done: boolean;
  at: number;
  auto: boolean; // checked off automatically from bank data
  amount?: number; // for a move whose amount is worked out once (what was left over last check)
}

export interface Transaction {
  id: string; // stable hash for de-duplication
  accountId: string;
  date: ISODate;
  description: string;
  merchant: string;
  amount: number; // + money in, - money out
  category: string;
  importId: string | null;
  excluded: boolean; // transfers between own accounts etc.
  note: string;
  pending?: boolean;
  source?: 'import' | 'plaid';
  dupOf?: string; // the same purchase seen in another account (e.g. USAA's line for a PayPal purchase)
  // a PayPal purchase: the paying bank account as Pebbles first saw it, to tell when the bank has taken it out
  seenBank?: { accountId: string; available: number; known: number } | null;
  bankHas?: boolean; // you said the bank already took this PayPal purchase out
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: number;
  accountId: string;
  count: number;
  from: ISODate | null;
  to: ISODate | null;
}

export interface CategoryRule {
  id: string;
  pattern: string; // case-insensitive substring of description
  category: string;
  createdAt: number;
}

export type BillFrequency = 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'biweekly';

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDay: number; // day of month (monthly/quarterly/yearly) or anchor
  dueMonth: number | null; // 1-12 for yearly/quarterly anchor
  anchorDate: ISODate | null; // weekly/biweekly anchor
  frequency: BillFrequency;
  category: string;
  autopay: boolean;
  active: boolean;
  matchPattern: string; // to auto-recognize payments in statements
  yourSharePct?: number | null; // split with a roommate: the % that's yours (null = all yours)
  fromRent?: boolean; // the roommate's share comes out of what you send them for rent
  toRoommate?: boolean; // you pay this to your roommate (e.g. rent by Venmo)
  amountReminder?: import('./billPrompt').AmountReminder | null; // ask for the new amount each month (utilities)
}

export type GemName =
  | 'quartz'
  | 'amethyst'
  | 'citrine'
  | 'jade'
  | 'sapphire'
  | 'garnet'
  | 'topaz'
  | 'obsidian'
  | 'agate'
  | 'emerald'
  | 'alexandrite'
  | 'aquamarine'
  | 'peridot'
  | 'rose_quartz'
  | 'ruby';

export interface Goal {
  id: string;
  name: string;
  target: number;
  targetDate: ISODate | null;
  image: string | null; // data URL (compressed)
  gem: GemName;
  priority: 1 | 2 | 3; // 3 = high
  isEmergency: boolean;
  autoTarget?: boolean; // emergency fund: Pebbles raises the target step by step (default on)
  boost?: number; // "Reach It Sooner": extra per paycheck, taken from spending money, straight to this goal
  createdAt: number;
  completedAt: number | null;
  archived: boolean;
  note: string;
}

export interface Contribution {
  id: string;
  goalId: string;
  amount: number; // negative = withdrawal
  date: ISODate;
  note: string;
  paycheckId: string | null;
  kind?: 'deposit' | 'interest' | 'withdrawal';
}

export interface MarketData {
  id: 'market';
  gas: { price: number; region: string; asOf: string; source: string; previous: number | null } | null;
  foodCpi: { index: number; yoyPct: number; asOf: string; region: string; source: string } | null;
  staples: { item: string; price: number; unit: string; asOf: string; previous: number | null }[];
  fetchedAt: number;
  manualGasPrice: number | null;
  errors: string[];
}

export interface Meta {
  id: string;
  value: unknown;
}

export interface CollectionMap {
  settings: Settings;
  rates: PayRate;
  workdays: WorkDay;
  paychecks: PaycheckRecord;
  accounts: Account;
  transactions: Transaction;
  imports: ImportBatch;
  rules: CategoryRule;
  bills: Bill;
  goals: Goal;
  contributions: Contribution;
  market: MarketData;
  taxrules: { id: string; json: string; version: string; fetchedAt: number };
  dismissed: { id: string; at: number };
  links: BankLink;
  receipts: Receipt;
  itemrules: ItemRule;
  paystubs: Paystub;
  prices: StorePrice;
  moves: MoveState;
  guidelines: { id: string; json: string; version: string; fetchedAt: number };
  pantry: PantryItem;
  shoplist: ShopItem;
  gasprices: GasPrice;
  staples: Staple;
  recipes: Recipe;
  mealplan: MealPlanEntry;
  drives: DriveEntry;
  barcodes: import('./barcodes').SavedBarcode;
}

export type CollectionName = keyof CollectionMap;

export const COLLECTIONS: CollectionName[] = [
  'settings',
  'rates',
  'workdays',
  'paychecks',
  'accounts',
  'transactions',
  'imports',
  'rules',
  'bills',
  'goals',
  'contributions',
  'market',
  'taxrules',
  'dismissed',
  'links',
  'receipts',
  'itemrules',
  'paystubs',
  'prices',
  'moves',
  'guidelines',
  'pantry',
  'shoplist',
  'gasprices',
  'staples',
  'recipes',
  'mealplan',
  'drives',
  'barcodes',
];

/** A record as stored and synced. */
export interface SyncRecord {
  key: string; // `${collection}:${id}`
  collection: CollectionName;
  id: string;
  updatedAt: number;
  deviceId: string;
  deleted: boolean;
  data: unknown;
}
