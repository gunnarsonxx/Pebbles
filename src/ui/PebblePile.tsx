import { useMemo, useRef } from 'react';
import type { GemName } from '../core/types';
import { GEM_BY_ID } from '../core/categories';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pebbleCount(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(3, Math.min(170, Math.round(3 + Math.sqrt(amount) * 1.6)));
}

interface Pebble {
  d: string;
  hi: { cx: number; cy: number; rx: number; ry: number; rot: number };
  fill: string;
  speck: { cx: number; cy: number; r: number }[];
}

const W = 320;
const H = 170;
const GROUND = 164;
const FILLS = ['var(--pebble-1)', 'var(--pebble-2)', 'var(--pebble-3)', 'var(--pebble-4)', 'var(--pebble-5)'];

function pebblePath(cx: number, cy: number, rx: number, ry: number, rot: number, rnd: () => number): string {
  const pts: [number, number][] = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const j = 0.92 + rnd() * 0.14;
    const x = Math.cos(a) * rx * j;
    const y = Math.sin(a) * ry * j * (Math.sin(a) > 0 ? 0.92 : 1.04); // flatter bottom
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  // Catmull-Rom to cubic Bezier, closed
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

export function buildPile(n: number, seed: string): { pebbles: Pebble[]; top: number; peakX: number } {
  const rnd = mulberry32(seedOf(seed));
  const heights = new Float32Array(W);
  const avg = Math.max(6.5, Math.min(14, Math.sqrt(14000 / (Math.max(n, 1) * 2.1))));
  const pebbles: Pebble[] = [];
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  for (let i = 0; i < n; i++) {
    const rx = avg * (0.75 + rnd() * 0.55);
    const ry = rx * (0.56 + rnd() * 0.2);
    // drop near the middle, then let it roll downhill until it rests, like a real pile
    const lo = rx + 6;
    const hi = W - rx - 6;
    const baseAt = (x: number) => {
      let b = 0;
      for (let c = Math.floor(x - rx * 0.7); c <= Math.ceil(x + rx * 0.7); c++) b = Math.max(b, heights[c] ?? 0);
      return b;
    };
    let bestX = Math.max(lo, Math.min(hi, W / 2 + gauss() * W * 0.18));
    const hAt = (x: number) => heights[Math.max(0, Math.min(W - 1, Math.round(x)))];
    const reach = rx * 1.5;
    const repose = ry * 0.9; // how steep a slope a pebble can rest on (over 1.5 radii)
    for (let step = 0; step < 80; step++) {
      const c = baseAt(bestX);
      const l = bestX - reach > lo ? hAt(bestX - reach) : Infinity;
      const r = bestX + reach < hi ? hAt(bestX + reach) : Infinity;
      const goLeft = c - l > repose && (l < r || (l === r && rnd() < 0.5));
      const goRight = !goLeft && c - r > repose;
      if (goLeft) bestX -= rx * 0.5;
      else if (goRight) bestX += rx * 0.5;
      else break;
    }
    const bestBase = baseAt(bestX);
    const cy = GROUND - bestBase - ry * 0.78;
    for (let c = Math.floor(bestX - rx); c <= Math.ceil(bestX + rx); c++) {
      if (c < 0 || c >= W) continue;
      const dx = (c - bestX) / rx;
      if (Math.abs(dx) > 1) continue;
      const h = GROUND - cy + ry * Math.sqrt(1 - dx * dx) * 0.8;
      heights[c] = Math.max(heights[c], h);
    }
    const rot = (rnd() - 0.5) * 0.7;
    const fill = FILLS[Math.floor(rnd() * FILLS.length)];
    const speck = rnd() < 0.35 ? Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ cx: bestX + (rnd() - 0.5) * rx, cy: cy + (rnd() - 0.3) * ry * 0.8, r: 0.6 + rnd() * 0.7 })) : [];
    pebbles.push({
      d: pebblePath(bestX, cy, rx, ry, rot, rnd),
      hi: { cx: bestX - rx * 0.28, cy: cy - ry * 0.38, rx: rx * 0.42, ry: ry * 0.22, rot: (rot * 180) / Math.PI - 8 },
      fill,
      speck,
    });
  }
  let top = 0;
  let peakX = W / 2;
  heights.forEach((h, i) => {
    if (h > top) {
      top = h;
      peakX = i;
    }
  });
  return { pebbles, top, peakX };
}

export function PebblePile({
  amount,
  seed,
  gems = [],
  height = 170,
  animateFrom,
  label,
}: {
  amount: number;
  seed: string;
  gems?: GemName[];
  height?: number;
  animateFrom?: number; // previous amount: pebbles above it drop in
  label?: string;
}) {
  const n = pebbleCount(amount);
  const { pebbles, top, peakX } = useMemo(() => buildPile(n, seed), [n, seed]);
  const firstNew = animateFrom != null ? pebbleCount(animateFrom) : n;
  const mounted = useRef(false);
  const animate = mounted.current || animateFrom != null;
  mounted.current = true;
  const vbTop = Math.min(0, GROUND - top - 30);
  return (
    <svg className="pile" viewBox={`0 ${vbTop} ${W} ${H - vbTop}`} style={{ height }} role="img" aria-label={label ?? `${n} pebbles`}>
      <ellipse cx={W / 2} cy={GROUND + 2} rx={W * 0.44} ry={6} fill="var(--line)" opacity="0.7" />
      {n === 0 && (
        <g opacity="0.55">
          <ellipse cx={W / 2} cy={GROUND - 6} rx={16} ry={9} fill="none" stroke="var(--line-2)" strokeWidth="2" strokeDasharray="4 4" />
        </g>
      )}
      {pebbles.map((p, i) => (
        <g key={i} className={`pebble${animate && i >= firstNew ? ' drop' : ''}`} style={animate && i >= firstNew ? { animationDelay: `${(i - firstNew) * 45}ms` } : undefined}>
          <path d={p.d} fill={p.fill} stroke="var(--card)" strokeWidth="1.2" />
          <ellipse cx={p.hi.cx} cy={p.hi.cy} rx={p.hi.rx} ry={p.hi.ry} fill="var(--pebble-hi)" transform={`rotate(${p.hi.rot} ${p.hi.cx} ${p.hi.cy})`} />
          {p.speck.map((s, k) => (
            <circle key={k} cx={s.cx} cy={s.cy} r={s.r} fill="var(--ink)" opacity="0.18" />
          ))}
        </g>
      ))}
      {gems.map((g, i) => {
        const gx = peakX + (i - (gems.length - 1) / 2) * 20;
        const gy = GROUND - top - 12 + Math.abs(i - (gems.length - 1) / 2) * 6;
        const c = GEM_BY_ID[g]?.color ?? '#ccc';
        return (
          <g key={g + i} transform={`translate(${gx - 9} ${gy - 9}) scale(0.75)`}>
            <polygon points="12,2 21,8.5 17.5,21 6.5,21 3,8.5" fill={c} stroke="var(--card)" strokeWidth="1.5" />
            <polygon points="12,2 21,8.5 12,10" fill="#fff" opacity="0.3" />
            <polygon points="21,8.5 12,10 17.5,21" fill="#000" opacity="0.18" />
          </g>
        );
      })}
    </svg>
  );
}
