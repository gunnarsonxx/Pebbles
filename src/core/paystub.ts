// Reading pay stubs (ADP, Paychex, Gusto, Workday, UKG and most others).
import { addDays, parseLooseDate } from './dates';
import { round2 } from './money';
import type { DeductionKind, Paystub, PaystubLine, PayrollDeduction } from './types';
import type { OcrLine } from './receipts';
import { chunkRow } from './layout';

const MONEY = /-?\$?\(?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2,4}\)?/g;

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
  if (/NET\s*(PAY|CHECK|AMOUNT|EARNINGS|INCOME)|TAKE\s*-?\s*HOME|^NET\b|TOTAL\s*NET|DIRECT\s*DEPOSIT\s*(TOTAL|AMOUNT)/.test(u)) return 'net';
  if (/GROSS|TOTAL\s*EARNINGS|EARNINGS\s*TOTAL|TOTAL\s*PAY\b(?!.*NET)/.test(u)) return 'gross';
  if (/ROTH/.test(u)) return 'posttax';
  if (/FAMLI|\bFLI\b|PFML|FAM(ILY)?\s*(MED|LEAVE)|PAID\s*LEAVE/.test(u)) return 'famli';
  if (/FED[A-Z]*\s*(INCOME|WITH|W\/?H|TAX|FIT)|\bFITW?\b|^FEDERAL|FEDERAL\s*INCOME/.test(u)) return 'federal';
  if (/SOC(IAL)?\s*SEC|OASDI|\bSS\b|FICA\s*-?\s*SS|SOCSEC|SOC\s*SEC|^FICA$|^FICA\s*(EE|TAX|W\/?H)?$/.test(u)) return 'social_security';
  if (/MEDICARE|\bMED\b|FICA\s*-?\s*MED|\bMEDI\b/.test(u)) return 'medicare';
  if (/\bOPT\b|OCCUP|LOCAL|CITY\s*TAX|DENVER|AURORA/.test(u)) return 'local';
  if (/^CO\s*W\/?H$|^COWH$|\bCO\b.*(SIT|STATE|INC|W\/?H|TAX)|STATE\s*(INCOME|TAX|W\/?H)|\bSIT\b|COLORADO|\bSTATE\b/.test(u)) return 'state';
  if (/401\s*\(?K\)?|403\s*\(?B\)?|\b457\b|RETIRE|MEDICAL|DENTAL|VISION|HEALTH|\bHSA\b|\bFSA\b|SEC(TION)?\s*125|PRE-?TAX/.test(u)) return 'pretax';
  if (/UNION|DUES|GARNISH|CHILD\s*SUPPORT|LIFE\s*INS|AFTER-?TAX|LOAN|LTD|STD|DISABILITY|CHARITY/.test(u)) return 'posttax';
  if (EARNINGS.test(u)) return 'earning';
  return null;
}

export type ParsedPaystub = Omit<Paystub, 'id' | 'createdAt'> & { warnings: string[] };

/** Fix what the reader commonly gets wrong in amounts: S for $, stray spaces, dots as thousands separators. */
export function cleanOcrMoney(text: string): string {
  let t = text;
  // in a row of amounts, a decimal point read as a space: "1671 50" -> "1671.50", "3 20.08" -> "320.08"
  if (/\d\.\d{2}\b/.test(t)) t = t.replace(/\b(\d) (\d{2}\.\d{2})\b/g, '$1$2').replace(/\b(\d{1,4}) (\d{2})\b(?![.,]?\d)/g, '$1.$2');
  return t
    .replace(/(^|[\s(])[S§]\s?(?=\d)/g, '$1$')
    .replace(/\$\s+(?=\d)/g, '$')
    .replace(/(\d),\s+(\d{3})/g, '$1,$2')
    .replace(/\b(\d{1,3})\.(\d{3})\.(\d{2})\b/g, '$1,$2.$3')
    .replace(/(\d)\s*[.,]\s*(\d{2})\b(?![.,]\d)/g, '$1.$2');
}

const ONE_MONEY = /-?\$?\(?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2,4}\)?/;
/** Next to other amounts, a bare "2424" is almost always "24.24" with the point lost. */
function restoreDecimals(chunk: string): string {
  if (!/\d\.\d{2}\b/.test(chunk)) return chunk;
  return chunk
    .split(' ')
    .map((tok) => (/^\d{3,6}$/.test(tok) ? `${tok.slice(0, -2)}.${tok.slice(-2)}` : tok))
    .join(' ');
}

const valueOnly = (t: string) => ONE_MONEY.test(t) && t.replace(MONEY, '').replace(/[\s$|:~—–-]/g, '').length <= 2;

/** Pay apps put the label on one line and the amount on the next (or above it): join them. */
export function joinSplitLines(lines: OcrLine[]): OcrLine[] {
  const L = lines
    .map((l) => ({ ...l, text: cleanOcrMoney(l.text.replace(/[ \t]{2,}/g, '   ').trim()) }))
    .filter((l) => l.text)
    // a grid row holds several "label numbers" pieces side by side: read each on its own,
    // except header rows (no numbers), which stay whole for the header-over-amounts case
    .flatMap((l) => (ONE_MONEY.test(l.text) ? chunkRow(l.text).map((text) => ({ ...l, text: restoreDecimals(text) })) : [l]));
  const out: OcrLine[] = [];
  const used = new Set<number>();
  for (let i = 0; i < L.length; i++) {
    if (used.has(i)) continue;
    const t = L[i].text;
    const hasNum = ONE_MONEY.test(t);
    const kinds = t
      .split(/\s{2,}|\s\|\s|\t/)
      .map((x) => lineKind(x))
      .filter((k) => k && k !== 'earning');
    if (!hasNum && kinds.length >= 2 && i + 1 < L.length && valueOnly(L[i + 1].text)) {
      // a header row ("Gross Pay   Taxes   Net Pay") over a row of amounts
      const labels = t.split(/\s{2,}|\s\|\s|\t/).filter((x) => x.trim());
      const vals = [...L[i + 1].text.matchAll(MONEY)].map((m) => m[0]);
      if (vals.length === labels.length) {
        labels.forEach((lab, k) => lineKind(lab) && out.push({ text: `${lab} ${vals[k]}`, confidence: Math.min(L[i].confidence, L[i + 1].confidence) }));
        used.add(i + 1);
        continue;
      }
    }
    const kind = hasNum ? null : lineKind(t);
    if (kind && kind !== 'earning') {
      const next = L[i + 1];
      const prev = out[out.length - 1];
      if (next && valueOnly(next.text)) {
        out.push({ text: `${t} ${next.text}`, confidence: Math.min(L[i].confidence, next.confidence) });
        used.add(i + 1);
        continue;
      }
      if (prev && valueOnly(prev.text)) {
        out[out.length - 1] = { text: `${t} ${prev.text}`, confidence: Math.min(L[i].confidence, prev.confidence) };
        continue;
      }
    }
    out.push(L[i]);
  }
  return out;
}

export function parsePaystub(rawLines: OcrLine[], knownRates: number[] = []): ParsedPaystub {
  const lines = joinSplitLines(rawLines);
  const warnings: string[] = [];
  const out: ParsedPaystub = { payDate: null, periodStart: null, periodEnd: null, gross: null, net: null, lines: [], hours: [], ytdGross: null, warnings };
  const seen = new Set<string>();
  const unmatched: number[] = [];
  const all = lines.map((l) => l.text).join('\n');

  const pd = all.match(/(?:pay|check|advice|deposit)\s*date[:\s]*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i) ?? all.match(/(?:pay|check|advice|deposit)\s*date[^0-9\n]{0,30}\n[^\n]{0,40}?\b([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i);
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
              if (!out.hours.some((h) => h.label === label && h.amount === c)) out.hours.push({ label, hours, rate, amount: c });
              found = true;
            }
          }
      // a misread digit in the hours: a known rate and an amount that's a whole number of quarter hours settle it
      for (let i = 0; i < values.length && !found; i++) {
        if (!near(values[i])) continue;
        for (let k = i + 1; k < values.length && !found; k++) {
          const hrs = values[k] / values[i];
          const quarter = Math.round(hrs * 4) / 4;
          const hoursNear = values.slice(i + 1, k).some((v) => Math.abs(v - quarter) < 1);
          if (Math.abs(hrs - quarter) < 0.005 && hoursNear && !out.hours.some((h) => h.label === label && h.amount === values[k])) {
            out.hours.push({ label, hours: quarter, rate: values[i], amount: values[k] });
            found = true;
          }
        }
      }
      // one number and no rate: maybe this check's amount, maybe a year-to-date total; only a last resort for gross
      if (!found && values.length === 1) unmatched.push(Math.abs(values[0]));
      continue;
    }
    const key = `${kind}:${label.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const current = Math.abs(values[0]);
    const ytd = values.length > 1 ? Math.abs(values[values.length - 1]) : null;
    if (/^total/i.test(label)) continue;
    out.lines.push({ label, kind, current: round2(current), ytd: ytd != null ? round2(ytd) : null, lowConfidence: low });
  }

  // summary grid: "Gross Wages ... Net Pay" header with a "Current" row of amounts under it
  let taxesTotal: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (!/^\W*cur+ent\b/i.test(t)) continue;
    const vals = nums(t).map(Math.abs);
    if (vals.length < 2) continue;
    const above = lines.slice(Math.max(0, i - 4), i).map((l) => l.text).join(' ');
    if (!/gross/i.test(above) || !/net/i.test(above)) continue;
    // gross, FICA-taxable and federal-taxable wages are usually the same: take the reading most of them agree on
    const lead = vals.slice(0, Math.min(3, vals.length - 1));
    const tally = new Map<number, number>();
    lead.forEach((v) => tally.set(v, (tally.get(v) ?? 0) + 1));
    const gross = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const net = vals[vals.length - 1];
    if (out.gross == null || (tally.get(gross) ?? 0) > 1) out.gross = gross;
    if (out.net == null) out.net = net;
    if (/taxes/i.test(above) && vals.length >= 5) taxesTotal = vals[vals.length - 3];
    break;
  }
  // the date the check was paid: printed more than once and after the period
  if (!out.payDate && out.periodEnd) {
    const counts = new Map<string, number>();
    for (const m of all.matchAll(/\b([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})\b/g)) {
      const d = parseLooseDate(m[1]);
      if (d && d > out.periodEnd && d <= addDays(out.periodEnd, 14)) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) out.payDate = best[0];
  }

  if (out.gross == null && (out.hours.length || unmatched.length)) out.gross = round2(out.hours.reduce((s, h) => s + h.amount, 0) + unmatched.reduce((s, v) => s + v, 0));
  // a deduction with only one number is often a year-to-date total with nothing taken this check
  if (out.gross != null && out.net != null) {
    const gap = () => out.gross! - out.lines.reduce((s, x) => s + x.current, 0) - out.net!;
    for (const x of out.lines) {
      if (Math.abs(gap()) <= 1) break;
      if (x.ytd == null && (x.kind === 'pretax' || x.kind === 'posttax') && Math.abs(gap() + x.current) <= 1) {
        x.ytd = x.current;
        x.current = 0;
      }
    }
  }
  if (out.gross != null && out.net != null) {
    const ded = out.lines.reduce((s, x) => s + x.current, 0);
    if (Math.abs(out.gross - ded - out.net) > 1) {
      warnings.push(`Gross minus everything taken out is $${(out.gross - ded).toFixed(2)}, but net pay reads $${out.net.toFixed(2)}. Check the highlighted numbers.`);
      for (const x of out.lines) x.lowConfidence = true;
    }
  }
  if (taxesTotal != null) {
    const taxSum = round2(out.lines.filter((x) => x.kind !== 'pretax' && x.kind !== 'posttax').reduce((s, x) => s + x.current, 0));
    if (Math.abs(taxSum - taxesTotal) > 0.02) {
      warnings.push(`The taxes listed add up to $${taxSum.toFixed(2)}, but the stub’s total is $${taxesTotal.toFixed(2)}. Check the highlighted taxes.`);
      for (const x of out.lines) if (x.kind !== 'pretax' && x.kind !== 'posttax') x.lowConfidence = true;
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
    .filter((l) => (l.kind === 'pretax' || l.kind === 'posttax') && l.current > 0)
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
