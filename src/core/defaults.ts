import type { PayRate, Settings } from './types';

export const TAX_RULES_URL = 'https://raw.githubusercontent.com/gunnarsonxx/Pebbles/main/data/tax-rules.json';

export function defaultSettings(): Settings {
  return {
    id: 'settings',
    onboarded: false,
    name: '',
    filingStatus: 'single',
    w4: {
      step2MultipleJobs: false,
      childrenUnder17: 0,
      otherDependents: 0,
      otherIncome: 0,
      deductions: 0,
      extraWithholding: 0,
    },
    stateTax: {
      state: 'CO',
      city: 'Colorado Springs',
      county: 'El Paso',
      dr0004Allowance: null,
      extraWithholding: 0,
      customFlatRate: null,
      famliEnabled: true,
      localTax: null,
    },
    deductions: [],
    pay: {
      frequency: 'biweekly',
      periodAnchor: '2026-11-08', // a Sunday; changed during setup
      paydayOffset: 6, // following Friday
      baseRate: 20,
      hoursPerDay: 8,
      workDays: [1, 2, 3, 4, 5],
      overtime: { weeklyThreshold: 40, dailyThreshold: 12, multiplier: 1.5, method: 'weighted' },
      holidayMultiplier: 1.5,
    },
    household: {
      adults: 1,
      children: 0,
      seniors: 0,
      foodPlan: 'low',
      vehicleMpg: 25,
      milesPerMonth: 900,
      otherEssentialsMonthly: 60,
    },
    budget: {
      savingsTargetPct: 20,
      minSavingsPct: 5,
      personalFloorPct: 10,
      billsMode: 'even',
      emergencyMonths: 3,
      roundTo: 5,
    },
    integrations: {
      eiaApiKey: '',
      taxRulesUrl: TAX_RULES_URL,
      autoUpdate: true,
    },
    theme: 'auto',
    notifications: true,
  };
}

/** Fill in any settings fields that were added after a record was created. */
export function normalizeSettings(s: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!s) return d;
  return {
    ...d,
    ...s,
    w4: { ...d.w4, ...(s.w4 ?? {}) },
    stateTax: { ...d.stateTax, ...(s.stateTax ?? {}) },
    pay: { ...d.pay, ...(s.pay ?? {}), overtime: { ...d.pay.overtime, ...(s.pay?.overtime ?? {}) } },
    household: { ...d.household, ...(s.household ?? {}) },
    budget: { ...d.budget, ...(s.budget ?? {}) },
    integrations: { ...d.integrations, ...(s.integrations ?? {}) },
    deductions: s.deductions ?? [],
  } as Settings;
}

export const BASE_RATE_ID = 'base';

export function baseRateRecord(rate: number): PayRate {
  return { id: BASE_RATE_ID, name: 'Base', rate, gem: 'quartz', isBase: true };
}
