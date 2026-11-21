import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { store } from './store';
import { syncClient } from './syncClient';
import { normalizeSettings } from '../core/defaults';
import { today as todayISO, parts, diffDays, addDays } from '../core/dates';
import { computeGross, resolveDay, periodByIndex, periodContaining, nextUnpaidPeriod, type Period } from '../core/pay';
import { calibrationFrom, estimatePaycheck, type PaycheckEstimate } from '../core/paycheck';
import { BUNDLED_RULES, isValidRulesFile, newerVersion, rulesForYear, type TaxRulesFile } from '../core/taxrules';
import { monthlyBillsTotal, buildPlan, estimateEssentials, goalBalance, totalSaved, forecastGoals, type Forecast, type GoalForecast, type EssentialsEstimate, type PaycheckPlan } from '../core/budget';
import { generateInsights, type Insight } from '../core/insights';
import { computeWithholding, overtimeDeductionEstimate } from '../core/tax';
import type {
  Bill,
  Contribution,
  Goal,
  ISODate,
  MarketData,
  PaycheckRecord,
  PayRate,
  Settings,
  Transaction,
  WorkDay,
  Account,
  CategoryRule,
  ImportBatch,
  BankLink,
  Receipt,
  ItemRule,
  Paystub,
  StorePrice,
} from '../core/types';
import { analyzeGroceries, monthlyGroceryNeed, type GroceryStats } from '../core/groceries';
import { BUNDLED_GUIDELINES, checkGuidelines, isValidGuidelines, type GuidelineCheck, type GuidelinesFile } from '../core/guidelines';
import { goalsAccount, interestNextMonth, reconcile, type Reconcile } from '../core/savingsAccount';
import { paydayMoves, type Move } from '../core/moves';
import { threePaycheckMonths } from '../core/budget';
import { actualSplit } from '../core/actual';
import type { DriveEntry, GasPrice, MealPlanEntry, PantryItem, Recipe, ShopItem, Staple } from '../core/types';
import { paypalFundingAccount, paypalInFlight, withInFlight, type InFlight } from '../core/paypal';
import { drivingStats, trustworthy, type DrivingStats } from '../core/driving';
import { round2 } from '../core/money';
import { dailyPayAdvances, type Advances } from '../core/dailypay';
import { emergencyStatus, type EmergencyStatus } from '../core/emergency';
import { billsAccount, billsLedger, coverage, spendingAccount, steadyBillsPlan, type Coverage, type LedgerCycle } from '../core/coverage';

export function useVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}

export function useSync() {
  return useSyncExternalStore(syncClient.subscribe, syncClient.getState);
}

export interface LookAheadPlan {
  net: number;
  bills: number;
  essentials: number;
  savings: number;
  personal: number;
}
export interface LookAheadCheck {
  period: Period;
  ledger: LedgerCycle | null; // the Bills account this cycle (when you have one picked)
  average: LookAheadPlan; // your average take-home
  base: LookAheadPlan; // 80 hours at your base rate
  projected: LookAheadPlan; // this period's estimate (or what came in)
  received: boolean;
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
  /** Look back at an earlier paycheck: the plan as it was when that check came in (or rebuilt, if Pebbles didn't save one), with its moves. */
  /** every goal's saved-by date, from walking your savings forward check by check */
  goalForecast: Map<string, GoalForecast>;
  /** look ahead: every payday in a month, with the Bills account played forward and the plan at three pay levels */
  lookAhead: (month: string) => LookAheadCheck[];
  /** your savings walked forward: balance each paycheck, with goals' money coming out on their dates */
  forecast: Forecast;
  /** your usual savings per paycheck, and where the number comes from */
  savingsAvg: { perCheck: number; basis: 'deposits' | 'paychecks' | 'estimate'; count: number; avgNet?: number };
  /** the same forecast with changed goals and some extra saved each check (for trying out a choice) */
  forecastWith: (goals: Goal[], extraPerCheck: number) => Map<string, GoalForecast>;
  planFor: (index: number) => {
    period: Period;
    estimate: PaycheckEstimate;
    plan: PaycheckPlan;
    moves: Move[];
    isPast: boolean;
    saved: boolean;
    received: boolean;
    actual: { net: number; bills: number; savings: number; source: 'you' | 'bank' } | null;
  };
  coverage: Coverage;
  advances: Advances | null; // DailyPay taken since the last payday
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

/** Today's date that changes on its own at local midnight, and whenever you come back to the app. */
function useToday(): ISODate {
  const [t, setT] = useState(todayISO);
  useEffect(() => {
    const check = () => setT((cur) => (todayISO() !== cur ? todayISO() : cur));
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1).getTime() - now.getTime();
    const timer = setTimeout(check, midnight);
    // phones pause timers in the background: check again on return, and every minute while open
    const every = setInterval(check, 60_000);
    const onShow = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timer);
      clearInterval(every);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', check);
    };
  }, [t]);
  return t;
}

export function useData(): AppData {
  const version = useVersion();
  const today = useToday();
  return useMemo(() => computeData(version, today), [version, today]);
}

export function computeData(version: number, today: ISODate): AppData {
  const settings = normalizeSettings(store.get('settings', 'settings'));
  const rates = store.list('rates').filter((r) => !r.archived);
  const workdays = new Map(store.list('workdays').map((w) => [w.date, w]));
  const bills = store.list('bills');
  // the emergency fund first, then by goal date (soonest first), then undated ones by priority; finished ones last
  const goals = store
    .list('goals')
    .sort(
      (a, b) =>
        Number(!!a.completedAt) - Number(!!b.completedAt) ||
        Number(b.isEmergency) - Number(a.isEmergency) ||
        (a.targetDate && b.targetDate ? a.targetDate.localeCompare(b.targetDate) : a.targetDate ? -1 : b.targetDate ? 1 : 0) ||
        b.priority - a.priority ||
        a.createdAt - b.createdAt,
    );
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

  // the next check you haven't been paid yet: once this payday's deposit shows up (even a day or two early),
  // Pebbles moves on to the following one; otherwise it moves on when payday is over (midnight)
  const upPeriod = nextUnpaidPeriod(settings.pay, today, (start) => !!paychecks.get(start)?.received);
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
    ...store
      .list('drives')
      .filter((d) => d.perGallon && diffDays(today, d.date) <= 30)
      .map((d) => d.perGallon as number),
  ];
  const paidGas = paid.length ? Math.round((paid.reduce((s, v) => s + v, 0) / paid.length) * 1000) / 1000 : null;
  const marketForBudget =
    paidGas && !market?.manualGasPrice ? ({ ...(market ?? { id: 'market', gas: null, foodCpi: null, staples: [], fetchedAt: 0, errors: [] }), manualGasPrice: paidGas } as MarketData) : market;
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
  // "same amount every check": one steady amount that a 12-month run-through shows pays every bill on time
  const nextIdx = nextPayday === upPeriod.payday ? upPeriod.index : upPeriod.index + 1;
  const steady =
    settings.budget.billsAccountId && cov.bills && settings.budget.billsMode === 'even'
      ? steadyBillsPlan({ balance: cov.bills.balance, bills, txns, today, paydays: Array.from({ length: 28 }, (_, k) => periodByIndex(settings.pay, nextIdx + k).payday) })
      : null;
  if (cov.bills) cov.bills.steady = steady;
  const topUpFor = (payday: string) =>
    !settings.budget.billsAccountId || !cov.bills
      ? null
      : steady && (payday === nextPayday || payday < today)
        ? steady.perCheck
        : payday === nextPayday
          ? cov.bills.topUp
          : payday < today
            ? Math.ceil(cov.bills.shortNow / 5) * 5
            : null;
  // ONE plan for the next paycheck, used by every card: the recorded stub pay when there is one, else the estimate
  const upRecord = paychecks.get(upPeriod.start);
  // pay already taken early with DailyPay comes out of this check
  const advances = settings.pay.dailyPay?.enabled ? dailyPayAdvances(txns, periodByIndex(settings.pay, upPeriod.index - 1).payday, today) : null;
  const plan = buildPlan({
    settings,
    net: round2((upRecord?.actualNet ?? upcoming.net) - (advances?.taken ?? 0)),
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
  const usePrev = daysSincePrev >= -4 && daysSincePrev <= 10 && paychecks.has(prevPeriod.start) && !movesState.get(`${prevPeriod.start}:save`)?.done;
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
      billsSteady: !!steady,
      sweep: (() => {
        const st = movesState.get(`${mPeriod.start}:sweep`);
        const from = cov.spending?.account.name;
        return st?.amount && from ? { amount: st.amount, from } : null;
      })(),
    }),
  };

  const savingsName = gAcct ? (gAcct.institution && /marcus|goldman/i.test(gAcct.institution + gAcct.name) ? 'Marcus' : gAcct.name) : 'savings';
  // what really happened with a past check: what you entered, else what the bank shows moved to bills and savings
  const actualFor = (period: Period, net: number) => {
    const rec = paychecks.get(period.start);
    if (rec?.actual) return { net: rec.actual.net, bills: rec.actual.bills, savings: rec.actual.savings, source: 'you' as const };
    if (period.payday > today) return null;
    const a = actualSplit({
      txns,
      payday: period.payday,
      nextPayday: periodByIndex(settings.pay, period.index + 1).payday,
      billsAccountId: settings.budget.billsAccountId ?? null,
      savingsAccountId: gAcct?.id ?? null,
      net,
    });
    return a.bills > 0 || a.savings > 0 ? { net, bills: a.bills, savings: a.savings, source: 'bank' as const } : null;
  };
  const planFor: AppData['planFor'] = (index) => {
    const period = periodByIndex(settings.pay, index);
    if (movesFor && period.start === movesFor.period.start)
      return { ...movesFor, isPast: true, saved: !!paychecks.get(period.start)?.split, received: !!paychecks.get(period.start)?.received, actual: actualFor(period, movesFor.plan.net) };
    const rec = paychecks.get(period.start);
    const estimate = estimatePaycheck(period, settings, rates, workdays, rulesFile, calibration);
    const net = rec?.actualNet ?? estimate.net;
    const rebuilt = buildPlan({
      settings,
      net,
      payday: period.payday,
      nextPayday: periodByIndex(settings.pay, index + 1).payday,
      bills,
      essentials,
      goals,
      contributions: contributions.filter((c) => c.paycheckId !== period.start && c.date < period.payday),
      savingsOverride: rec?.savingsOverride ?? null,
    });
    // what Pebbles saved when the check came in beats a rebuild with today's numbers
    const s = rec?.split;
    const p: PaycheckPlan = s
      ? {
          ...rebuilt,
          net,
          bills: s.bills,
          essentials: s.essentials,
          savings: s.savings,
          personal: s.personal,
          available: round2(net - s.bills - s.essentials),
          personalPerDay: round2(Math.max(0, s.personal) / 14),
          savingsRate: net > 0 ? s.savings / net : 0,
          allocations: rec!.goalAllocations.length ? rec!.goalAllocations.map((a) => ({ goalId: a.goalId, amount: a.amount, reason: 'Planned then' })) : rebuilt.allocations,
          notes: [],
        }
      : rebuilt;
    const moves = paydayMoves({
      period,
      plan: p,
      goals,
      savingsName,
      states: movesState,
      bonusMonth: false,
      billsAccountName: settings.budget.billsAccountId && cov.bills ? cov.bills.account.name : null,
      billsSteady: !!steady,
    });
    return { period, estimate, plan: p, moves, isPast: true, saved: !!s, received: !!rec?.received, actual: actualFor(period, net) };
  };

  // your usual savings per paycheck, for anything that looks ahead: what you've really been depositing (once
  // there are three paychecks of it), otherwise what an average paycheck of yours saves after bills and basics
  const savingsAvg: AppData['savingsAvg'] = (() => {
    const since = addDays(today, -84);
    const deps = contributions.filter((c) => c.amount > 0 && c.kind !== 'interest' && !c.id.startsWith('bank|') && !c.id.startsWith('int|') && c.date > since && c.date <= today);
    const first = deps.reduce<string | null>((m, c) => (!m || c.date < m ? c.date : m), null);
    const periods = first ? Math.min(6, Math.max(1, Math.ceil((diffDays(today, first) + 1) / 14))) : 0;
    if (periods >= 3) return { perCheck: round2(deps.reduce((t, c) => t + c.amount, 0) / periods), basis: 'deposits', count: periods };
    const recent = paycheckList
      .filter((p) => p.received && p.actualNet != null)
      .sort((x, y) => y.payday.localeCompare(x.payday))
      .slice(0, 6);
    const avgNet = recent.length ? recent.reduce((t, p) => t + (p.actualNet as number), 0) / recent.length : upcoming.net;
    // a typical check pays its average share of the year's bills, whichever way you fund the Bills account
    // ("just what's due" makes single checks swing up and down, but over a year it's the same money)
    const typical = buildPlan({
      settings,
      net: round2(avgNet),
      payday: upPeriod.payday,
      nextPayday: afterUpcoming.payday,
      bills,
      essentials,
      goals,
      contributions,
      billsTopUp: round2((monthlyBillsTotal(bills) * 12) / 26),
    });
    return { perCheck: typical.savingsBase ?? typical.savings, basis: recent.length ? 'paychecks' : 'estimate', count: recent.length, avgNet: round2(avgNet) };
  })();
  // the emergency fund keeps stepping up (starter month, then the full fund) when it raises itself
  const emNow = emergencyStatus(emergency, emergency ? (balances.get(emergency.id) ?? 0) : 0, monthlyBillsTotal(bills) + essentials.totalMonthly, settings.budget.emergencyMonths);
  const emFull = emNow?.levels.length ? emNow.levels[emNow.levels.length - 1].amount : null;
  const forecastGoalsList = (gs: Goal[]) => gs.map((g) => (g.isEmergency && g.autoTarget !== false && emFull && emFull > g.target ? { ...g, target: emFull } : g));
  const forecastOpts = {
    contributions,
    monthlyNeeds: monthlyBillsTotal(bills) + essentials.totalMonthly,
    payday: upPeriod.payday,
    apy: gAcct?.apy ?? null,
    startBalance: gAcct?.balance ?? undefined,
  };
  const forecast = forecastGoals({
    ...forecastOpts,
    goals: forecastGoalsList(goals),
    firstAllocations: plan.allocations,
    firstAmount: plan.savings,
    savingsPerCheck: savingsAvg.perCheck,
    cap: Math.max(plan.savingsCap ?? plan.savings, plan.savings, savingsAvg.perCheck),
  });
  const goalForecast = forecast.byGoal;

  const forecastWith: AppData['forecastWith'] = (gs, extra) =>
    forecastGoals({
      ...forecastOpts,
      goals: forecastGoalsList(gs),
      savingsPerCheck: savingsAvg.perCheck + extra,
      cap: Math.max(plan.savingsCap ?? plan.savings, plan.savings, savingsAvg.perCheck) + extra,
    }).byGoal;

  // the Bills account played forward for about 14 months, worked out once
  let ledgerCache: LedgerCycle[] | null = null;
  const ledger = () => {
    if (ledgerCache) return ledgerCache;
    if (!settings.budget.billsAccountId || !cov.bills) return (ledgerCache = []);
    const pds = Array.from({ length: 32 }, (_, k) => periodByIndex(settings.pay, nextIdx + k).payday);
    ledgerCache = billsLedger({
      balance: cov.bills.balance,
      bills,
      txns,
      today,
      paydays: pds,
      mode: settings.budget.billsMode === 'even' ? 'even' : 'due_dates',
      perCheck: steady?.perCheck ?? round2((monthlyBillsTotal(bills) * 12) / 26),
      moveNow: Math.ceil(cov.bills.shortNow / 5) * 5,
    });
    return ledgerCache;
  };
  const avgNetAll =
    savingsAvg.avgNet ??
    (() => {
      const recent = paycheckList.filter((p) => p.received && p.actualNet != null);
      return recent.length ? round2(recent.reduce((t, p) => t + (p.actualNet as number), 0) / recent.length) : upcoming.net;
    })();
  const lookAhead: AppData['lookAhead'] = (month) => {
    const [yy, mm] = month.split('-').map(Number);
    const first = `${month}-01`;
    const lastDay = addDays(`${yy + (mm === 12 ? 1 : 0)}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-01`, -1);
    let p = periodContaining(settings.pay, addDays(first, -14));
    const out: LookAheadCheck[] = [];
    for (let k = 0; k < 6; k++, p = periodByIndex(settings.pay, p.index + 1)) {
      if (p.payday < first) continue;
      if (p.payday > lastDay) break;
      const next = periodByIndex(settings.pay, p.index + 1).payday;
      const l = ledger().find((c) => c.payday === p.payday) ?? null;
      const rec = paychecks.get(p.start);
      const est = estimatePaycheck(p, settings, rates, workdays, rulesFile, calibration);
      const base80 = round2(computeWithholding(settings.pay.baseRate * 80, settings, rulesForYear(rulesFile, Number(p.payday.slice(0, 4))).rules).net + calibration);
      const planAt = (net: number): LookAheadPlan => {
        const pl = buildPlan({ settings, net, payday: p.payday, nextPayday: next, bills, essentials, goals, contributions, ...(l ? { billsTopUp: l.deposit } : {}) });
        return { net: round2(net), bills: pl.bills, essentials: pl.essentials, savings: pl.savings, personal: pl.personal };
      };
      out.push({ period: p, ledger: l, average: planAt(avgNetAll), base: planAt(base80), projected: planAt(rec?.actualNet ?? est.net), received: !!rec?.received });
    }
    return out;
  };

  return {
    lookAhead,
    goalForecast,
    forecast,
    savingsAvg,
    forecastWith,
    planFor,
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
    advances,
    drives: [...drives].sort((a, b) => b.odometer - a.odometer || b.at - a.at),
    driving,
    inFlight,
    paypalFrom,
    emergency: emergencyStatus(emergency, emergency ? (balances.get(emergency.id) ?? 0) : 0, monthlyBillsTotal(bills) + essentials.totalMonthly, settings.budget.emergencyMonths),
    pantry: store
      .list('pantry')
      .filter((p) => !p.archived)
      .sort((a, b) => a.name.localeCompare(b.name)),
    shoplist: store.list('shoplist').sort((a, b) => a.addedAt - b.addedAt),
    staples: store.list('staples').sort((a, b) => a.createdAt - b.createdAt),
    customRecipes: store.list('recipes'),
    mealPlan: store.list('mealplan').sort((a, b) => a.addedAt - b.addedAt),
    gasPrices,
  };
}
