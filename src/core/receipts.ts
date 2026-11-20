// Reading grocery receipts (from a photo, a PDF, or pasted text) into line items.
import { parseLooseDate } from './dates';
import { round2 } from './money';
import { cleanItemName, deptFor, packOf } from './groceries';
import type { Deal, ItemRule, Receipt, ReceiptItem } from './types';

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

// ---------- digital receipts (the King Soopers / Kroger app, online orders) ----------
// Each item reads:   Name … , 28 oz              $5.99   ← what you paid for the line (deals already off)
//                    1 x $5.99 $6.49 ea.                 ← how many, each, and the shelf price
//                    Item Coupon/Sale: -$0.50            ← the deal (already taken off above)
//                    UPC: 0001313000612
const QTY_LINE = /^(\d+(?:\.\d+)?)\s*[x×]\s*\$?\s*([\dSO]+[.,-]?\d{2})(?:\s+\$?\s*([\dSO]+[.,-]?\d{2}))?\s*(?:ea\b|each\b|\/|\(|$)/i;
const DEAL_LINE = /(coupon|sale|savings|discount|promo|digital|bogo|buy one|reward)[^$\d-]*[-–]?\s*[S$]*\s*\$?\s*(\d+[.,]\d{2})/i;
const UPC_LINE = /^UPC[:\s]*([\d\s]{6,})/i;

/** "$6-49", "$449", "S0.50" → 6.49, 4.49, 0.50 (OCR swaps . for - and $ for S). */
export function looseMoney(t: string): number {
  const d = t.replace(/[S$\s]/gi, '').replace(/O/g, '0').replace(/[-,]/, '.');
  if (/^\d+\.\d{2}$/.test(d)) return parseFloat(d);
  if (/^\d{3,}$/.test(d)) return parseInt(d, 10) / 100;
  return parseFloat(d);
}

export function isDigitalReceipt(lines: OcrLine[]): boolean {
  const n = (re: RegExp) => lines.filter((l) => re.test(l.text.trim())).length;
  return n(QTY_LINE) >= 2 || n(UPC_LINE) >= 2 || n(/^item coupon\/sale/i) >= 2 || lines.some((l) => /ITEMS PURCHASED|ITEM DETAILS/i.test(l.text));
}

/** A month-name date anywhere: "Nov 19, 2026", "November 19 2026", "Thu, Nov 19, 2026". */
export function findDate(text: string): string | null {
  const num = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2}))\b/);
  if (num) return parseLooseDate(num[1]);
  const named = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i);
  return named ? parseLooseDate(named[0].replace(/Sept/i, 'Sep')) : null;
}

function parseDigital(lines: OcrLine[], rules: ItemRule[], fallbackDate?: string): ParsedReceipt {
  const warnings: string[] = [];
  const items: ReceiptItem[] = [];
  let store = '';
  let date: string | null = null;
  let subtotal: number | null = null;
  let tax: number | null = null;
  let total: number | null = null;
  let listed: number | null = null;
  let itemCoupons = 0; // "Item Coupons & Sales" in the summary: already off each item's price
  let fees = 0;
  let discount = 0;
  let done = false; // past the items (payment details)
  let cur: { name: string[]; price: number; conf: number; qty: number; each: number | null; regular: number | null; deal: Deal | null; upc: string | null } | null = null;

  const finish = () => {
    if (!cur) return;
    const fullName = cur.name.join(' ').replace(/\s+/g, ' ').trim();
    const c = cleanItemName(fullName);
    const pack = packOf(fullName);
    const regular = cur.regular ?? (cur.deal ? cur.each : null);
    let deal = cur.deal;
    if (deal && cur.price === 0) deal = { ...deal, kind: 'free' };
    items.push({
      raw: fullName,
      ...c,
      price: round2(cur.price),
      qty: cur.qty,
      dept: deptFor(c.name, c.key, rules),
      lowConfidence: cur.conf < 70,
      pack: pack && pack > 1 ? pack : null,
      regular: regular != null && regular > (cur.each ?? 0) ? round2(regular) : null,
      deal,
      upc: cur.upc,
    });
    cur = null;
  };

  for (const raw of lines) {
    const text = raw.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!store) for (const [re, name] of STORES) if (re.test(text) && !/UPC|\$/.test(text)) store = name;
    if (!date) date = findDate(text);
    const up = text.toUpperCase();
    const pm = text.match(/[S$]\s?(\d+[.,]\d{2})\s*$/);
    const n = up.match(/(\d+)\s+ITEMS?\b/) ?? up.match(/ITEMS?\s+PURCHASED\s*\((\d+)\)/);
    if (n && /DETAIL|PURCHASED|ITEMS?$/.test(up)) {
      listed = parseInt(n[1], 10);
      continue;
    }
    if (done) continue;
    if (/^PAYMENT|^(VISA|MASTERCARD|AMEX|DISCOVER|DEBIT|EBT)\b|^TERMINAL|^CARD\b/.test(up)) {
      if (/^PAYMENT/.test(up)) {
        finish();
        done = true;
      }
      continue;
    }
    if (/^ORDER (#|TYPE|NUMBER)|^DELIVERED|^SAVINGS$|^ORDER SUMMARY|KINGSOOPERS\.COM/.test(up)) continue;
    if (/^SAVINGS\b/.test(up)) continue; // the total saved; the items carry their own deals
    if (/^ITEM COUPONS? (&|AND) SALES?/.test(up)) {
      if (pm) itemCoupons = looseMoney(pm[1]);
      continue;
    }
    if (/^(COUPONS?|DIGITAL COUPONS?|ORDER COUPON|PROMO(TION)?S?)\b/.test(up) && pm && !cur) {
      discount = round2(discount + looseMoney(pm[1]));
      continue;
    }
    if (/^(FEES?|OTHER FEES|DELIVERY|SERVICE FEE|BAG FEE|PICKUP FEE|TIP|DRIVER TIP|CHECKOUT BAG)/.test(up) && pm) {
      fees = round2(fees + looseMoney(pm[1]));
      continue;
    }
    if (/SUB\s*-?\s*TOTAL/.test(up)) {
      if (pm) subtotal = looseMoney(pm[1]);
      continue;
    }
    if (/\bTAX(ES)?\b/.test(up) && pm) {
      tax = round2((tax ?? 0) + looseMoney(pm[1]));
      continue;
    }
    if (/(ORDER|GRAND)?\s*TOTAL/.test(up) && !/SAVING/.test(up)) {
      if (pm && total == null) total = looseMoney(pm[1]);
      continue;
    }
    const u = text.match(UPC_LINE);
    if (u) {
      if (cur) cur.upc = u[1].replace(/\s/g, '');
      finish();
      continue;
    }
    const q = text.match(QTY_LINE);
    if (q && cur) {
      cur.qty = Math.max(1, Math.round(parseFloat(q[1])));
      cur.each = looseMoney(q[2]);
      if (q[3]) cur.regular = looseMoney(q[3]);
      continue;
    }
    const d = text.match(DEAL_LINE);
    if (d && cur) {
      const saved = round2(Math.abs(looseMoney(d[2])));
      cur.deal = { kind: /BOGO|BUY ONE/i.test(text) ? 'bogo' : /COUPON/i.test(text) && !/SALE/i.test(text) ? 'coupon' : 'sale', saved: round2((cur.deal?.saved ?? 0) + saved) };
      continue;
    }
    if (pm) {
      // a new item: name (maybe continued on the next lines) and the line price
      finish();
      cur = { name: [text.slice(0, pm.index).replace(/[®™]/g, '').trim()], price: looseMoney(pm[1]), conf: raw.confidence, qty: 1, each: null, regular: null, deal: null, upc: null };
      continue;
    }
    if (cur && !cur.each && cur.name.length < 3) cur.name.push(text.replace(/[®™]/g, ''));
  }
  finish();

  const itemsTotal = round2(items.reduce((s, i) => s + i.price, 0));
  // the summary's subtotal is before item coupons; the items are after them
  if (subtotal != null && itemCoupons > 0 && Math.abs(subtotal - itemCoupons - itemsTotal) < Math.abs(subtotal - itemsTotal)) subtotal = round2(subtotal - itemCoupons);
  const units = items.reduce((s, i) => s + Math.max(1, i.qty || 1), 0);
  const complete = listed == null || listed <= items.length || listed <= units;
  // only the order total? the difference is the tax, if it's a believable amount
  if (subtotal == null && total != null && tax == null && complete) {
    const diff = round2(total - itemsTotal);
    if (diff >= 0 && diff <= itemsTotal * 0.12) {
      subtotal = itemsTotal;
      tax = diff;
    }
  }
  if (!complete)
    warnings.push(`The receipt lists ${listed} items and Pebbles found ${units}. If the rest are further down, add another screenshot below.`);
  if (!date) warnings.push('No date on this part of the receipt. Check the date below.');
  return {
    fuel: null,
    store: store || 'King Soopers',
    date: date ?? fallbackDate ?? new Date().toISOString().slice(0, 10),
    items,
    subtotal,
    tax,
    total,
    savings: items.some((i) => i.deal) || discount ? round2(items.reduce((s, i) => s + (i.deal?.saved ?? 0), 0) + discount) : null,
    fees: fees || null,
    discount: discount || null,
    warnings,
    itemsTotal,
  };
}

export function parseReceipt(lines: OcrLine[], rules: ItemRule[] = [], fallbackDate?: string): ParsedReceipt {
  if (isDigitalReceipt(lines)) return parseDigital(lines, rules, fallbackDate);
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
    if (!date) date = findDate(text);
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

/** A long receipt in two screenshots: add the second one's items (skipping any seen twice) and fill gaps. */
export function mergeReceipts(a: ParsedReceipt, b: ParsedReceipt): ParsedReceipt {
  const seen = new Set(a.items.map((i) => i.upc ?? `${i.raw}|${i.price}`));
  const items = [...a.items, ...b.items.filter((i) => !seen.has(i.upc ?? `${i.raw}|${i.price}`))];
  const itemsTotal = round2(items.reduce((s, i) => s + i.price, 0));
  const total = a.total ?? b.total;
  let subtotal = a.subtotal ?? b.subtotal;
  let tax = a.tax ?? b.tax;
  if (subtotal == null && total != null) {
    const diff = round2(total - itemsTotal);
    if (diff >= 0 && diff <= itemsTotal * 0.12) {
      subtotal = itemsTotal;
      tax = tax ?? diff;
    }
  }
  const warnings = [...a.warnings, ...b.warnings].filter((w) => !/lists \d+ items|No date/.test(w));
  const listed = [...a.warnings, ...b.warnings].map((w) => w.match(/lists (\d+) items/)?.[1]).find(Boolean);
  // receipts count units (3 cans = 3 items), not lines
  const units = items.reduce((s2, i) => s2 + Math.max(1, i.qty || 1), 0);
  if (listed && Number(listed) > items.length && Number(listed) > units) warnings.push(`The receipt lists ${listed} items and Pebbles found ${units}. If the rest are further down, add another screenshot below.`);
  const realDate = a.warnings.some((w) => /No date/.test(w)) ? b.date : a.date;
  if (a.warnings.some((w) => /No date/.test(w)) && b.warnings.some((w) => /No date/.test(w))) warnings.push('No date on this part of the receipt. Check the date below.');
  const savings = items.some((i) => i.deal) ? round2(items.reduce((s, i) => s + (i.deal?.saved ?? 0), 0)) : (a.savings ?? b.savings);
  return { ...a, date: realDate, items, itemsTotal, total, subtotal, tax, savings, warnings };
}
