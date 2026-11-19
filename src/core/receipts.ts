// Reading grocery receipts (from a photo, a PDF, or pasted text) into line items.
import { parseLooseDate } from './dates';
import { round2 } from './money';
import { cleanItemName, deptFor } from './groceries';
import type { ItemRule, Receipt, ReceiptItem } from './types';

export interface OcrLine {
  text: string;
  confidence: number; // 0–100 (100 for PDFs and typed text)
  /** Where each word sits across the page, when known (table reading and PDFs). */
  words?: { text: string; x0: number; x1: number; col?: 'cur' | 'ytd' | null; gap?: boolean }[];
  /** For a piece of a row: which column each space-separated token came from. */
  cols?: ('cur' | 'ytd' | null)[];
}

const STORES: [RegExp, string][] = [
  [/KING\s*SOOP/i, 'King Soopers'],
  [/KROGER/i, 'Kroger'],
  [/WAL[\s-]*MART|WALMART|\bWM\s*SUPER/i, 'Walmart'],
  [/SAFEWAY/i, 'Safeway'],
  [/SPROUTS/i, 'Sprouts'],
  [/COSTCO/i, 'Costco'],
  [/SAM'?S\s*CLUB/i, "Sam's Club"],
  [/TARGET/i, 'Target'],
  [/\bALDI\b/i, 'Aldi'],
  [/NATURAL\s*GROCERS/i, 'Natural Grocers'],
  [/WHOLE\s*FOODS/i, 'Whole Foods'],
  [/TRADER\s*JOE/i, "Trader Joe's"],
  [/CITY\s*MARKET/i, 'City Market'],
  [/ALBERTSONS/i, 'Albertsons'],
  [/DOLLAR\s*GENERAL/i, 'Dollar General'],
  [/FAMILY\s*DOLLAR/i, 'Family Dollar'],
  // gas stations and convenience stores
  [/CIRCLE\s*K/i, 'Circle K'],
  [/7[\s-]*ELEVEN|SEVEN\s*ELEVEN/i, '7-Eleven'],
  [/LOAF\s*['N]*\s*JUG/i, "Loaf 'N Jug"],
  [/MAVERIK/i, 'Maverik'],
  [/MURPHY\s*(USA|EXPRESS)/i, 'Murphy USA'],
  [/KUM\s*&?\s*GO/i, 'Kum & Go'],
  [/QUIK\s*TRIP|\bQT\b/i, 'QuikTrip'],
  [/CONOCO/i, 'Conoco'],
  [/PHILLIPS\s*66/i, 'Phillips 66'],
  [/\bSHELL\b/i, 'Shell'],
  [/SINCLAIR/i, 'Sinclair'],
  [/CHEVRON/i, 'Chevron'],
  [/EXXON|MOBIL\b/i, 'Exxon'],
  [/VALERO/i, 'Valero'],
  [/LOVE'?S\s*TRAVEL/i, "Love's"],
  [/PILOT|FLYING\s*J/i, 'Pilot'],
  [/SPEEDWAY/i, 'Speedway'],
  [/CASEY'?S/i, "Casey's"],
  [/WALGREENS/i, 'Walgreens'],
  [/\bCVS\b/i, 'CVS'],
];

export const GAS_STORES = new Set(['Circle K', '7-Eleven', "Loaf 'N Jug", 'Maverik', 'Murphy USA', 'Kum & Go', 'QuikTrip', 'Conoco', 'Phillips 66', 'Shell', 'Sinclair', 'Chevron', 'Exxon', 'Valero', "Love's", 'Pilot', 'Speedway', "Casey's"]);

/** The pump line: gallons and price per gallon (a receipt shows them a few different ways). */
export function findFuel(text: string): { gallons: number; perGallon: number; grade: string } | null {
  const t = text.toUpperCase();
  const gal = t.match(/(\d{1,3}\.\d{2,3})\s*(?:G\b|GAL\b|GALS\b|GALLONS?\b)/) ?? t.match(/GAL(?:LON)?S?\s*[:=]?\s*(\d{1,3}\.\d{2,3})/);
  const ppg =
    t.match(/(?:PRICE\s*\/?\s*G(?:AL)?|PPG|PER\s*GAL(?:LON)?)\s*[:=]?\s*\$?\s*(\d\.\d{2,3})/) ??
    t.match(/@\s*\$?\s*(\d\.\d{2,3})\s*(?:\/\s*G(?:AL)?)?/) ??
    t.match(/\$?(\d\.\d{3})\s*\/\s*G/);
  if (!gal || !ppg) return null;
  const gallons = parseFloat(gal[1]);
  const perGallon = parseFloat(ppg[1]);
  if (!(gallons > 0 && gallons < 60 && perGallon > 1 && perGallon < 9)) return null;
  const grade = /DIESEL/.test(t) ? 'Diesel' : /PREM|SUPER|\b91\b|\b93\b/.test(t) ? 'Premium' : /PLUS|MID|\b89\b/.test(t) ? 'Midgrade' : 'Regular';
  return { gallons, perGallon, grade };
}

const SKIP = /\b(BALANCE|CHANGE|CASH|VISA|MASTER\s*CARD|MASTERCARD|AMEX|DISCOVER|DEBIT|CREDIT|TEND(ER)?|APPROV|AUTH|REF\s*#|ACCOUNT|ACCT|CARD\s*#|ITEMS?\s+SOLD|ITEM\s+COUNT|FUEL\s+POINTS|POINTS|REWARDS|THANK|STORE\s*#|ST\s*#|OP\s*#|TE\s*#|TR\s*#|TC\s*#|CASHIER|TERMINAL|PHONE|WWW\.|\.COM|SURVEY|PAYMENT|EBT|CHIP|AID\b|TVR|SIGNATURE|MGR|MANAGER|RECEIPT|INVOICE|ORDER\s*#)\b/i;
const DISCOUNT = /(SAVINGS|SAVED|\bSC\b|COUPON|CPN|\bDISC\b|DISCOUNT|PROMO|REWARD|MFR|LOYALTY|PRICE\s*CUT|DIGITAL|DIG\s*CPN|ROLLBACK|MARKDOWN)/i;
const PRICE_END = /(-?\$?\s?\d{1,4}[.,]\s?\d{2})\s*(-)?\s*(?:[A-Z]{1,2}|\*|[A-Z]\s[A-Z])?\s*$/;

function fixOcrPrice(token: string): { value: number; fixed: boolean } {
  let t = token.replace(/\s/g, '').replace('$', '');
  let fixed = false;
  if (t.includes(',')) {
    t = t.replace(',', '.');
    fixed = true;
  }
  return { value: parseFloat(t), fixed };
}

export interface ParsedReceipt extends Omit<Receipt, 'id' | 'createdAt' | 'source'> {
  warnings: string[];
  itemsTotal: number;
}

export function parseReceipt(lines: OcrLine[], rules: ItemRule[] = [], fallbackDate?: string): ParsedReceipt {
  const warnings: string[] = [];
  const items: ReceiptItem[] = [];
  let store = '';
  let date: string | null = null;
  let subtotal: number | null = null;
  let tax: number | null = null;
  let total: number | null = null;
  let savings = 0;
  let pendingName: { text: string; confidence: number } | null = null;

  for (const raw of lines) {
    const text = raw.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!store) for (const [re, name] of STORES) if (re.test(text)) store = name;
    if (!date) {
      const dm = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
      if (dm) date = parseLooseDate(dm[1]);
    }
    const up = text.toUpperCase();
    const pm = text.match(PRICE_END);

    if (/SUB\s*-?\s*TOTAL/.test(up)) {
      if (pm) subtotal = fixOcrPrice(pm[1]).value;
      continue;
    }
    if (/\bTAX\b/.test(up) && !/\bTAXABLE\b/.test(up)) {
      if (pm) tax = round2((tax ?? 0) + Math.abs(fixOcrPrice(pm[1]).value));
      continue;
    }
    if (/(\bTOTAL\b|BALANCE\s+DUE|AMOUNT\s+DUE)/.test(up) && !/SAVING|SAVED|ITEMS?/.test(up)) {
      if (pm && total == null) total = fixOcrPrice(pm[1]).value;
      continue;
    }
    if (/(TOTAL\s+SAVINGS|YOU\s+SAVED|YOUR\s+SAVINGS)/.test(up)) {
      continue;
    }
    if (SKIP.test(up)) {
      pendingName = null;
      continue;
    }

    // weight / quantity detail: "2.31 lb @ 0.59 /lb   1.36" or "2 @ 1.99"
    const at = text.match(/(\d+(?:\.\d+)?)\s*(lb|lbs|kg|ea)?\s*@\s*\$?\s?(\d+[.,]\d{2})/i);
    if (at) {
      const qty = parseFloat(at[1]);
      if (pm && pendingName) {
        const p = fixOcrPrice(pm[1]);
        const c = cleanItemName(pendingName.text);
        items.push({ raw: `${pendingName.text} ${text}`, ...c, price: round2(p.value), qty: at[2] ? 1 : qty || 1, dept: deptFor(c.name, c.key, rules), lowConfidence: pendingName.confidence < 70 || raw.confidence < 70 || p.fixed });
        pendingName = null;
      } else if (items.length && !at[2]) {
        items[items.length - 1].qty = qty || 1;
      }
      continue;
    }

    if (!pm) {
      // a name without a price; the price may be on the next line
      if (/[A-Z]{3,}/i.test(text) && text.length < 40) pendingName = { text, confidence: raw.confidence };
      continue;
    }
    const { value, fixed } = fixOcrPrice(pm[1]);
    const negative = value < 0 || pm[2] === '-' || /-\s*$/.test(text);
    const nameText = text
      .slice(0, pm.index)
      .replace(/\s+\d{6,}[A-Z]{0,2}\b.*$/, '') // UPC and anything after it (Walmart)
      .replace(/\s+[A-Z]$/, '') // a lone tax-flag letter
      .trim();
    const lettersOnly = nameText.replace(/[^A-Za-z]/g, '');
    if (negative || DISCOUNT.test(nameText)) {
      const off = -Math.abs(value);
      savings += Math.abs(value);
      if (items.length) items[items.length - 1].price = round2(Math.max(0, items[items.length - 1].price + off));
      pendingName = null;
      continue;
    }
    if (lettersOnly.length < 2) {
      if (pendingName) {
        const c = cleanItemName(pendingName.text);
        items.push({ raw: `${pendingName.text} ${text}`, ...c, price: round2(value), qty: 1, dept: deptFor(c.name, c.key, rules), lowConfidence: pendingName.confidence < 70 || fixed });
        pendingName = null;
      }
      continue;
    }
    pendingName = null;
    const c = cleanItemName(nameText);
    items.push({ raw: text, ...c, price: round2(value), qty: 1, dept: deptFor(c.name, c.key, rules), lowConfidence: raw.confidence < 70 || fixed });
  }

  const itemsTotal = round2(items.reduce((s, i) => s + i.price, 0));
  const reference = subtotal ?? (total != null && tax != null ? round2(total - tax) : null);
  if (reference != null && Math.abs(reference - itemsTotal) > 0.05) {
    warnings.push(`Items add up to $${itemsTotal.toFixed(2)} but the receipt says $${reference.toFixed(2)}. Check the highlighted lines.`);
    // when it doesn't add up, mark the lines most likely misread
    for (const it of items) if (!it.lowConfidence && /[0-9]/.test(it.name)) it.lowConfidence = true;
  }
  // gas: tag the pump line (or add it) and keep the price per gallon for the gas tracker
  const fuel = findFuel(lines.map((l) => l.text).join('\n'));
  if (fuel) {
    const amount = round2(fuel.gallons * fuel.perGallon);
    const hit = items.find((i) => i.dept === 'fuel') ?? items.find((i) => Math.abs(i.price - amount) <= 0.05);
    const name = `Gas (${fuel.grade.toLowerCase()})`;
    if (hit) Object.assign(hit, { name, key: 'gas', dept: 'fuel' as const, qty: 1 });
    else items.unshift({ raw: `${fuel.gallons} gal @ ${fuel.perGallon}`, name, key: 'gas', price: amount, qty: 1, dept: 'fuel' });
  }
  if (!items.length) warnings.push('No items were found. Try a flatter, brighter photo, or add items by hand.');
  if (!store) warnings.push('Which store was this? Pick it below.');
  return {
    fuel,
    store: store || (fuel ? 'Gas station' : 'Grocery store'),
    date: date ?? fallbackDate ?? new Date().toISOString().slice(0, 10),
    items,
    subtotal,
    tax,
    total,
    savings: savings ? round2(savings) : null,
    warnings,
    itemsTotal,
  };
}
