// DailyPay (and apps like it): taking earned pay before payday. Whatever you take comes out of the
// next paycheck, plus a fee for each instant transfer, so Pebbles counts it and only ever suggests the minimum.
import type { ISODate, Transaction } from './types';

const DAILYPAY = /DAILY ?PAY|DAYFORCE WALLET|EARNIN|PAYACTIV|BRANCH APP|INSTANT PAY ADVANCE/i;

export interface Advances {
  taken: number; // pay already taken this period (comes out of the next check)
  fees: number;
  lines: Transaction[];
}

/** Pay taken early since the last payday (deposits from DailyPay into your bank), and its fees. */
export function dailyPayAdvances(txns: Transaction[], since: ISODate, through: ISODate): Advances {
  const lines = txns.filter((t) => t.date > since && t.date <= through && DAILYPAY.test(`${t.description} ${t.merchant}`));
  const taken = lines.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const fees = lines.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  return { taken: Math.round(taken * 100) / 100, fees: Math.round(fees * 100) / 100, lines };
}

/** The least to take to cover a shortfall: whole dollars, never more than needed. */
export const minimumAdvance = (short: number) => (short > 0.005 ? Math.ceil(short) : 0);
