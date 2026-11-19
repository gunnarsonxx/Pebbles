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
  hoursPerDay: number; // 8
  workDays: number[]; // 0=Sun..6=Sat, default Mon-Fri
  overtime: OvertimeSettings;
  holidayMultiplier: number; // pay multiplier for working a holiday (1 = none)
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
  zip: string;
}

export interface Settings {
  id: 'settings';
  onboarded: boolean;
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
  workedHoliday?: boolean; // worked on a holiday -> holiday multiplier applies
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
  | 'other';

export interface ReceiptItem {
  raw: string; // as printed
  name: string; // cleaned
  key: string; // for matching the same product across trips
  price: number; // after any discount on that line
  qty: number;
  dept: GroceryDept;
  lowConfidence?: boolean;
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
  source: 'photo' | 'pdf' | 'text';
  createdAt: number;
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
  | 'emerald';

export interface Goal {
  id: string;
  name: string;
  target: number;
  targetDate: ISODate | null;
  image: string | null; // data URL (compressed)
  gem: GemName;
  priority: 1 | 2 | 3; // 3 = high
  isEmergency: boolean;
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
