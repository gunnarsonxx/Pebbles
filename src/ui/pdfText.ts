// Turn a PDF statement into text lines (left-to-right, top-to-bottom) for the parser.
// pdf.js is loaded only when a PDF is imported.
export async function pdfToLines(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
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
