import bundled from '../../data/tax-rules.json';
import type { FilingStatus } from './types';

export type Bracket = [number | null, number];

export interface FederalRules {
  standardDeduction: Record<FilingStatus, number>;
  brackets: Record<FilingStatus, Bracket[]>;
  childCreditPerChild: number;
  otherDependentCredit: number;
  overtimeDeduction: { max: number; maxJoint: number; phaseOutStart: number; phaseOutStartJoint: number; phaseOutPer1000: number };
}

export interface FicaRules {
  socialSecurityRate: number;
  socialSecurityWageBase: number;
  medicareRate: number;
  additionalMedicareRate: number;
  additionalMedicareThreshold: number;
}

export interface LocalTaxRule {
  type: 'monthly';
  amount: number;
  threshold: number;
  label: string;
}

export interface StateRules {
  name: string;
  type: 'none' | 'brackets';
  brackets?: Bracket[];
  withholdingAllowance?: { default: number; married_joint?: number };
  allowanceNote?: string;
  famli?: { employeeRate: number; wageBase: number };
  localTaxes?: Record<string, LocalTaxRule>;
  noLocalTaxNote?: string;
}

export interface TaxYearRules {
  status: 'final' | 'provisional';
  statusNote?: string;
  federal: FederalRules;
  fica: FicaRules;
  states: Record<string, StateRules>;
  sources: string[];
}

export interface TaxRulesFile {
  schema: number;
  version: string;
  published: string;
  about?: string;
  years: Record<string, TaxYearRules>;
}

export const BUNDLED_RULES = bundled as unknown as TaxRulesFile;

export function isValidRulesFile(x: unknown): x is TaxRulesFile {
  const f = x as TaxRulesFile;
  if (!f || typeof f !== 'object' || f.schema !== 1 || typeof f.version !== 'string' || !f.years) return false;
  return Object.values(f.years).every(
    (y) => y && y.federal && y.fica && y.states && y.federal.brackets && y.federal.standardDeduction,
  );
}

/** Compare dotted versions like 2026.11.19 */
export function newerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Pick the rules for a calendar year; falls back to the latest year available. */
export function rulesForYear(file: TaxRulesFile, year: number): { rules: TaxYearRules; year: number; exact: boolean } {
  const key = String(year);
  if (file.years[key]) return { rules: file.years[key], year, exact: true };
  const years = Object.keys(file.years)
    .map(Number)
    .sort((a, b) => a - b);
  const earlier = years.filter((y) => y <= year);
  const pick = earlier.length ? earlier[earlier.length - 1] : years[0];
  return { rules: file.years[String(pick)], year: pick, exact: false };
}

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
