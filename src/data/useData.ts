import { useMemo, useSyncExternalStore } from 'react';
import { store } from './store';
import { syncClient } from './syncClient';
import { normalizeSettings } from '../core/defaults';
import { today as todayISO, parts } from '../core/dates';
import { computeGross, periodByIndex, periodContaining, upcomingPayPeriod, type Period } from '../core/pay';
import { calibrationFrom, estimatePaycheck, type PaycheckEstimate } from '../core/paycheck';
import { BUNDLED_RULES, isValidRulesFile, newerVersion, rulesForYear, type TaxRulesFile } from '../core/taxrules';
import { buildPlan, estimateEssentials, goalBalance, totalSaved, type EssentialsEstimate, type PaycheckPlan } from '../core/budget';
import { generateInsights, type Insight } from '../core/insights';
import { overtimeDeductionEstimate } from '../core/tax';
import type { Bill, Contribution, Goal, ISODate, MarketData, PaycheckRecord, PayRate, Settings, Transaction, WorkDay, Account, CategoryRule, ImportBatch, BankLink, Receipt, ItemRule, Paystub, StorePrice } from '../core/types';
import { analyzeGroceries, monthlyGroceryNeed, type GroceryStats } from '../core/groceries';
import { BUNDLED_GUIDELINES, checkGuidelines, isValidGuidelines, type GuidelineCheck, type GuidelinesFile } from '../core/guidelines';
import { goalsAccount, interestNextMonth, reconcile, type Reconcile } from '../core/savingsAccount';
import { paydayMoves, type Move } from '../core/moves';
import { threePaycheckMonths } from '../core/budget';
import { usd } from '../core/money';

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
  const essentials = estimateEssentials(
    settings,
    txns,
    market,
    today,
    need && groceries
      ? {
          monthly: need,
          reason: `Your usual trip from receipts (${usd(groceries.usualTrip, true)} × ${groceries.tripsPerMonth.toFixed(1)} trips/mo${groceries.taxRate ? `, ${(groceries.taxRate * 100).toFixed(1)}% tax` : ''})`,
        }
      : null,
  );
  const override = paychecks.get(upPeriod.start)?.savingsOverride ?? null;
  const plan = buildPlan({
    settings,
    net: upcoming.net,
    payday: upPeriod.payday,
    nextPayday: afterUpcoming.payday,
    bills,
    essentials,
    goals,
    contributions,
    savingsOverride: override,
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
    : mRecord?.actualNet != null
      ? buildPlan({ settings, net: mRecord.actualNet, payday: mPeriod.payday, nextPayday: afterUpcoming.payday, bills, essentials, goals, contributions: contributions.filter((c) => c.paycheckId !== mPeriod.start), savingsOverride: mRecord.savingsOverride })
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
  };
}
