// Reads product barcodes (UPC / EAN) from photos, right on the device. The reader's engine ships
// inside the app (public/barcode), so this works offline on the phone and the desktop.
import type { ReaderOptions } from 'zxing-wasm/reader';

let ready: Promise<typeof import('zxing-wasm/reader')> | null = null;

function engineUrl(): string {
  return new URL('./barcode/zxing-reader.bin', window.location.href).href;
}

/** Load the reader once; if it fails (it shouldn't), the next scan tries again. */
function reader(): Promise<typeof import('zxing-wasm/reader')> {
  if (!ready) {
    ready = (async () => {
      const z = await import('zxing-wasm/reader');
      const res = await fetch(engineUrl());
      if (!res.ok) throw new Error(`The barcode reader didn’t load (${res.status}). Update Pebbles and try again.`);
      // handed over as bytes, so it doesn't matter how the file is served
      const wasmBinary = await res.arrayBuffer();
      await z.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
      return z;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

const OPTIONS: ReaderOptions = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
  tryHarder: true,
  tryRotate: true, // sideways or upside-down
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 12, // a shelf photo can have several products
};

/** Draw the photo (upright, per its orientation) no bigger than maxSide, as pixels the reader can scan. */
async function pixels(file: Blob, maxSide: number): Promise<ImageData> {
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // older WebViews: decode through an <img>
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('This photo couldn’t be opened.'));
        i.src = url;
      });
      bmp = await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This device couldn’t process the photo.');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return ctx.getImageData(0, 0, w, h);
}

/** All the product barcodes in a photo (none if it can't find any). */
export async function readBarcodesFromPhoto(file: Blob): Promise<string[]> {
  const z = await reader();
  const found = new Set<string>();
  // a phone-size pass first (fast), then a sharper one if nothing turned up (small or far-away codes)
  for (const side of [1600, 3000]) {
    const results = await z.readBarcodes(await pixels(file, side), OPTIONS);
    for (const r of results) if (r.isValid && /^\d{8,14}$/.test(r.text)) found.add(r.text);
    if (found.size) break;
  }
  return [...found];
}
