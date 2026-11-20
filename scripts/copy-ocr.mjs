// Copies the offline readers into public/ so they ship inside the app and work without internet:
//  - Tesseract (photos of receipts and pay stubs) with its English model
//  - the pdf.js worker (PDF statements, receipts and stubs)
//  - the zxing barcode reader (scanning what's in your kitchen); saved as .bin so no packager or
//    server mangles or mislabels it, and loaded as plain bytes
// Files are stored with plain .js / no .gz extensions: Android's packager strips ".gz" from
// asset names and may not serve ".mjs" as JavaScript, which left the readers stuck loading.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const ocr = 'public/ocr';
const pdf = 'public/pdf';
const barcode = 'public/barcode';
mkdirSync(ocr, { recursive: true });
mkdirSync(pdf, { recursive: true });
mkdirSync(barcode, { recursive: true });

const tess = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const eng = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'));
const zxing = join(dirname(require.resolve('zxing-wasm')), '../../..'); // package root (its package.json isn't exported)

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
// always refresh: the reader's code and this file must be the same version
copyFileSync(join(zxing, 'dist/reader/zxing_reader.wasm'), join(barcode, 'zxing-reader.bin'));
console.log('Offline readers ready in public/ocr, public/pdf and public/barcode');
