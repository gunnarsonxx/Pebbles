import { useMemo, useSyncExternalStore } from 'react';
import { store } from './store';
import { syncClient } from './syncClient';
import { normalizeSettings } from '../core/defaults';
import { today as todayISO, parts, diffDays, addDays } from '../core/dates';
import { computeGross, resolveDay, periodByIndex, periodContaining, upcomingPayPeriod, type Period } from '../core/pay';
import { calibrationFrom, estimatePaycheck, type PaycheckEstimate } from '../core/paycheck';
import { BUNDLED_RULES, isValidRulesFile, newerVersion, rulesForYear, type TaxRulesFile } from '../core/taxrules';
import { monthlyBillsTotal, buildPlan, estimateEssentials, goalBalance, totalSaved, type EssentialsEstimate, type PaycheckPlan } from '../core/budget';
import { generateInsights, type Insight } from '../core/insights';
import { overtimeDeductionEstimate } from '../core/tax';
import type { Bill, Contribution, Goal, ISODate, MarketData, PaycheckRecord, PayRate, Settings, Transaction, WorkDay, Account, CategoryRule, ImportBatch, BankLink, Receipt, ItemRule, Paystub, StorePrice } from '../core/types';
import { analyzeGroceries, monthlyGroceryNeed, type GroceryStats } from '../core/groceries';
import { BUNDLED_GUIDELINES, checkGuidelines, isValidGuidelines, type GuidelineCheck, type GuidelinesFile } from '../core/guidelines';
import { goalsAccount, interestNextMonth, reconcile, type Reconcile } from '../core/savingsAccount';
import { paydayMoves, type Move } from '../core/moves';
import { threePaycheckMonths } from '../core/budget';
import type { DriveEntry, GasPrice, MealPlanEntry, PantryItem, Recipe, ShopItem, Staple } from '../core/types';
import { paypalFundingAccount, paypalInFlight, withInFlight, type InFlight } from '../core/paypal';
import { drivingStats, trustworthy, type DrivingStats } from '../core/driving';
import { emergencyStatus, type EmergencyStatus } from '../core/emergency';
import { billsAccount, coverage, spendingAccount, type Coverage } from '../core/coverage';

export function useVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}

export function useSync() {
  return useSyncExternalStore(syncClient.subscribe, syncClient.getState);
}

export interface AppData {
  version: number;
  today: ISODate;
  settings: Settings;
  rates: PayRate[];
  workdays: Map<ISODate, WorkDay>;
  bills: Bill[];
  goals: Goal[];
  contributions: Contribution[];
  txns: Transaction[];
  accounts: Account[];
  rules: CategoryRule[];
  imports: ImportBatch[];
  paychecks: Map<string, PaycheckRecord>;
  market: MarketData | null;
  rulesFile: TaxRulesFile;
  calibration: number;
  upcoming: PaycheckEstimate;
  afterUpcoming: Period;
  current: Period;
  essentials: EssentialsEstimate;
  plan: PaycheckPlan;
  insights: Insight[];
  balances: Map<string, number>;
  saved: number;
  otPremiumYtd: number;
  otTaxSaved: number;
  dismissed: Set<string>;
  links: BankLink[];
  receipts: Receipt[];
  itemRules: ItemRule[];
  paystubs: Paystub[];
  prices: Map<string, StorePrice>;
  groceries: GroceryStats | null;
  guidelines: GuidelinesFile;
  guidelineChecks: GuidelineCheck[];
  goalsAccount: Account | null;
  interestMonthly: number;
  reconcile: Reconcile | null;
  movesFor: { period: Period; estimate: PaycheckEstimate; plan: PaycheckPlan; moves: Move[]; isPast: boolean } | null;
  coverage: Coverage;
  drives: DriveEntry[];
  driving: DrivingStats | null;
  inFlight: InFlight | null; // PayPal purchases your bank's balance doesn't show yet
  paypalFrom: Account | null;
  emergency: EmergencyStatus | null;
  pantry: PantryItem[];
  shoplist: ShopItem[];
  staples: Staple[];
  customRecipes: Recipe[];
  mealPlan: MealPlanEntry[];
  gasPrices: GasPrice[];
}

export function effectiveRules(): TaxRulesFile {
  const rec = store.get('taxrules', 'current');
  if (rec) {
    try {
      const parsed = JSON.parse(rec.json);
      if (isValidRulesFile(parsed) && !newerVersion(BUNDLED_RULES.version, parsed.version)) return parsed;
    } catch {
      /* fall back */
    }
  }
  return BUNDLED_RULES;
}


export function effectiveGuidelines(): GuidelinesFile {
  const rec = store.get('guidelines', 'current');
  if (rec) {
    try {
      const parsed = JSON.parse(rec.json);
      if (isValidGuidelines(parsed) && !newerVersion(BUNDLED_GUIDELINES.version, parsed.version)) return parsed;
    } catch {
      /* fall back */
    }
  }
  return BUNDLED_GUIDELINES;
}

export function useData(): AppData {
  const version = useVersion();
  const today = todayISO();
  return useMemo(() => computeData(version, today), [version, today]);
}

export function computeData(version: number, today: ISODate): AppData {
  const settings = normalizeSettings(store.get('settings', 'settings'));
  const rates = store.list('rates').filter((r) => !r.archived);
  const workdays = new Map(store.list('workdays').map((w) => [w.date, w]));
  const bills = store.list('bills');
  const goals = store.list('goals').sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  const contributions = store.list('contributions');
  const txns = store.list('transactions').sort((a, b) => b.date.localeCompare(a.date));
  const accounts = store.list('accounts');
  const rules = store.list('rules');
  const imports = store.list('imports').sort((a, b) => b.importedAt - a.importedAt);
  const paycheckList = store.list('paychecks');
  const paychecks = new Map(paycheckList.map((p) => [p.id, p]));
  const market = store.get('market', 'market') ?? null;
  const rulesFile = effectiveRules();
  const calibration = calibrationFrom(paycheckList);
  const dismissed = new Set(store.list('dismissed').map((d) => d.id));

  const upPeriod = upcomingPayPeriod(settings.pay, today);
  const upcoming = estimatePaycheck(upPeriod, settings, rates, workdays, rulesFile, calibration);
  const afterUpcoming = periodByIndex(settings.pay, upPeriod.index + 1);
  const current = periodContaining(settings.pay, today);
  const receipts = store.list('receipts').sort((a, b) => b.date.localeCompare(a.date));
  const groceries = analyzeGroceries(receipts, today);
  const need = monthlyGroceryNeed(groceries);
  // the gas price you actually pay (your receipts and logged prices, last 30 days) beats the state average
  const gasPrices = store.list('gasprices').sort((a, b) => b.date.localeCompare(a.date));
  // what you paid: gas receipts and prices you logged, plus fill-ups in your driving log
  const paid = [
    ...gasPrices.filter((g) => g.source !== 'google' && diffDays(today, g.date) <= 30).map((g) => g.perGallon),
    ...store.list('drives').filter((d) => d.perGallon && diffDays(today, d.date) <= 30).map((d) => d.perGallon as number),
  ];
  const paidGas = paid.length ? Math.round((paid.reduce((s, v) => s + v, 0) / paid.length) * 1000) / 1000 : null;
  const marketForBudget = paidGas && !market?.manualGasPrice ? ({ ...(market ?? { id: 'market', gas: null, foodCpi: null, staples: [], fetchedAt: 0, errors: [] }), manualGasPrice: paidGas } as MarketData) : market;
  // your car: odometer readings and fill-ups
  const drives = store.list('drives');
  // days you worked (your schedule, plus any days you changed), to compare driving on work days vs off
  const workDates = new Set<string>();
  for (let k = 0; k <= 120; k++) {
    const d = addDays(today, -k);
    if (resolveDay(d, settings.pay, rates, workdays.get(d)).status === 'worked') workDates.add(d);
  }
  const driving = drivingStats(drives, today, workDates);
  const essentials = estimateEssentials(
    settings,
    txns,
    marketForBudget,
    today,
    need && groceries
      ? {
          monthly: need,
          reason: `What you need each month, from ${groceries.trips} receipt${groceries.trips === 1 ? '' : 's'} (${groceries.tripsPerMonth.toFixed(1)} trips a month${groceries.taxRate ? `, ${(groceries.taxRate * 100).toFixed(1)}% tax` : ''})`,
        }
      : null,
    trustworthy(driving) ? { milesPerMonth: driving.milesPerMonth, mpg: driving.mpg, days: driving.days } : null,
  );
  // Bills account vs Spending account: what's due through the check after next, and what's yours
  // PayPal purchases the bank's balance doesn't show yet come off the account PayPal pulls from
  const rawBills = billsAccount(accounts, settings.budget.billsAccountId);
  const paypalFrom = paypalFundingAccount(accounts, txns, settings.budget.paypalFromAccountId, spendingAccount(accounts, settings.budget.spendingAccountId, rawBills) ?? rawBills);
  const inFlight = paypalInFlight(txns, accounts, paypalFrom, today);
  const planAccounts = withInFlight(accounts, inFlight);
  const bAcct = billsAccount(planAccounts, settings.budget.billsAccountId);
  const nextPayday = upPeriod.payday >= today ? upPeriod.payday : afterUpcoming.payday;
  const followingPayday = periodByIndex(settings.pay, upPeriod.index + (nextPayday === upPeriod.payday ? 1 : 2)).payday;
  const cov = coverage({
    billsAccount: bAcct,
    spendingAccount: spendingAccount(planAccounts, settings.budget.spendingAccountId, bAcct),
    bills,
    txns,
    today,
    nextPayday,
    followingPayday,
    essentialsMonthly: essentials.totalMonthly,
  });
  // only once you've told Pebbles which account is bills-only; otherwise the old "share of bills" plan
  // before the check: what it has to add for bills through the check after it; after it landed: what's still missing
  const topUpFor = (payday: string) =>
    !settings.budget.billsAccountId || !cov.bills ? null : payday === nextPayday ? cov.bills.topUp : payday < today ? Math.ceil(cov.bills.shortNow / 5) * 5 : null;
  // ONE plan for the next paycheck, used by every card: the recorded stub pay when there is one, else the estimate
  const upRecord = paychecks.get(upPeriod.start);
  const plan = buildPlan({
    settings,
    net: upRecord?.actualNet ?? upcoming.net,
    payday: upPeriod.payday,
    nextPayday: afterUpcoming.payday,
    bills,
    essentials,
    goals,
    // money this check already put into goals doesn't change its own plan
    contributions: contributions.filter((c) => c.paycheckId !== upPeriod.start),
    savingsOverride: upRecord?.savingsOverride ?? null,
    billsTopUp: topUpFor(upPeriod.payday),
  });

  const balances = new Map(goals.map((g) => [g.id, goalBalance(g.id, contributions)]));
  const saved = totalSaved(goals, contributions);

  // overtime premium so far this calendar year (for the "no tax on overtime" note)
  const year = parts(today).y;
  let otPremiumYtd = 0;
  let annualGross = 0;
  for (let i = upPeriod.index - 30; i <= upPeriod.index; i++) {
    const p = periodByIndex(settings.pay, i);
    if (parts(p.payday).y !== year) continue;
    const g = computeGross(p, settings.pay, rates, workdays);
    otPremiumYtd += g.otPremium;
    annualGross += g.gross;
  }
  const yrRules = rulesForYear(rulesFile, year).rules;
  const annualized = annualGross > 0 ? annualGross : upcoming.gross.gross * 26;
  const ot = overtimeDeductionEstimate(otPremiumYtd, annualized, settings, yrRules);

  const upcomingPaydays = Array.from({ length: 14 }, (_, k) => periodByIndex(settings.pay, upPeriod.index + k).payday);
  const insights = generateInsights({
    settings,
    txns,
    bills,
    goals,
    contributions,
    market,
    asOf: today,
    netPerPaycheck: upcoming.net,
    upcomingPaydays,
    otPremiumYtd,
    otTaxSaved: ot.taxSaved,
  }).filter((n) => !dismissed.has(n.id));

  // savings account (e.g. Marcus) and guidelines
  const gAcct = goalsAccount(accounts);
  const guidelines = effectiveGuidelines();
  const emergency = goals.find((g) => g.isEmergency && !g.archived);
  const retirementPerCheck = upcoming.withholding.preTax
    .filter((d) => d.kind === 'traditional_401k')
    .concat(upcoming.withholding.postTax.filter((d) => d.kind === 'roth_401k'))
    .reduce((x, d) => x + d.amount, 0);
  const guidelineChecks = checkGuidelines({
    g: guidelines,
    plan,
    grossPerCheck: upcoming.gross.gross,
    retirementPerCheck,
    emergencyBalance: emergency ? (balances.get(emergency.id) ?? 0) : null,
    essentials,
    bills,
  });

  // payday moves: the most recent payday (for ~10 days after it), else the next one
  const movesState = new Map(store.list('moves').map((m) => [m.id, m]));
  let movesFor: AppData['movesFor'] = null;
  const prevPeriod = periodByIndex(settings.pay, upPeriod.index - 1);
  const daysSincePrev = Math.round((Date.parse(today) - Date.parse(prevPeriod.payday)) / 86_400_000);
  // only revisit a past payday Pebbles actually tracked (recorded by you or seen in your bank)
  const usePrev = daysSincePrev >= 0 && daysSincePrev <= 10 && paychecks.has(prevPeriod.start) && !movesState.get(`${prevPeriod.start}:save`)?.done;
  const mPeriod = usePrev ? prevPeriod : upPeriod;
  const mEstimate = usePrev ? estimatePaycheck(prevPeriod, settings, rates, workdays, rulesFile, calibration) : upcoming;
  const mRecord = paychecks.get(mPeriod.start);
  const mPlan = usePrev
    ? buildPlan({
        settings,
        net: mRecord?.actualNet ?? mEstimate.net,
        payday: mPeriod.payday,
        nextPayday: upPeriod.payday,
        bills,
        essentials,
        goals,
        contributions: contributions.filter((c) => c.paycheckId !== mPeriod.start),
        savingsOverride: mRecord?.savingsOverride ?? null,
      })
    : plan;
  const bonusMonth = threePaycheckMonths(Array.from({ length: 4 }, (_, k) => periodByIndex(settings.pay, mPeriod.index - 1 + k).payday)).includes(mPeriod.payday.slice(0, 7));
  movesFor = {
    period: mPeriod,
    estimate: mEstimate,
    plan: mPlan,
    isPast: usePrev,
    moves: paydayMoves({
      period: mPeriod,
      plan: mPlan,
      goals,
      savingsName: gAcct ? (gAcct.institution && /marcus|goldman/i.test(gAcct.institution + gAcct.name) ? 'Marcus' : gAcct.name) : 'savings',
      states: movesState,
      bonusMonth,
      billsAccountName: settings.budget.billsAccountId && cov.bills ? cov.bills.account.name : null,
      billsThrough: mPeriod.payday === nextPayday ? followingPayday : nextPayday,
    }),
  };

  return {
    version,
    today,
    settings,
    rates,
    workdays,
    bills,
    goals,
    contributions,
    txns,
    accounts,
    rules,
    imports,
    paychecks,
    market,
    rulesFile,
    calibration,
    upcoming,
    afterUpcoming,
    current,
    essentials,
    plan,
    insights,
    balances,
    saved,
    otPremiumYtd,
    otTaxSaved: ot.taxSaved,
    dismissed,
    links: store.list('links'),
    receipts,
    itemRules: store.list('itemrules'),
    paystubs: store.list('paystubs').sort((a, b) => (b.payDate ?? '').localeCompare(a.payDate ?? '')),
    prices: new Map(store.list('prices').map((p) => [p.id, p])),
    groceries,
    guidelines,
    guidelineChecks,
    goalsAccount: gAcct,
    interestMonthly: interestNextMonth(gAcct?.balance ?? saved, gAcct?.apy),
    reconcile: reconcile(gAcct, saved),
    movesFor,
    coverage: cov,
    drives: [...drives].sort((a, b) => b.odometer - a.odometer || b.at - a.at),
    driving,
    inFlight,
    paypalFrom,
    emergency: emergencyStatus(emergency, emergency ? (balances.get(emergency.id) ?? 0) : 0, monthlyBillsTotal(bills) + essentials.totalMonthly, settings.budget.emergencyMonths),
    pantry: store.list('pantry').filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    shoplist: store.list('shoplist').sort((a, b) => a.addedAt - b.addedAt),
    staples: store.list('staples').sort((a, b) => a.createdAt - b.createdAt),
    customRecipes: store.list('recipes'),
    mealPlan: store.list('mealplan').sort((a, b) => a.addedAt - b.addedAt),
    gasPrices,
  };
}
