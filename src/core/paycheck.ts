import { parts } from './dates';
import { computeGross, periodByIndex, type GrossResult, type Period } from './pay';
import { computeWithholding, type WithholdingResult } from './tax';
import { rulesForYear, type TaxRulesFile } from './taxrules';
import type { ISODate, PayRate, Settings, WorkDay } from './types';

export interface PaycheckEstimate {
  period: Period;
  gross: GrossResult;
  withholding: WithholdingResult;
  net: number;
  taxYear: number;
  rulesYearUsed: number;
  rulesExact: boolean;
  rulesStatus: 'final' | 'provisional';
}

/** Rough year-to-date FICA wages before this payday, assuming a normal schedule. */
function estimateYtd(period: Period, settings: Settings): number {
  const year = parts(period.payday).y;
  let count = 0;
  let p = periodByIndex(settings.pay, period.index - 1);
  while (parts(p.payday).y === year && count < 30) {
    count++;
    p = periodByIndex(settings.pay, p.index - 1);
  }
  const typical = settings.pay.hoursPerDay * settings.pay.workDays.length * 2 * settings.pay.baseRate;
  return count * typical;
}

export function estimatePaycheck(
  period: Period,
  settings: Settings,
  rates: PayRate[],
  workdays: Map<ISODate, WorkDay> | Record<string, WorkDay>,
  rulesFile: TaxRulesFile,
  calibration = 0,
): PaycheckEstimate {
  const gross = computeGross(period, settings.pay, rates, workdays);
  const year = parts(period.payday).y; // taxes follow the date you're paid
  const r = rulesForYear(rulesFile, year);
  const withholding = computeWithholding(gross.gross, settings, r.rules, { ficaWages: estimateYtd(period, settings) });
  if (!r.exact) withholding.warnings.push(`Using ${r.year} tax tables until ${year} tables are downloaded.`);
  const net = Math.round((withholding.net + calibration) * 100) / 100;
  return {
    period,
    gross,
    withholding,
    net,
    taxYear: year,
    rulesYearUsed: r.year,
    rulesExact: r.exact,
    rulesStatus: r.rules.status,
  };
}
