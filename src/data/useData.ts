import { useMemo, useSyncExternalStore } from 'react';
import { store } from './store';
import { syncClient } from './syncClient';
import { normalizeSettings } from '../core/defaults';
import { today as todayISO, parts } from '../core/dates';
import { computeGross, periodByIndex, periodContaining, upcomingPayPeriod, type Period } from '../core/pay';
import { estimatePaycheck, type PaycheckEstimate } from '../core/paycheck';
import { BUNDLED_RULES, isValidRulesFile, newerVersion, rulesForYear, type TaxRulesFile } from '../core/taxrules';
import { buildPlan, estimateEssentials, goalBalance, totalSaved, type EssentialsEstimate, type PaycheckPlan } from '../core/budget';
import { generateInsights, type Insight } from '../core/insights';
import { overtimeDeductionEstimate } from '../core/tax';
import type { Bill, Contribution, Goal, ISODate, MarketData, PaycheckRecord, PayRate, Settings, Transaction, WorkDay, Account, CategoryRule, ImportBatch } from '../core/types';

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

/** Learn the gap between estimates and real deposits from recent paychecks. */
export function calibrationFrom(paychecks: PaycheckRecord[]): number {
  // compare with the raw estimate so the correction doesn't feed on itself
  const recent = paychecks
    .filter((p) => p.received && p.actualNet != null && (p.estimatedNetRaw ?? p.estimatedNet) > 0)
    .sort((a, b) => b.payday.localeCompare(a.payday))
    .slice(0, 3)
    .map((p) => (p.actualNet as number) - (p.estimatedNetRaw ?? p.estimatedNet));
  if (recent.length < 2) return 0;
  const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
  const spread = Math.max(...recent) - Math.min(...recent);
  // only when it's consistent (e.g. a deduction Pebbles doesn't know about)
  if (Math.abs(avg) < 1 || spread > Math.max(15, Math.abs(avg) * 0.6)) return 0;
  return Math.round(avg * 100) / 100;
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
  const essentials = estimateEssentials(settings, txns, market, today);
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
  };
}
