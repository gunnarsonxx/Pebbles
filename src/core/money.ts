export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function roundTo(n: number, step: number): number {
  if (!step || step <= 0) return round2(n);
  return Math.round(n / step) * step;
}

export function floorTo(n: number, step: number): number {
  if (!step || step <= 0) return round2(n);
  return Math.floor(n / step) * step;
}

const fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** $1,234.56 (or $1,235 when whole=true) */
export function usd(n: number, whole = false): string {
  const v = Object.is(n, -0) ? 0 : n;
  return whole ? fmt0.format(Math.round(v)) : fmt2.format(round2(v));
}

/** +$12.00 / −$12.00 with a real minus sign */
export function signedUsd(n: number, whole = false): string {
  if (Math.abs(n) < 0.005) return usd(0, whole);
  return (n > 0 ? '+' : '−') + usd(Math.abs(n), whole);
}

/** Pebbles are dollars: shown in full, cents included when there are any (1,234.56). */
export function pebbles(n: number): string {
  const v = Math.max(0, round2(n));
  return Number.isInteger(v) ? int.format(v) : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

/** Parse "$1,234.56", "(12.00)", "12.00-", "-12", "12.00 CR" */
export function parseAmount(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  const trail = s.match(/\s*(CR|DR|DB|-)$/i);
  if (trail) {
    const t = trail[1].toUpperCase();
    if (t !== 'CR') neg = !neg;
    s = s.slice(0, s.length - trail[0].length);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  if (!isFinite(v)) return null;
  return neg ? -v : v;
}

export function uid(prefix = ''): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return (
    prefix +
    Array.from(a, (b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 14)
  );
}

/** Small, fast, deterministic string hash (FNV-1a 32 bit) as base36. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
