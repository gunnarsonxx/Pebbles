// Title Case for headings, labels and buttons (Chicago-style: small words stay lowercase
// unless they start or end the title). Abbreviations and odd casing (FICA, W-4, 401(k), APY,
// iPhone) are left exactly as written.

const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'on', 'per', 'to', 'via', 'vs', 'vs.', 'from', 'into', 'onto', 'with', 'than', 'if']);

function capWord(w: string): string {
  // leave anything that already has capitals after the first letter, digits, or symbols-only
  if (!/[a-z]/.test(w) || /[A-Z]/.test(w.slice(1)) || /^\d/.test(w)) return w;
  const i = w.search(/[a-z]/i);
  return i < 0 ? w : w.slice(0, i) + w[i].toUpperCase() + w.slice(i + 1);
}

export function titleCase(s: string): string {
  const words = s.split(/(\s+)/);
  const real = words.map((w, i) => ({ w, i })).filter((x) => x.w.trim());
  const first = real[0]?.i;
  const last = real[real.length - 1]?.i;
  return words
    .map((w, i) => {
      if (!w.trim()) return w;
      const bare = w.toLowerCase().replace(/^[("'“‘]+|[)"'”’:,.!?…]+$/g, '');
      const afterColon = i > 1 && /[:—–]$/.test(words[i - 2] ?? '');
      const opensParen = /^[("“]/.test(w);
      if (SMALL.has(bare) && i !== first && i !== last && !afterColon && !opensParen) return w === w.toUpperCase() && w.length > 1 ? w : w.toLowerCase();
      // hyphenated words: Take-Home, Year-to-Date
      return w
        .split('-')
        .map((part, k) => (k > 0 && SMALL.has(part.toLowerCase()) ? part.toLowerCase() : capWord(part)))
        .join('-');
    })
    .join('');
}
