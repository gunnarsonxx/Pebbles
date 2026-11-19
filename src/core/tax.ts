// Paycheck withholding estimates.
// Federal: IRS Pub 15-T percentage method for 2020+ Forms W-4 (annualize, subtract the
//   standard deduction built into the tables, apply brackets, subtract Step 3 credits).
// FICA: Social Security (to the wage base) + Medicare (+ additional Medicare over $200k).
// Colorado: DR 1098 method (annualize, subtract withholding allowance, apply rate[s]).
// Colorado FAMLI: employee share of the paid-leave premium.
import { round2 } from './money';
import type { Bracket, TaxYearRules } from './taxrules';
import type { PayrollDeduction, Settings } from './types';

export const PERIODS_PER_YEAR = 26;

export function bracketTax(taxable: number, brackets: Bracket[], scale = 1): number {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of brackets) {
    const top = upper == null ? Infinity : upper * scale;
    if (taxable <= lower) break;
    tax += (Math.min(taxable, top) - lower) * rate;
    lower = top;
  }
  return tax;
}

export function marginalRate(taxable: number, brackets: Bracket[]): number {
  for (const [upper, rate] of brackets) if (upper == null || taxable <= upper) return rate;
  return brackets[brackets.length - 1][1];
}

export interface DeductionLine {
  id: string;
  name: string;
  kind: PayrollDeduction['kind'];
  amount: number;
}

export interface TaxLine {
  key: 'federal' | 'social_security' | 'medicare' | 'state' | 'famli' | 'local';
  label: string;
  amount: number;
  detail: string;
}

export interface WithholdingResult {
  gross: number;
  preTax: DeductionLine[];
  postTax: DeductionLine[];
  federalTaxable: number;
  ficaWages: number;
  stateTaxable: number;
  taxes: TaxLine[];
  totalTaxes: number;
  totalDeductions: number;
  net: number;
  warnings: string[];
}

export interface YtdInfo {
  ficaWages: number; // year-to-date before this check
}

export function computeDeductions(gross: number, deductions: PayrollDeduction[]) {
  const pre: DeductionLine[] = [];
  const post: DeductionLine[] = [];
  for (const d of deductions) {
    const amount = round2(d.mode === 'percent' ? (gross * d.amount) / 100 : d.amount);
    if (amount <= 0) continue;
    const line = { id: d.id, name: d.name, kind: d.kind, amount };
    if (d.kind === 'roth_401k' || d.kind === 'post_tax') post.push(line);
    else pre.push(line);
  }
  return { pre, post };
}

export function federalWithholding(
  federalTaxable: number,
  settings: Settings,
  rules: TaxYearRules,
): { amount: number; detail: string; annualTaxable: number } {
  const { w4, filingStatus } = settings;
  const fed = rules.federal;
  const annualWages = federalTaxable * PERIODS_PER_YEAR + (w4.otherIncome || 0) - (w4.deductions || 0);
  const step2 = w4.step2MultipleJobs;
  const std = fed.standardDeduction[filingStatus] / (step2 ? 2 : 1);
  const annualTaxable = Math.max(0, annualWages - std);
  const tax = bracketTax(annualTaxable, fed.brackets[filingStatus], step2 ? 0.5 : 1);
  const credits = (w4.childrenUnder17 || 0) * fed.childCreditPerChild + (w4.otherDependents || 0) * fed.otherDependentCredit;
  const annual = Math.max(0, tax - credits);
  const amount = round2(annual / PERIODS_PER_YEAR + (w4.extraWithholding || 0));
  const rate = marginalRate(annualTaxable, fed.brackets[filingStatus].map(([u, r]) => [u == null ? null : u * (step2 ? 0.5 : 1), r]));
  return {
    amount,
    annualTaxable,
    detail: `${Math.round(rate * 100)}% bracket · ${statusLabel(filingStatus)}${step2 ? ' · multiple jobs' : ''}`,
  };
}

export function statusLabel(s: Settings['filingStatus']): string {
  return {
    single: 'Single',
    married_joint: 'Married filing jointly',
    married_separate: 'Married filing separately',
    head_of_household: 'Head of household',
  }[s];
}

export function computeWithholding(
  gross: number,
  settings: Settings,
  rules: TaxYearRules,
  ytd: YtdInfo = { ficaWages: 0 },
): WithholdingResult {
  const warnings: string[] = [];
  const { pre, post } = computeDeductions(gross, settings.deductions);
  const preIncome = pre.reduce((s, d) => s + d.amount, 0);
  const preFica = pre.filter((d) => d.kind === 'section125' || d.kind === 'hsa').reduce((s, d) => s + d.amount, 0);
  const federalTaxable = Math.max(0, round2(gross - preIncome));
  const ficaWages = Math.max(0, round2(gross - preFica));
  const stateTaxable = federalTaxable;
  const taxes: TaxLine[] = [];

  // Federal income tax
  const fed = federalWithholding(federalTaxable, settings, rules);
  taxes.push({ key: 'federal', label: 'Federal income tax', amount: fed.amount, detail: fed.detail });

  // Social Security + Medicare
  const f = rules.fica;
  const ssRoom = Math.max(0, f.socialSecurityWageBase - ytd.ficaWages);
  const ss = round2(Math.min(ficaWages, ssRoom) * f.socialSecurityRate);
  taxes.push({ key: 'social_security', label: 'Social Security', amount: ss, detail: `${(f.socialSecurityRate * 100).toFixed(1)}%` });
  const over = Math.max(0, ytd.ficaWages + ficaWages - f.additionalMedicareThreshold) - Math.max(0, ytd.ficaWages - f.additionalMedicareThreshold);
  const medicare = round2(ficaWages * f.medicareRate + over * f.additionalMedicareRate);
  taxes.push({ key: 'medicare', label: 'Medicare', amount: medicare, detail: `${(f.medicareRate * 100).toFixed(2)}%` });

  // State
  const st = settings.stateTax;
  const stateRules = rules.states[st.state];
  if (st.customFlatRate != null && st.customFlatRate > 0 && (!stateRules || stateRules.type !== 'brackets')) {
    const amt = round2((stateTaxable * st.customFlatRate) / 100 + (st.extraWithholding || 0));
    taxes.push({ key: 'state', label: `${st.state} income tax`, amount: amt, detail: `${st.customFlatRate}% (your custom rate)` });
  } else if (stateRules?.type === 'brackets' && stateRules.brackets) {
    const annual = stateTaxable * PERIODS_PER_YEAR;
    const allowanceTable = stateRules.withholdingAllowance ?? { default: 0 };
    const allowance =
      st.dr0004Allowance != null
        ? st.dr0004Allowance
        : settings.filingStatus === 'married_joint'
          ? (allowanceTable.married_joint ?? allowanceTable.default)
          : allowanceTable.default;
    const taxable = Math.max(0, annual - allowance);
    const annualTax = bracketTax(taxable, stateRules.brackets);
    const amt = round2(annualTax / PERIODS_PER_YEAR + (st.extraWithholding || 0));
    const flat = stateRules.brackets.length === 1;
    const rate = flat ? stateRules.brackets[0][1] : marginalRate(taxable, stateRules.brackets);
    taxes.push({
      key: 'state',
      label: `${stateRules.name} income tax`,
      amount: amt,
      detail: `${(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}%${flat ? ' flat' : ' bracket'} · $${allowance.toLocaleString()} allowance`,
    });
  } else if (!stateRules) {
    warnings.push(`Pebbles doesn't have detailed ${st.state} tax tables yet. Add your state's rate under Settings → Taxes.`);
  }

  // Colorado FAMLI (or similar paid-leave premium)
  if (stateRules?.famli && st.famliEnabled) {
    const fr = stateRules.famli;
    const room = Math.max(0, fr.wageBase - ytd.ficaWages);
    const amt = round2(Math.min(ficaWages, room) * fr.employeeRate);
    taxes.push({ key: 'famli', label: 'Colorado FAMLI', amount: amt, detail: `${(fr.employeeRate * 100).toFixed(2)}% paid leave premium` });
  }

  // Local tax (e.g., Denver OPT)
  if (st.localTax && stateRules?.localTaxes?.[st.localTax]) {
    const lt = stateRules.localTaxes[st.localTax];
    const monthlyGross = (gross * PERIODS_PER_YEAR) / 12;
    if (monthlyGross >= lt.threshold) {
      const amt = round2((lt.amount * 12) / PERIODS_PER_YEAR);
      taxes.push({ key: 'local', label: lt.label, amount: amt, detail: `$${lt.amount}/month` });
    }
  }

  const totalTaxes = round2(taxes.reduce((s, t) => s + t.amount, 0));
  const totalDeductions = round2([...pre, ...post].reduce((s, d) => s + d.amount, 0));
  const net = round2(gross - totalTaxes - totalDeductions);
  return { gross: round2(gross), preTax: pre, postTax: post, federalTaxable, ficaWages, stateTaxable, taxes, totalTaxes, totalDeductions, net, warnings };
}

/**
 * "No tax on overtime" (2025–2028): qualified overtime premium is deductible on your
 * federal return. Payroll withholding doesn't include it, so it usually shows up as a refund.
 */
export function overtimeDeductionEstimate(
  otPremiumAnnual: number,
  annualGross: number,
  settings: Settings,
  rules: TaxYearRules,
): { deduction: number; taxSaved: number } {
  const od = rules.federal.overtimeDeduction;
  if (!od || otPremiumAnnual <= 0) return { deduction: 0, taxSaved: 0 };
  const joint = settings.filingStatus === 'married_joint';
  const cap = joint ? od.maxJoint : od.max;
  const start = joint ? od.phaseOutStartJoint : od.phaseOutStart;
  const reduction = Math.max(0, Math.ceil((annualGross - start) / 1000)) * od.phaseOutPer1000;
  const deduction = Math.max(0, Math.min(otPremiumAnnual, cap) - reduction);
  const taxable = Math.max(0, annualGross - rules.federal.standardDeduction[settings.filingStatus]);
  const rate = marginalRate(taxable, rules.federal.brackets[settings.filingStatus]);
  return { deduction: round2(deduction), taxSaved: round2(deduction * rate) };
}
