import type { IntegrationSettings, PayRate, Settings } from './types';


// Free U.S. EIA open-data key (read-only public gas prices). Your own key in Settings overrides it.
export const BUILTIN_EIA_KEY = 'CNMWTKhfFBG8krrGRmjrcrmLnQhdWt8RdJR6wRQn';

export const TAX_RULES_URL = 'https://raw.githubusercontent.com/gunnarsonxx/Pebbles/main/data/tax-rules.json';

/** Where Pebbles looks for updated data files: the main branch first, then the branch builds come from. */
export const FEED_REFS = ['main', 'claude/pebbles-money-tracking-6kk484'];
export function feedUrls(file: string, custom?: string): string[] {
  const base = FEED_REFS.map((ref) => `https://raw.githubusercontent.com/gunnarsonxx/Pebbles/${ref}/data/${file}`);
  return custom && !base.includes(custom) ? [custom, ...base] : base;
}

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
      shiftStart: null,
      shiftEnd: null,
      breakMinutes: 30,
      breakAfterMidnight: true,
      overtime: { weeklyThreshold: 40, dailyThreshold: 12, multiplier: 1.5, method: 'weighted' },
      holidayMultiplier: 1.5,
      holidays: { ids: [], observed: false, rule: 'calendar', confirmed: false },
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
      wantsMaxPct: 30,
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
      plaidClientId: '',
      plaidSecret: '',
      plaidEnv: 'production',
      krogerClientId: '',
      krogerSecret: '',
      krogerLocationId: '',
      krogerLocationName: '',
      krogerStores: [],
      zip: '80903',
      homeAddress: '',
      homeLat: null,
      homeLon: null,
      googlePlacesKey: '',
    },
    theme: 'auto',
    fire: { age: 28, retireAge: 60, invested: 0, extraMonthly: 0, matchPct: 0, returnPct: 7, inflationPct: 3, withdrawalPct: 4, annualSpending: null },
    palette: 'limestone',
    accent: 'moss',
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
    pay: { ...d.pay, ...(s.pay ?? {}), overtime: { ...d.pay.overtime, ...(s.pay?.overtime ?? {}) }, holidays: unconfirmedOff({ ...d.pay.holidays, ...(s.pay?.holidays ?? {}) }) },
    household: { ...d.household, ...(s.household ?? {}) },
    budget: { ...d.budget, ...(s.budget ?? {}) },
    integrations: { ...d.integrations, ...(s.integrations ?? {}) },
    deductions: s.deductions ?? [],
    fire: { ...d.fire, ...(s.fire ?? {}) },
  } as Settings;
}

export const BASE_RATE_ID = 'base';

export function baseRateRecord(rate: number): PayRate {
  return { id: BASE_RATE_ID, name: 'Base', rate, gem: 'quartz', isBase: true };
}

/** All King Soopers stores you picked (includes the older single-store setting). */
export function krogerStoresOf(i: IntegrationSettings): { id: string; name: string }[] {
  const list = [...(i.krogerStores ?? [])];
  if (i.krogerLocationId && !list.some((x) => x.id === i.krogerLocationId)) list.unshift({ id: i.krogerLocationId, name: i.krogerLocationName || 'King Soopers' });
  return list;
}

/** Not every job pays every holiday: nothing is automatic until you pick yours. */
function unconfirmedOff(h: Settings['pay']['holidays']): Settings['pay']['holidays'] {
  return h.confirmed ? h : { ...h, ids: [] };
}
