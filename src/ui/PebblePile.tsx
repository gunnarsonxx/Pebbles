// A small 3D heap of river stones, seen from slightly above.
// Each stone sits on a dome; stones further back are drawn first and partly
// hidden by the ones in front, and each is shaded like a rounded pebble.
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

// river-stone colors: [base, light, shadow]
const STONES: [string, string, string][] = [
  ['#9a9488', '#c9c4b8', '#6b665d'], // warm grey
  ['#b8ae9c', '#ddd5c6', '#857b69'], // sandstone
  ['#7e8389', '#b3b8bd', '#565a5f'], // slate
  ['#a8957c', '#d2c2a9', '#776650'], // tan
  ['#8c7b6b', '#b9a898', '#5f5045'], // brown
  ['#c9c2b6', '#ece8e0', '#958e82'], // quartz
  ['#6f6a64', '#9d9891', '#4a4642'], // basalt
  ['#a9836a', '#d0ae96', '#77584a'], // rust
  ['#8f9a8a', '#bcc5b8', '#636c5f'], // sage
];

export interface Stone {
  gen: number; // creation order (for the drop-in animation)
  d: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
  color: number;
  depth: number;
  speck: { cx: number; cy: number; r: number }[];
}

const W = 320;
const GROUND = 176;
const TILT = 0.34; // how much depth shows up as height on screen (camera ~20° above)

function stonePath(cx: number, cy: number, rx: number, ry: number, rot: number, rnd: () => number): string {
  const N = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const j = 0.93 + rnd() * 0.12;
    const x = Math.cos(a) * rx * j;
    const y = Math.sin(a) * ry * j * (Math.sin(a) > 0 ? 0.9 : 1.05);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
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

export function buildPile(n: number, seed: string): { stones: Stone[]; top: number; peakX: number; radius: number } {
  const base = seedOf(seed);
  // dome size grows with the number of stones
  const R = Math.max(24, Math.min(132, 18 + Math.sqrt(n) * 9.5));
  const H = R * 0.82;
  const area = 2 * R * (H + R * TILT) * 0.7;
  const avg = Math.max(7, Math.min(17, Math.sqrt((2.7 * area) / (2.3 * Math.max(n, 1)))));
  const stones: Stone[] = [];
  for (let i = 0; i < n; i++) {
    const rnd = mulberry32(base + i * 7919);
    // place on the dome; most stones face the viewer, a few have rolled off the base
    const front = rnd() < 0.7;
    const theta = front ? Math.PI + rnd() * Math.PI : rnd() * Math.PI; // sin<0 = front
    const rolled = rnd() < 0.07;
    const r = rolled ? R * (0.95 + rnd() * 0.22) : R * Math.sqrt(0.02 + rnd() * 0.86);
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);
    const rx = avg * (0.72 + rnd() * 0.6);
    const ry = rx * (0.6 + rnd() * 0.16);
    const surface = H * Math.pow(Math.max(0, 1 - (r / R) ** 2), 0.55);
    const h = Math.max(ry * 0.55, surface - rnd() * ry * 0.35);
    const cx = W / 2 + x;
    const cy = GROUND - h - z * TILT;
    const rot = (rnd() - 0.5) * 0.8;
    const pick = rnd();
    const color = pick < 0.82 ? [0, 1, 2, 3, 5, 6][Math.floor(rnd() * 6)] : [4, 7, 8][Math.floor(rnd() * 3)];
    const speck =
      rnd() < 0.3
        ? Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ cx: cx + (rnd() - 0.5) * rx, cy: cy + (rnd() - 0.3) * ry * 0.7, r: 0.5 + rnd() * 0.6 }))
        : [];
    stones.push({
      gen: i,
      d: stonePath(cx, cy, rx, ry, rot, rnd),
      cx,
      cy,
      rx,
      ry,
      rot,
      color,
      depth: z * 0.94 - h * 0.34,
      speck,
    });
  }
  // painter's order: farthest first
  stones.sort((a, b) => b.depth - a.depth);
  const top = stones.length ? Math.max(...stones.map((s) => GROUND - (s.cy - s.ry))) : 0;
  const peak = stones.reduce((best, s) => (s.cy - s.ry < best.cy - best.ry ? s : best), stones[0] ?? { cx: W / 2, cy: GROUND, ry: 0 } as Stone);
  return { stones, top, peakX: peak?.cx ?? W / 2, radius: R };
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
  animateFrom?: number; // previous amount: stones above it drop in
  label?: string;
}) {
  const n = pebbleCount(amount);
  const { stones, top, peakX, radius } = useMemo(() => buildPile(n, seed), [n, seed]);
  const firstNew = animateFrom != null ? pebbleCount(animateFrom) : n;
  const mounted = useRef(false);
  const animate = mounted.current || animateFrom != null;
  mounted.current = true;
  const vbTop = Math.min(GROUND - 118, GROUND - top - 34);
  const vbH = GROUND + radius * TILT + 14 - vbTop;
  const gid = `pp${seedOf(seed).toString(36)}`;
  return (
    <svg className="pile" viewBox={`0 ${vbTop} ${W} ${vbH}`} style={{ height }} role="img" aria-label={label ?? `${n} pebbles`}>
      <defs>
        {STONES.map(([b, l, s], i) => (
          <radialGradient key={i} id={`${gid}-s${i}`} cx="0.36" cy="0.3" r="0.85">
            <stop offset="0" stopColor={l} />
            <stop offset="0.45" stopColor={b} />
            <stop offset="1" stopColor={s} />
          </radialGradient>
        ))}
        <radialGradient id={`${gid}-ground`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.22" />
          <stop offset="0.7" stopColor="#000" stopOpacity="0.08" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      {n > 0 ? (
        <ellipse cx={W / 2} cy={GROUND + 2} rx={radius * 1.18 + 10} ry={radius * TILT * 1.25 + 7} fill={`url(#${gid}-ground)`} />
      ) : (
        <g opacity="0.6">
          <ellipse cx={W / 2} cy={GROUND - 4} rx={22} ry={8} fill={`url(#${gid}-ground)`} />
          <ellipse cx={W / 2} cy={GROUND - 9} rx={14} ry={8} fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="3 4" />
        </g>
      )}
      {stones.map((p) => {
        const drop = animate && p.gen >= firstNew;
        return (
          <g key={p.gen} className={`pebble${drop ? ' drop' : ''}`} style={drop ? { animationDelay: `${(p.gen - firstNew) * 40}ms` } : undefined}>
            {/* contact shadow */}
            <ellipse cx={p.cx + p.rx * 0.12} cy={p.cy + p.ry * 0.62} rx={p.rx * 0.95} ry={p.ry * 0.45} fill="#000" opacity="0.16" />
            <path d={p.d} fill={`url(#${gid}-s${p.color})`} />
            <ellipse
              cx={p.cx - p.rx * 0.32}
              cy={p.cy - p.ry * 0.42}
              rx={p.rx * 0.32}
              ry={p.ry * 0.16}
              fill="#fff"
              opacity="0.32"
              transform={`rotate(${(p.rot * 180) / Math.PI - 10} ${p.cx - p.rx * 0.32} ${p.cy - p.ry * 0.42})`}
            />
            {p.speck.map((s, k) => (
              <circle key={k} cx={s.cx} cy={s.cy} r={s.r} fill="#2a2724" opacity="0.22" />
            ))}
          </g>
        );
      })}
      {gems.map((g, i) => {
        const gx = peakX + (i - (gems.length - 1) / 2) * 20;
        const gy = GROUND - top - 10 + Math.abs(i - (gems.length - 1) / 2) * 6;
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
