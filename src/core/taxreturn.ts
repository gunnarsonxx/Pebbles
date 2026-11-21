// A rough look at next spring's tax return, from this year's pay stubs (their year-to-date totals) plus what the
// rest of the year's paychecks should add. Only the current calendar year counts: last year's stubs don't.
import { bracketTax } from './tax';
import type { TaxYearRules } from './taxrules';
import type { FilingStatus, Paystub } from './types';

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ReturnEstimate {
  year: number;
  stubs: number; // this year's stubs used
  throughDate: string | null; // the newest stub's pay date
  gross: number; // whole year, stubs + the rest of the year's estimates
  pretax: number; // 401(k), health insurance and other before-tax deductions
  federal: { withheld: number; owed: number; refund: number }; // refund < 0 = you'd owe
  state: { withheld: number; owed: number; refund: number } | null;
  overtimeDeduction: number;
  remainingChecks: number;
}

const sumKind = (s: Paystub, kind: string, ytd: boolean) => s.lines.filter((l) => l.kind === kind).reduce((t, l) => t + ((ytd ? l.ytd : l.current) ?? 0), 0);

/**
 * Year-to-date from the newest stub of the year when it has YTD columns (most do); otherwise this year's stubs added
 * up. Then each remaining paycheck's estimate is added, and the year is taxed with that year's brackets.
 */
export function estimateReturn(opts: {
  year: number;
  stubs: Paystub[];
  remaining: { gross: number; federal: number; state: number; pretax: number }[]; // estimates for checks still to come this year
  rules: TaxYearRules;
  filing: FilingStatus;
  state: string;
  overtimeDeduction: number;
}): ReturnEstimate | null {
  const mine = opts.stubs.filter((s) => s.payDate && Number(s.payDate.slice(0, 4)) === opts.year && s.gross != null).sort((a, b) => (a.payDate as string).localeCompare(b.payDate as string));
  if (!mine.length) return null;
  const newest = mine[mine.length - 1];
  const hasYtd = newest.ytdGross != null && newest.lines.some((l) => l.kind === 'federal' && l.ytd != null);
  const ytd = hasYtd
    ? { gross: newest.ytdGross as number, federal: sumKind(newest, 'federal', true), state: sumKind(newest, 'state', true), pretax: sumKind(newest, 'pretax', true) }
    : mine.reduce(
        (t, s) => ({ gross: t.gross + (s.gross ?? 0), federal: t.federal + sumKind(s, 'federal', false), state: t.state + sumKind(s, 'state', false), pretax: t.pretax + sumKind(s, 'pretax', false) }),
        { gross: 0, federal: 0, state: 0, pretax: 0 },
      );
  const rest = opts.remaining.reduce((t, c) => ({ gross: t.gross + c.gross, federal: t.federal + c.federal, state: t.state + c.state, pretax: t.pretax + c.pretax }), {
    gross: 0,
    federal: 0,
    state: 0,
    pretax: 0,
  });
  const gross = ytd.gross + rest.gross;
  const pretax = ytd.pretax + rest.pretax;
  const f = opts.rules.federal;
  const taxable = Math.max(0, gross - pretax - f.standardDeduction[opts.filing] - opts.overtimeDeduction);
  const fedOwed = bracketTax(taxable, f.brackets[opts.filing]);
  const fedWithheld = ytd.federal + rest.federal;
  const st = opts.rules.states[opts.state];
  // Colorado (and most flat-tax states) start from federal taxable income
  const stateOwed = st?.type === 'brackets' && st.brackets ? bracketTax(Math.max(0, gross - pretax - f.standardDeduction[opts.filing]), st.brackets) : null;
  const stateWithheld = ytd.state + rest.state;
  return {
    year: opts.year,
    stubs: mine.length,
    throughDate: newest.payDate,
    gross: r2(gross),
    pretax: r2(pretax),
    federal: { withheld: r2(fedWithheld), owed: r2(fedOwed), refund: r2(fedWithheld - fedOwed) },
    state: stateOwed != null ? { withheld: r2(stateWithheld), owed: r2(stateOwed), refund: r2(stateWithheld - stateOwed) } : null,
    overtimeDeduction: r2(opts.overtimeDeduction),
    remainingChecks: opts.remaining.length,
  };
}
