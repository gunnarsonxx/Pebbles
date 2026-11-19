// Rebuild table rows from words the reader found anywhere on the page.
// Pay stubs are grids: reading them as one column jumbles them, reading them as scattered
// words loses which number goes with which label. Grouping words by height on the page puts
// "Federal W/H 119.84 3298.76" back together; wide gaps between words become column breaks.
// Word positions also tell which column a number is in: "Current"/"This period" or "YTD".
import type { OcrLine } from './receipts';

export interface OcrWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type ColTag = 'cur' | 'ytd' | null;
type W = NonNullable<OcrLine['words']>[number];

export const COL_GAP = '   ';

export function rowsFromWords(words: OcrWord[]): OcrLine[] {
  const ws = words.filter((w) => w.text.trim() && w.y1 > w.y0);
  if (!ws.length) return [];
  const heights = ws.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)] || 10;
  const sorted = ws.slice().sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: OcrWord[][] = [];
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    const row = rows[rows.length - 1];
    if (row) {
      const rcy = row.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / row.length;
      if (Math.abs(cy - rcy) <= h * 0.55) {
        row.push(w);
        continue;
      }
    }
    rows.push([w]);
  }
  const lines = rows.map((row) => {
    row.sort((a, b) => a.x0 - b.x0);
    const merged = mergeSplitAmounts(row.map((w) => ({ text: w.text.trim(), x0: w.x0, x1: w.x1, conf: w.confidence })));
    let text = '';
    merged.forEach((w, i) => {
      if (i > 0) text += w.x0 - merged[i - 1].x1 > h * 1.6 ? COL_GAP : ' ';
      text += w.text;
    });
    return {
      text,
      confidence: merged.reduce((s, w) => s + w.conf, 0) / merged.length,
      words: merged.map(({ text: t, x0, x1 }, i) => ({ text: t, x0, x1, gap: i > 0 && x0 - merged[i - 1].x1 > h * 4 })),
    };
  });
  return tagColumns(lines, h);
}

/** "1671" "50" read as two words is "1671.50"; "3" "20.08" is "320.08" (only beside other amounts). */
function mergeSplitAmounts<T extends { text: string; x0: number; x1: number; conf: number }>(row: T[]): T[] {
  if (!row.some((w) => /\d\.\d{2}\b/.test(w.text))) return row;
  const out: T[] = [];
  for (const w of row) {
    const prev = out[out.length - 1];
    if (prev && /^\d{1,4}$/.test(prev.text) && /^\d{2}$/.test(w.text)) {
      out[out.length - 1] = { ...prev, text: `${prev.text}.${w.text}`, x1: w.x1 };
      continue;
    }
    if (prev && /^\d$/.test(prev.text) && /^\d{2}\.\d{2}$/.test(w.text)) {
      out[out.length - 1] = { ...prev, text: `${prev.text}${w.text}`, x1: w.x1 };
      continue;
    }
    out.push(w);
  }
  return out;
}

const AMOUNT = /^[-($]*\d[\d,]*\.\d{2,4}\)?$|^\d{3,6}\)?$/;
const word = (t: string) => t.toUpperCase().replace(/[^A-Z-]/g, '');

/**
 * Tag every amount with the column it sits under. Column headers are rows without amounts that
 * say CURRENT / THIS (PERIOD) or YTD / YEAR (TO DATE). Rows that start with "Current" or "YTD"
 * (summary grids) are tagged by their label instead.
 */
export function tagColumns(lines: OcrLine[], h = 10): OcrLine[] {
  const anchors: { row: number; kind: 'cur' | 'ytd'; x: number }[] = [];
  lines.forEach((l, r) => {
    const ws = l.words ?? [];
    if (!ws.length || ws.some((w) => AMOUNT.test(w.text) && /\./.test(w.text))) return;
    ws.forEach((w, i) => {
      const t = word(w.text);
      if (/:$/.test(w.text.trim())) return; // "Pay Period:" is a label, not a column
      const cx = (w.x0 + w.x1) / 2;
      if (t === 'YTD' || t === 'Y-T-D' || (t === 'YEAR' && word(ws[i + 1]?.text ?? '') === 'TO')) anchors.push({ row: r, kind: 'ytd', x: cx });
      else if (t === 'CURRENT' || t === 'CUR' || t === 'THIS' || (t === 'PERIOD' && word(ws[i - 1]?.text ?? '') !== 'PAY')) anchors.push({ row: r, kind: 'cur', x: cx });
    });
  });
  const maxDx = h * 14;
  return lines.map((l, r) => {
    const ws = l.words;
    if (!ws?.length) return l;
    const lead = word(ws[0].text);
    const rowLabel: ColTag = /^(CURRENT|CUR|THISPERIOD)$/.test(lead) ? 'cur' : lead === 'YTD' || lead === 'Y-T-D' ? 'ytd' : null;
    const tagged: W[] = ws.map((w) => {
      if (!AMOUNT.test(w.text)) return { ...w, col: null };
      if (rowLabel) return { ...w, col: rowLabel };
      const cx = (w.x0 + w.x1) / 2;
      const near = anchors.filter((a) => a.row < r && a.row >= r - 40 && Math.abs(a.x - cx) <= maxDx);
      if (!near.length) return { ...w, col: null };
      const top = Math.max(...near.map((a) => a.row));
      const header = near.filter((a) => a.row >= top - 2);
      const best = header.sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx))[0];
      return { ...w, col: best.kind };
    });
    return { ...l, words: tagged };
  });
}

const NUMERIC = /^[-($]*\d[\d,]*(\.\d+)?\)?%?$/;

interface Tok {
  t: string;
  col: ColTag;
  gap?: boolean; // a wide gap before it: a new cell on the page
}

function chunkTokens(tokens: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  let sawNum = false;
  for (const tok of tokens) {
    const numeric = NUMERIC.test(tok.t);
    // a heading in its own cell ("IMPORTANT MESSAGE") doesn't belong to the next label
    if (!numeric && tok.gap && cur.length && !sawNum) {
      out.push(cur);
      cur = [];
    }
    if (!numeric && sawNum) {
      out.push(cur);
      cur = [];
      sawNum = false;
    }
    cur.push(tok);
    if (numeric) sawNum = true;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Split a rebuilt row into label + numbers pieces: "A 1 2   B C 3" → ["A 1 2", "B C 3"]. */
export function chunkRow(text: string): string[] {
  const tokens = text
    .split(/\s+|\|/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ t, col: null }));
  return chunkTokens(tokens).map((c) => c.map((x) => x.t).join(' '));
}

/** Same, keeping each token's column (for rows read with word positions). */
export function chunkLine(l: OcrLine): OcrLine[] {
  if (!l.words?.length) return chunkRow(l.text).map((text) => ({ text, confidence: l.confidence }));
  const tokens: Tok[] = [];
  let pendingGap = false; // a table line read as "|" still marks a new cell
  for (const w of l.words) {
    const parts = w.text
      .split(/\|/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!parts.length) {
      pendingGap = pendingGap || !!w.gap || w.text.includes('|');
      continue;
    }
    parts.forEach((t, k) => tokens.push({ t, col: w.col ?? null, gap: k === 0 && (!!w.gap || pendingGap) }));
    pendingGap = false;
  }
  return chunkTokens(tokens).map((c) => ({ text: c.map((x) => x.t).join(' '), confidence: l.confidence, cols: c.map((x) => x.col) }));
}
