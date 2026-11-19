// Turn a PDF statement into text lines (left-to-right, top-to-bottom) for the parser.
// pdf.js is loaded only when a PDF is imported.
export async function pdfToLines(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // shipped as a plain .js file so every platform serves it as JavaScript
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf/pdf.worker.min.js', window.location.href).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as { str: string; transform: number[]; width: number }[])
      .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    // group into rows by y (pdf y grows upward)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: (typeof items)[] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) < 2.5);
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    for (const r of rows) {
      r.sort((a, b) => a.x - b.x);
      let line = '';
      let lastEnd = -Infinity;
      for (const it of r) {
        const gap = it.x - lastEnd;
        line += line ? (gap > 12 ? '   ' : gap > 1.5 ? ' ' : '') : '';
        line += it.s;
        lastEnd = it.x + it.w;
      }
      lines.push(line.trim());
    }
  }
  return lines;
}

/** Every word in a PDF with its position (pages stacked top to bottom), for reading tables. */
export async function pdfToWords(file: File): Promise<import('../core/layout').OcrWord[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf/pdf.worker.min.js', window.location.href).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const words: import('../core/layout').OcrWord[] = [];
  let offset = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const it of content.items as { str: string; transform: number[]; width: number; height: number }[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const size = Math.abs(it.transform[3]) || it.height || 10;
      const x = it.transform[4];
      const top = offset + (vp.height - it.transform[5] - size);
      // split a text run into words, spacing them by character count
      const per = it.str.length ? it.width / it.str.length : 0;
      let i = 0;
      for (const part of it.str.split(/(\s+)/)) {
        if (part.trim()) words.push({ text: part, confidence: 100, x0: x + i * per, x1: x + (i + part.length) * per, y0: top, y1: top + size });
        i += part.length;
      }
    }
    offset += vp.height + 20;
  }
  return words;
}
