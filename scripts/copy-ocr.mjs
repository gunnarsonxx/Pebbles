// Copies the offline readers into public/ so they ship inside the app and work without internet:
//  - Tesseract (photos of receipts and pay stubs) with its English model
//  - the pdf.js worker (PDF statements, receipts and stubs)
// Files are stored with plain .js / no .gz extensions: Android's packager strips ".gz" from
// asset names and may not serve ".mjs" as JavaScript, which left the readers stuck loading.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const ocr = 'public/ocr';
const pdf = 'public/pdf';
mkdirSync(ocr, { recursive: true });
mkdirSync(pdf, { recursive: true });

const tess = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'));

const copy = (from, to) => {
  if (!existsSync(to)) copyFileSync(from, to);
};
copy(join(tess, 'dist/worker.min.js'), join(ocr, 'worker.min.js'));
copy(join(core, 'tesseract-core-simd-lstm.wasm.js'), join(ocr, 'tesseract-core-simd-lstm.wasm.js'));
copy(join(core, 'tesseract-core-lstm.wasm.js'), join(ocr, 'tesseract-core-lstm.wasm.js'));
const model = join(ocr, 'eng.traineddata');
if (!existsSync(model)) writeFileSync(model, gunzipSync(readFileSync(join(eng, '4.0.0_best_int/eng.traineddata.gz'))));
rmSync(join(ocr, 'eng.traineddata.gz'), { force: true });
copy(join(pdfjs, 'legacy/build/pdf.worker.min.mjs'), join(pdf, 'pdf.worker.min.js'));
console.log('Offline readers ready in public/ocr and public/pdf');
