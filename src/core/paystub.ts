// Reading pay stubs (ADP, Paychex, Gusto, Workday, UKG and most others).
import { parseLooseDate } from './dates';
import { round2 } from './money';
import type { DeductionKind, Paystub, PaystubLine, PayrollDeduction } from './types';
import type { OcrLine } from './receipts';

const MONEY = /-?\$?\(?\d{1,3}(?:,\d{3})*\.\d{2,4}\)?/g;

function nums(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => {
    const s = m[0];
    const neg = s.startsWith('-') || s.startsWith('(');
    const v = parseFloat(s.replace(/[$,()\-]/g, ''));
    return neg ? -v : v;
  });
}

function labelOf(text: string): string {
  const i = text.search(/-?\$?\(?\d/);
  return (i > 0 ? text.slice(0, i) : text).replace(/[:.]+$/, '').trim();
}

const EARNINGS = /\b(REG(ULAR)?|OVERTIME|\bOT\b|HOLIDAY|HOL\b|PTO|SICK|VACATION|VAC\b|BONUS|SHIFT|DIFF|LEAD|TRAINING|HOURLY|SALARY|RETRO|CALL\s*BACK|ON\s*CALL)\b/i;

export function lineKind(label: string): PaystubLine['kind'] | 'gross' | 'net' | 'earning' | null {
  const u = label.toUpperCase();
  if (/NET\s*(PAY|CHECK|AMOUNT)|TAKE\s*HOME|^NET\b/.test(u)) return 'net';
  if (/GROSS/.test(u)) return 'gross';
  if (/ROTH/.test(u)) return 'posttax';
  if (/FAMLI|\bFLI\b|PFML|FAM(ILY)?\s*(MED|LEAVE)|PAID\s*LEAVE/.test(u)) return 'famli';
  if (/FED(ERAL)?\s*(INCOME|WITH|W\/?H|TAX|FIT)|\bFITW?\b|^FEDERAL|FEDERAL\s*INCOME/.test(u)) return 'federal';
  if (/SOC(IAL)?\s*SEC|OASDI|\bSS\b|FICA\s*-?\s*SS|SOCSEC|SOC\s*SEC/.test(u)) return 'social_security';
  if (/MEDICARE|\bMED\b|FICA\s*-?\s*MED|\bMEDI\b/.test(u)) return 'medicare';
  if (/\bOPT\b|OCCUP|LOCAL|CITY\s*TAX|DENVER|AURORA/.test(u)) return 'local';
  if (/\bCO\b.*(SIT|STATE|INC|W\/?H|TAX)|STATE\s*(INCOME|TAX|W\/?H)|\bSIT\b|COLORADO|\bSTATE\b/.test(u)) return 'state';
  if (/401\s*\(?K\)?|403\s*\(?B\)?|\b457\b|RETIRE|MEDICAL|DENTAL|VISION|HEALTH|\bHSA\b|\bFSA\b|SEC(TION)?\s*125|PRE-?TAX/.test(u)) return 'pretax';
  if (/UNION|DUES|GARNISH|CHILD\s*SUPPORT|LIFE\s*INS|AFTER-?TAX|LOAN|LTD|STD|DISABILITY|CHARITY/.test(u)) return 'posttax';
  if (EARNINGS.test(u)) return 'earning';
  return null;
}

export type ParsedPaystub = Omit<Paystub, 'id' | 'createdAt'> & { warnings: string[] };

export function parsePaystub(lines: OcrLine[], knownRates: number[] = []): ParsedPaystub {
  const warnings: string[] = [];
  const out: ParsedPaystub = { payDate: null, periodStart: null, periodEnd: null, gross: null, net: null, lines: [], hours: [], ytdGross: null, warnings };
  const seen = new Set<string>();
  const all = lines.map((l) => l.text).join('\n');

  const pd = all.match(/(?:pay|check|advice|deposit)\s*date[:\s]*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i);
  if (pd) out.payDate = parseLooseDate(pd[1]);
  const range = all.match(/(?:period|pay\s*period)[^0-9]{0,30}([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})\s*(?:-|to|through|thru|–)\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i);
  if (range) {
    out.periodStart = parseLooseDate(range[1]);
    out.periodEnd = parseLooseDate(range[2]);
  } else {
    const b = all.match(/(?:period\s*(?:begin(?:ning)?|start)(?:\s*date)?)[:\s]*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i);
    const e = all.match(/(?:period\s*(?:end(?:ing)?)(?:\s*date)?)[:\s]*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i);
    if (b) out.periodStart = parseLooseDate(b[1]);
    if (e) out.periodEnd = parseLooseDate(e[1]);
  }

  for (const l of lines) {
    const text = l.text.replace(/\s+/g, ' ').trim();
    const values = nums(text).filter((v) => !Number.isNaN(v));
    if (!values.length) continue;
    const label = labelOf(text);
    if (!label || /date|period|check\s*#|employee|ssn|address/i.test(label)) continue;
    const kind = lineKind(label);
    if (!kind) continue;
    const low = l.confidence < 70;
    if (kind === 'gross') {
      if (out.gross == null) {
        out.gross = Math.abs(values[values.length > 2 ? values.length - 2 : 0]);
        if (values.length >= 2) out.ytdGross = Math.abs(values[values.length - 1]);
      }
      continue;
    }
    if (kind === 'net') {
      if (out.net == null) out.net = Math.abs(values[values.length >= 2 ? values.length - 2 : 0]);
      continue;
    }
    if (kind === 'earning') {
      // [rate, hours, current, ytd] in some order: find rate × hours ≈ amount
      let found = false;
      const near = (v: number) => knownRates.some((r) => Math.abs(r - v) < 0.01);
      for (let i = 0; i < values.length && !found; i++)
        for (let j = i + 1; j < values.length && !found; j++)
          for (let k = j + 1; k < values.length && !found; k++) {
            const [a, b, c] = [values[i], values[j], values[k]];
            if (c > 0 && Math.abs(a * b - c) <= Math.max(0.05, c * 0.002)) {
              // most stubs print the rate before the hours; a known rate settles it
              const rate = near(b) && !near(a) ? b : a;
              const hours = rate === a ? b : a;
              out.hours.push({ label, hours, rate, amount: c });
              found = true;
            }
          }
      if (!found) out.hours.push({ label, hours: 0, rate: null, amount: Math.abs(values[0]) });
      continue;
    }
    const key = `${kind}:${label.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const current = Math.abs(values[0]);
    const ytd = values.length > 1 ? Math.abs(values[values.length - 1]) : null;
    out.lines.push({ label, kind, current: round2(current), ytd: ytd != null ? round2(ytd) : null, lowConfidence: low });
  }

  if (out.gross == null && out.hours.length) out.gross = round2(out.hours.reduce((s, h) => s + h.amount, 0));
  if (out.gross != null && out.net != null) {
    const ded = out.lines.reduce((s, x) => s + x.current, 0);
    if (Math.abs(out.gross - ded - out.net) > 1) {
      warnings.push(`Gross minus everything taken out is $${(out.gross - ded).toFixed(2)}, but net pay reads $${out.net.toFixed(2)}. Check the highlighted numbers.`);
      for (const x of out.lines) x.lowConfidence = true;
    }
  }
  if (out.gross == null) warnings.push('Couldn’t find gross pay. Fill it in below.');
  if (out.net == null) warnings.push('Couldn’t find net pay. Fill it in below.');
  return out;
}

/** Turn a stub's deduction lines into Pebbles paycheck deductions. */
export function deductionsFromStub(stub: Pick<Paystub, 'lines' | 'gross'>): PayrollDeduction[] {
  const gross = stub.gross ?? 0;
  return stub.lines
    .filter((l) => l.kind === 'pretax' || l.kind === 'posttax')
    .map((l, i) => {
      const u = l.label.toUpperCase();
      const kind: DeductionKind = /ROTH/.test(u)
        ? 'roth_401k'
        : /401|403|457|RETIRE/.test(u)
          ? 'traditional_401k'
          : /\bHSA\b/.test(u)
            ? 'hsa'
            : l.kind === 'pretax'
              ? 'section125'
              : 'post_tax';
      const pctValue = gross > 0 ? (l.current / gross) * 100 : 0;
      const isPct = (kind === 'traditional_401k' || kind === 'roth_401k') && gross > 0 && Math.abs(pctValue - Math.round(pctValue)) < 0.05 && Math.round(pctValue) > 0;
      return {
        id: `stub_${i}_${u.replace(/[^A-Z0-9]/g, '').slice(0, 10)}`,
        name: l.label,
        kind,
        mode: isPct ? ('percent' as const) : ('fixed' as const),
        amount: isPct ? Math.round(pctValue) : l.current,
      };
    });
}
