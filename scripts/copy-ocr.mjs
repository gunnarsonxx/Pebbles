// Copies the offline text-reading engine (Tesseract) and its English model into
// public/ocr so it ships inside the app and works without internet.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = 'public/ocr';
mkdirSync(out, { recursive: true });

const tess = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tess, 'dist/worker.min.js'), 'worker.min.js'],
  [join(core, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(eng, '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [from, to] of files) {
  const dest = join(out, to);
  if (!existsSync(dest)) copyFileSync(from, dest);
}
console.log('OCR files ready in', out);
