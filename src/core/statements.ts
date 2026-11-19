// Bank statement parsing: CSV (any bank), OFX/QFX (Quicken/Money downloads) and PDF text.
import Papa from 'papaparse';
import { parseLooseDate, parts } from './dates';
import { hash, parseAmount, round2 } from './money';
import type { ISODate } from './types';

export interface ParsedTxn {
  date: ISODate;
  description: string;
  amount: number; // + in, - out
  balance?: number | null;
}

export interface CsvMapping {
  headerRow: number; // -1 = no header
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  type: number | null;
  flip: boolean;
}

export interface ParseResult {
  format: 'csv' | 'ofx' | 'pdf';
  transactions: ParsedTxn[];
  warnings: string[];
  csv?: { rows: string[][]; mapping: CsvMapping; headers: string[] };
  accountHint?: string;
}

const H_DATE = /^(trans(action)?\.? ?date|date|posted ?date|posting ?date|post ?date|effective ?date|date posted|transaction date)$/i;
const H_DESC = /^(description|desc|payee|merchant|name|memo|details|transaction|transaction description|narrative|original description|reference)$/i;
const H_AMOUNT = /^(amount|transaction amount|amt|net amount|amount \(usd\))$/i;
const H_DEBIT = /^(debit|debits|withdrawal|withdrawals|withdrawal amount|debit amount|money out|charges?|outflow)$/i;
const H_CREDIT = /^(credit|credits|deposit|deposits|deposit amount|credit amount|money in|payments?|inflow)$/i;
const H_TYPE = /^(type|transaction type|debit\/credit|dr\/cr|cr\/dr)$/i;

function clean(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function guessCsvMapping(rows: string[][]): CsvMapping {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r].map((c) => clean(c));
    const find = (re: RegExp) => row.findIndex((c) => re.test(c));
    const date = find(H_DATE);
    let desc = find(H_DESC);
    const amount = find(H_AMOUNT);
    const debit = find(H_DEBIT);
    const credit = find(H_CREDIT);
    const type = find(H_TYPE);
    if (date >= 0 && (amount >= 0 || debit >= 0 || credit >= 0)) {
      if (desc < 0) {
        // pick the widest text column
        desc = row.findIndex((_, i) => i !== date && i !== amount && i !== debit && i !== credit && i !== type);
      }
      return {
        headerRow: r,
        date,
        description: desc,
        amount: amount >= 0 ? amount : null,
        debit: debit >= 0 ? debit : null,
        credit: credit >= 0 ? credit : null,
        type: type >= 0 ? type : null,
        flip: false,
      };
    }
  }
  // No header: infer from content
  const sample = rows.slice(0, 20);
  const width = Math.max(...sample.map((r) => r.length));
  let date = -1;
  let amount = -1;
  let desc = -1;
  let bestLen = -1;
  for (let c = 0; c < width; c++) {
    const vals = sample.map((r) => clean(r[c])).filter(Boolean);
    if (!vals.length) continue;
    const dates = vals.filter((v) => parseLooseDate(v)).length;
    const nums = vals.filter((v) => parseAmount(v) != null).length;
    const avgLen = vals.reduce((s, v) => s + v.length, 0) / vals.length;
    if (date < 0 && dates / vals.length > 0.7) date = c;
    else if (amount < 0 && nums / vals.length > 0.7) amount = c;
    else if (avgLen > bestLen && nums / vals.length < 0.5) {
      bestLen = avgLen;
      desc = c;
    }
  }
  return { headerRow: -1, date, description: desc, amount: amount >= 0 ? amount : null, debit: null, credit: null, type: null, flip: false };
}

export function applyCsvMapping(rows: string[][], m: CsvMapping): { txns: ParsedTxn[]; skipped: number } {
  const txns: ParsedTxn[] = [];
  let skipped = 0;
  for (let r = m.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !clean(c))) continue;
    const date = parseLooseDate(clean(row[m.date]));
    if (!date) {
      skipped++;
      continue;
    }
    let amount: number | null = null;
    if (m.amount != null) {
      amount = parseAmount(clean(row[m.amount]));
      if (amount != null && m.type != null) {
        const t = clean(row[m.type]).toUpperCase();
        if (/^(DEBIT|DR|D|WITHDRAWAL|SALE|PURCHASE)/.test(t)) amount = -Math.abs(amount);
        else if (/^(CREDIT|CR|C|DEPOSIT|RETURN|REFUND|PAYMENT)/.test(t)) amount = Math.abs(amount);
      }
    } else {
      const d = m.debit != null ? parseAmount(clean(row[m.debit])) : null;
      const c = m.credit != null ? parseAmount(clean(row[m.credit])) : null;
      if (d == null && c == null) amount = null;
      else amount = Math.abs(c ?? 0) - Math.abs(d ?? 0);
    }
    if (amount == null || amount === 0) {
      skipped++;
      continue;
    }
    if (m.flip) amount = -amount;
    const description = clean(row[m.description]) || 'Transaction';
    txns.push({ date, description, amount: round2(amount) });
  }
  return { txns, skipped };
}

/** Credit-card exports often list purchases as positive numbers. */
function looksFlipped(txns: ParsedTxn[]): boolean {
  if (txns.length < 4) return false;
  const pos = txns.filter((t) => t.amount > 0);
  const neg = txns.filter((t) => t.amount < 0);
  const negPayments = neg.filter((t) => /PAYMENT|THANK YOU|AUTOPAY|CREDIT/i.test(t.description)).length;
  return pos.length > neg.length * 3 && (neg.length === 0 || negPayments / neg.length > 0.5);
}

export function parseCsv(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const rows = (parsed.data as string[][]).filter((r) => Array.isArray(r));
  const warnings: string[] = [];
  const mapping = guessCsvMapping(rows);
  if (mapping.date < 0 || (mapping.amount == null && mapping.debit == null && mapping.credit == null)) {
    warnings.push("Couldn't find the date and amount columns. Pick them below.");
    return { format: 'csv', transactions: [], warnings, csv: { rows, mapping, headers: headersOf(rows, mapping) } };
  }
  let { txns, skipped } = applyCsvMapping(rows, mapping);
  if (looksFlipped(txns)) {
    mapping.flip = true;
    txns = txns.map((t) => ({ ...t, amount: -t.amount }));
    warnings.push('This looks like a credit card export (purchases shown as positive). Signs were flipped. Toggle if that is wrong.');
  }
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} without a date or amount were skipped.`);
  return { format: 'csv', transactions: txns, warnings, csv: { rows, mapping, headers: headersOf(rows, mapping) } };
}

function headersOf(rows: string[][], m: CsvMapping): string[] {
  const width = Math.max(0, ...rows.slice(0, 10).map((r) => r.length));
  if (m.headerRow >= 0) return Array.from({ length: width }, (_, i) => clean(rows[m.headerRow][i]) || `Column ${i + 1}`);
  return Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
}

// ---------------- OFX / QFX ----------------

function ofxTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}

export function parseOfx(text: string): ParseResult {
  const warnings: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const txns: ParsedTxn[] = [];
  for (const b of blocks) {
    const block = b.split(/<\/STMTTRN>/i)[0];
    const date = parseLooseDate(ofxTag(block, 'DTPOSTED') ?? ofxTag(block, 'DTUSER') ?? '');
    const amount = parseAmount(ofxTag(block, 'TRNAMT') ?? '');
    const name = ofxTag(block, 'NAME') ?? '';
    const memo = ofxTag(block, 'MEMO') ?? '';
    if (!date || amount == null) continue;
    const desc = clean([name, memo && !name.includes(memo) ? memo : ''].filter(Boolean).join(' ')) || 'Transaction';
    txns.push({ date, description: decodeEntities(desc), amount: round2(amount) });
  }
  const acct = ofxTag(text, 'ACCTID');
  const isCard = /<CCSTMTRS>/i.test(text);
  if (!txns.length) warnings.push('No transactions were found in this OFX/QFX file.');
  return { format: 'ofx', transactions: txns, warnings, accountHint: acct ? `${isCard ? 'Card' : 'Account'} ••${acct.slice(-4)}` : undefined };
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

// ---------------- PDF (text lines) ----------------

const MONEY_RE = /(?:^|\s)(\(?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR|-))?)(?=\s|$)/g;
const LINE_DATE_RE = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}-\d{1,2}(?:-\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?)\s+/i;
const PLUS_SECTION = /(deposits?|credits?|additions?|money in|payments? and credits|incoming)/i;
const MINUS_SECTION = /(withdrawals?|debits?|subtractions?|purchases?|checks? (paid|cleared)|fees|charges|money out|card transactions|electronic payments|outgoing|atm)/i;
const SKIP_LINE = /(beginning balance|ending balance|opening balance|closing balance|previous balance|new balance|total |subtotal|daily balance|balance forward|page \d|continued)/i;
const DEPOSIT_WORDS = /(DEPOSIT|PAYROLL|DIR DEP|DIRECT DEP|REFUND|TRANSFER FROM|INTEREST PAID|CREDIT\b|CASH BACK REWARD|REVERSAL|ZELLE FROM|FROM SAVINGS|FROM CHECKING)/i;

export function statementYearFromText(lines: string[]): { year: number | null; endMonth: number | null } {
  const head = lines.slice(0, 80).join(' ');
  // "10/01/2026 - 10/31/2026" or "October 1, 2026 through October 31, 2026"
  const range = head.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:-|to|through|thru|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (range) {
    let y = +range[6];
    if (y < 100) y += 2000;
    return { year: y, endMonth: +range[4] };
  }
  const words = head.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? (\d{4})\s*(?:-|to|through|thru|–)\s*(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? (\d{4})/i,
  );
  if (words) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    return { year: +words[4], endMonth: months.indexOf(words[3].toLowerCase()) + 1 };
  }
  const years = [...head.matchAll(/\b(20\d{2})\b/g)].map((m) => +m[1]);
  if (!years.length) return { year: null, endMonth: null };
  const counts = new Map<number, number>();
  years.forEach((y) => counts.set(y, (counts.get(y) ?? 0) + 1));
  return { year: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0], endMonth: null };
}

export function parsePdfLines(lines: string[], fallbackYear = new Date().getFullYear()): ParseResult {
  const warnings: string[] = [];
  const { year, endMonth } = statementYearFromText(lines);
  const baseYear = year ?? fallbackYear;
  if (!year) warnings.push(`Couldn't find the statement year, assumed ${baseYear}.`);
  const txns: ParsedTxn[] = [];
  let section: 1 | -1 | 0 = 0;
  let prevBalance: number | null = null;
  let last: ParsedTxn | null = null;
  let continuation = 0;

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (!line) continue;
    const dm = line.match(LINE_DATE_RE);
    const moneys = [...line.matchAll(MONEY_RE)].map((m) => m[1]);

    if (!dm) {
      if (/balance/i.test(line) && moneys.length) {
        const b = parseAmount(moneys[moneys.length - 1].replace(/\s/g, ''));
        if (b != null && /(beginning|opening|previous|balance forward)/i.test(line)) prevBalance = b;
      }
      if (moneys.length === 0 && line.length < 60) {
        if (MINUS_SECTION.test(line) && !PLUS_SECTION.test(line)) section = -1;
        else if (PLUS_SECTION.test(line) && !MINUS_SECTION.test(line)) section = 1;
      }
      // short continuation of the previous description
      if (last && moneys.length === 0 && continuation < 2 && line.length < 50 && !SKIP_LINE.test(line) && !MINUS_SECTION.test(line) && !PLUS_SECTION.test(line)) {
        last.description = clean(`${last.description} ${line}`);
        continuation++;
      }
      continue;
    }
    if (SKIP_LINE.test(line) || moneys.length === 0) {
      last = null;
      continue;
    }

    let date = parseLooseDate(dm[1], baseYear);
    if (!date) continue;
    // December transactions on a January statement belong to the previous year
    if (endMonth && !/\d{4}/.test(dm[1])) {
      const { m } = parts(date);
      if (m > endMonth + 1) date = parseLooseDate(dm[1], baseYear - 1) ?? date;
    }
    let rest = line.slice(dm[0].length);
    // strip a second (posting) date
    const second = rest.match(LINE_DATE_RE);
    if (second) rest = rest.slice(second[0].length);
    const firstMoneyIdx = rest.search(/\(?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}/);
    const description = clean(firstMoneyIdx > 0 ? rest.slice(0, firstMoneyIdx) : rest).replace(/\s+\d{4,}$/, '') || 'Transaction';
    const tokens = [...rest.matchAll(MONEY_RE)].map((m) => m[1].replace(/\s/g, ''));
    const amtTok = tokens[0];
    let amount = parseAmount(amtTok);
    const balance = tokens.length >= 2 ? parseAmount(tokens[tokens.length - 1]) : null;
    if (amount == null) continue;
    const explicit = /^\(|^-|CR$|DR$|-$/.test(amtTok);
    if (!explicit) {
      const abs = Math.abs(amount);
      if (balance != null && prevBalance != null && Math.abs(Math.abs(balance - prevBalance) - abs) < 0.011) {
        amount = balance >= prevBalance ? abs : -abs;
      } else if (section !== 0) {
        amount = section * abs;
      } else {
        amount = DEPOSIT_WORDS.test(description) ? abs : -abs;
      }
    }
    if (balance != null) prevBalance = balance;
    last = { date, description, amount: round2(amount), balance };
    continuation = 0;
    txns.push(last);
  }
  if (!txns.length) warnings.push("No transactions were recognized in this PDF. If your bank offers CSV or QFX downloads, those import perfectly.");
  else warnings.push('PDF statements are read by layout, so give the list a quick look before importing.');
  return { format: 'pdf', transactions: txns, warnings };
}

export function detectFormat(fileName: string, text: string): 'csv' | 'ofx' | 'unknown' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx') || /<OFX>|OFXHEADER/i.test(text.slice(0, 2000))) return 'ofx';
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv') || text.includes(',')) return 'csv';
  return 'unknown';
}

// ---------------- merchant clean-up & ids ----------------

const PREFIXES = [
  /^(POS|DEBIT CARD|DEBIT|DBT|CHECKCARD|CHECK CARD|VISA|MC|ACH|ELECTRONIC|EFT|PREAUTHORIZED|PREAUTH|RECURRING|POS PURCHASE|PURCHASE|PURCHASE RETURN|CARD PURCHASE|ONLINE|WEB|MOBILE)\b[\s:-]*/,
  /^(AUTHORIZED ON|PURCHASE AUTHORIZED ON|RECURRING PAYMENT AUTHORIZED ON|AUTH ON)\s*\d{1,2}\/\d{1,2}\s*/,
  /^\d{1,2}\/\d{1,2}\s+/,
  /^(SQ|TST|PP|SP|PY|IN|DD|BT)\s?\*\s*/,
  /^PAYPAL\s?\*\s*/,
];

// Well-known merchants get a friendly, consistent name.
const ALIASES: [RegExp, string][] = [
  [/COLORADO SPRINGS UTIL|SPRINGS UTILITIES|\bCSU\b/, 'Colorado Springs Utilities'],
  [/KING SOOPERS? ?FUEL|KS FUEL/, 'King Soopers Fuel'],
  [/KING SOOPERS?/, 'King Soopers'],
  [/LOAF ?'?N ?JUG/, "Loaf 'N Jug"],
  [/DUTCH BROS/, 'Dutch Bros'],
  [/STARBUCKS/, 'Starbucks'],
  [/DOORDASH/, 'DoorDash'],
  [/UBER ?EATS/, 'Uber Eats'],
  [/GRUBHUB/, 'Grubhub'],
  [/AMAZON PRIME|PRIME VIDEO/, 'Amazon Prime'],
  [/AMAZON|AMZN/, 'Amazon'],
  [/NETFLIX/, 'Netflix'],
  [/SPOTIFY/, 'Spotify'],
  [/HULU/, 'Hulu'],
  [/DISNEY ?(PLUS|\+)|DISNEYPLUS/, 'Disney+'],
  [/XBOX/, 'Xbox'],
  [/PLAYSTATION|\bPSN\b/, 'PlayStation'],
  [/APPLE\.COM\/BILL|ITUNES/, 'Apple'],
  [/T-?MOBILE/, 'T-Mobile'],
  [/VERIZON/, 'Verizon'],
  [/COMCAST|XFINITY/, 'Xfinity'],
  [/XCEL/, 'Xcel Energy'],
  [/BLACK HILLS ENERGY/, 'Black Hills Energy'],
  [/CHICK-?FIL-?A/, 'Chick-fil-A'],
  [/MCDONALD/, "McDonald's"],
  [/WAL-?MART|WM SUPERCENTER/, 'Walmart'],
  [/TARGET\b/, 'Target'],
  [/COSTCO GAS/, 'Costco Gas'],
  [/COSTCO/, 'Costco'],
  [/SAFEWAY/, 'Safeway'],
  [/SPROUTS/, 'Sprouts'],
  [/WHOLE ?FOODS|WHOLEFDS/, 'Whole Foods'],
  [/GEICO/, 'GEICO'],
  [/PROGRESSIVE/, 'Progressive'],
  [/STATE FARM/, 'State Farm'],
  [/VENMO/, 'Venmo'],
  [/ZELLE/, 'Zelle'],
  [/CASH ?APP|SQUARE CASH/, 'Cash App'],
  [/PAYROLL|DIR DEP|DIRECT DEP/, 'Paycheck'],
];

export function cleanMerchant(desc: string): string {
  let s = desc.toUpperCase().replace(/\s+/g, ' ').trim();
  if (/TRANSFER|XFER/.test(s)) {
    if (/SAV/.test(s)) return /FROM/.test(s) ? 'From savings' : 'To savings';
    return 'Transfer';
  }
  for (const [re, name] of ALIASES) if (re.test(s)) return name;
  for (let i = 0; i < 4; i++) for (const p of PREFIXES) s = s.replace(p, '');
  s = s
    .replace(/\b(CARD|CRD)\s*\d{2,}\b/g, ' ')
    .replace(/X{2,}\d+/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\bS\d{6,}\b/g, ' ')
    .replace(/\b(COLORADO SPRI?N?G?S?|COLO SPGS|COLORADO SPGS|DENVER|AURORA|PUEBLO|FOUNTAIN|MONUMENT)\b/g, ' ')
    .replace(/\s(CO|US|USA)\s*$/g, ' ')
    .replace(/\*+/g, ' ')
    .replace(/[^A-Z0-9&'.+\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter((w) => w.length > 0);
  const short = words.slice(0, 3).join(' ') || desc.slice(0, 24);
  return titleCase(short);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/&])([a-z])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(Atm|Ach|Usa|Csu|Hoa|Kfc|Cvs|Bp|Qt|Ups|Usps|Ihop|Amc|Rei|H&m|Tj|Hbo|Espn|Irs)\b/g, (m) => m.toUpperCase());
}

/** Merchant key used to group transactions (recurring detection, rules). */
export function merchantKey(desc: string): string {
  return cleanMerchant(desc).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
}

/** Stable ids so re-importing the same statement never creates duplicates. */
export function transactionIds(accountId: string, txns: ParsedTxn[]): string[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    const base = `${accountId}|${t.date}|${t.amount.toFixed(2)}|${merchantKey(t.description)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return 't' + hash(`${base}|${n}`) + hash(`${n}|${base}`);
  });
}
