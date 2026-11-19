// On-device text reading for receipt and pay stub photos (Tesseract, fully offline).
// The engine and English model ship inside the app (public/ocr), so nothing leaves the device.
import type { OcrLine } from '../core/receipts';
import { rowsFromWords, type OcrWord } from '../core/layout';

type Progress = (pct: number, status: string) => void;

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
let onProgress: Progress | null = null;
let psm: typeof import('tesseract.js').PSM | null = null;

function ocrBase(): string {
  return new URL('./ocr/', window.location.href).href;
}

function simdSupported(): boolean {
  try {
    // smallest module using a SIMD instruction
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        res(v);
      },
      (e) => {
        clearTimeout(t);
        rej(e);
      },
    );
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const w = await createWorker('eng', 1, {
        workerPath: ocrBase() + 'worker.min.js',
        corePath: ocrBase() + (simdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'),
        langPath: ocrBase(),
        gzip: false,
        cacheMethod: 'none',
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, m.status),
        errorHandler: (e: unknown) => console.warn('reader', e),
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: '1' });
      psm = PSM;
      return w;
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

/** Scale, gray and boost contrast so small receipt print reads cleanly. */
async function prepare(file: File, removeGrid = false): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That image could not be opened.'));
      i.src = url;
    });
    // screenshots have small, anti-aliased text: give the reader about 2× to work with
    const target = Math.min(3300, Math.max(1600, img.width * (img.width <= 1300 ? 3 : 1)));
    const scale = target / img.width;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      px[i] = px[i + 1] = px[i + 2] = g;
      hist[g | 0]++;
    }
    // stretch between the 2nd and 98th percentile
    const total = w * h;
    let lo = 0;
    let hi = 255;
    for (let acc = 0, v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc > total * 0.02) {
        lo = v;
        break;
      }
    }
    for (let acc = 0, v = 255; v >= 0; v--) {
      acc += hist[v];
      if (acc > total * 0.02) {
        hi = v;
        break;
      }
    }
    const span = Math.max(1, hi - lo);
    // dark-mode screenshots (light text on dark): flip so the reader sees dark text on white
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    const invert = sum / total < 110;
    for (let i = 0; i < px.length; i += 4) {
      let v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
      if (invert) v = 255 - v;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    if (removeGrid) eraseGridLines(px, w, h);
    ctx.putImageData(data, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type OcrLayout = 'column' | 'sparse' | 'table';

async function recognizeLines(worker: import('tesseract.js').Worker, canvas: HTMLCanvasElement, layout: OcrLayout): Promise<OcrLine[]> {
  if (psm) await worker.setParameters({ tessedit_pageseg_mode: layout === 'column' ? psm.SINGLE_COLUMN : psm.SPARSE_TEXT });
  const { data } = await withTimeout(worker.recognize(canvas, {}, { text: true, blocks: true }), 120_000, 'Reading took too long. Try a smaller, clearer photo, or type it in.');
  if (layout === 'table') {
    const words: OcrWord[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ text: w.text, confidence: w.confidence, ...w.bbox });
    return rowsFromWords(words);
  }
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        const text = l.text.replace(/\s+/g, ' ').trim();
        if (text) lines.push({ text, confidence: l.confidence });
      }
  if (!lines.length && data.text) for (const t of data.text.split('\n')) if (t.trim()) lines.push({ text: t.trim(), confidence: 60 });
  return lines;
}

/** Read an image. `retry` gets a second pass in another layout mode when the first read isn't good enough. */
export async function ocrImage(file: File, progress?: Progress, retry?: (lines: OcrLine[]) => boolean, layout: OcrLayout = 'column'): Promise<OcrLine[]> {
  onProgress = progress ?? null;
  progress?.(0, 'Getting ready');
  const [worker, canvas] = await Promise.all([
    withTimeout(getWorker(), 60_000, 'The text reader didn’t start. You can type the details in by hand instead.'),
    prepare(file, layout === 'table'),
  ]);
  try {
    const first = await recognizeLines(worker, canvas, layout);
    if (!retry || !retry(first)) return first;
    // app screenshots and stubs laid out in boxes read better as scattered text
    progress?.(0, 'recognizing text (second look)');
    const second = await recognizeLines(worker, canvas, layout === 'table' ? 'column' : 'table');
    return [...first, ...second];
  } finally {
    onProgress = null;
  }
}

/** Any receipt or stub file → lines of text (PDF, photo, or plain text). */
export async function linesFromFile(file: File, progress?: Progress, retry?: (lines: OcrLine[]) => boolean, layout: OcrLayout = 'column'): Promise<{ lines: OcrLine[]; source: 'photo' | 'pdf' | 'text' }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { pdfToLines } = await import('./pdfText');
    const lines = await withTimeout(pdfToLines(file), 60_000, 'That PDF took too long to open.');
    return { lines: lines.map((text) => ({ text, confidence: 100 })), source: 'pdf' };
  }
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|bmp)$/.test(name)) {
    return { lines: await ocrImage(file, progress, retry, layout), source: 'photo' };
  }
  const text = await file.text();
  return { lines: text.split(/\r?\n/).map((t) => ({ text: t, confidence: 100 })), source: 'text' };
}

/** Whiten long straight dark runs (table borders) so they don't turn into | and _ in the text. */
function eraseGridLines(px: Uint8ClampedArray, w: number, h: number) {
  const dark = (i: number) => px[i * 4] < 128;
  const minH = Math.max(60, Math.round(w * 0.06)); // longer than any word
  const minV = Math.max(40, Math.round(h * 0.03)); // taller than any letter
  const clear: number[] = [];
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && dark(y * w + x)) run++;
      else {
        if (run >= minH) for (let k = x - run; k < x; k++) clear.push(y * w + k);
        run = 0;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && dark(y * w + x)) run++;
      else {
        if (run >= minV) for (let k = y - run; k < y; k++) clear.push(k * w + x);
        run = 0;
      }
    }
  }
  for (const i of clear) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255;
}
