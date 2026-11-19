// Rebuild table rows from words the reader found anywhere on the page.
// Pay stubs are grids: reading them as one column jumbles them, reading them as scattered
// words loses which number goes with which label. Grouping words by height on the page puts
// "Federal W/H 119.84 3298.76" back together; wide gaps between words become column breaks.
import type { OcrLine } from './receipts';

export interface OcrWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

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
  return rows.map((row) => {
    row.sort((a, b) => a.x0 - b.x0);
    let text = '';
    let conf = 0;
    row.forEach((w, i) => {
      if (i > 0) text += w.x0 - row[i - 1].x1 > h * 1.6 ? COL_GAP : ' ';
      text += w.text.trim();
      conf += w.confidence;
    });
    return { text, confidence: conf / row.length };
  });
}

const NUMERIC = /^[-($]*\d[\d,]*(\.\d+)?\)?%?$/;

/** Split a rebuilt row into label + numbers pieces: "A 1 2   B C 3" → ["A 1 2", "B C 3"]. */
export function chunkRow(text: string): string[] {
  const tokens = text.split(/\s+|\|/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  let sawNum = false;
  for (const t of tokens) {
    const numeric = NUMERIC.test(t);
    if (!numeric && sawNum) {
      out.push(cur.join(' '));
      cur = [];
      sawNum = false;
    }
    cur.push(t);
    if (numeric) sawNum = true;
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}
