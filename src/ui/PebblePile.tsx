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

// river-stone colors, matte and muted: [base, light, shadow]
const STONES: [string, string, string][] = [
  ['#8f8a82', '#b4afa6', '#5e5a54'], // warm grey
  ['#a69c8c', '#c7bfb1', '#736a5c'], // sandstone
  ['#7d7b78', '#a3a19d', '#53514e'], // granite grey
  ['#9b8b76', '#bdae99', '#6a5c4b'], // tan
  ['#7c6c5f', '#9e8f82', '#52463d'], // brown
  ['#b9b3a8', '#d6d1c7', '#86806f'], // pale quartz
  ['#5f5c58', '#85827d', '#3d3b38'], // basalt
  ['#94806f', '#b5a291', '#665446'], // rust-brown
  ['#878679', '#a9a89b', '#5d5c51'], // olive grey
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
  const N = 11;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const j = 0.9 + rnd() * 0.16;
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
  // a low, wide mound (piles of stones slump to about 30-35 degrees)
  const R = Math.max(22, Math.min(136, 16 + Math.sqrt(n) * 9.2));
  const H = R * 0.62;
  // On screen, the front of the mound runs from its crest (z = 0) down to the near rim.
  const crest = (x: number) => GROUND - H * (1 - (x / R) ** 2);
  const rim = (x: number) => GROUND + Math.sqrt(Math.max(0, R * R - x * x)) * TILT;
  // Spread stones evenly *on screen* (not over the dome), so the lower front is as full as the top.
  const area = (4 / 3) * H * R + (Math.PI / 2) * TILT * R * R;
  let cell = Math.sqrt(area / Math.max(n, 1));
  let spots: { x: number; y: number; k: number }[] = [];
  for (let tries = 0; tries < 6; tries++) {
    spots = [];
    let k = 0;
    for (let y = crest(0) - cell / 2; y < rim(0) + cell; y += cell)
      for (let x = -R; x <= R; x += cell) {
        const rnd = mulberry32(base + (k++ * 7919));
        const jx = x + (rnd() - 0.5) * cell * 0.8;
        const jy = y + (rnd() - 0.5) * cell * 0.8;
        if (Math.abs(jx) < R * 0.98 && jy >= crest(jx) - cell * 0.15 && jy <= rim(jx) - cell * 0.1) spots.push({ x: jx, y: jy, k });
      }
    if (spots.length >= n) break;
    cell *= 0.9;
  }
  // more spots than stones: keep an even spread
  if (spots.length > n) spots = spots.filter((_, i) => Math.floor((i * n) / spots.length) !== Math.floor(((i - 1) * n) / spots.length) || i === 0).slice(0, n);
  const avg = Math.max(6, Math.min(20, cell * 1.12));
  const stones: Stone[] = [];
  spots.forEach((sp, i) => {
    const rnd = mulberry32(base ^ (sp.k * 2654435761));
    // where on the dome this screen point is: solve  y = GROUND - H(1 - (x²+z²)/R²) - z·TILT  for z ≤ 0
    const qa = H / (R * R);
    const qc = GROUND - H * (1 - (sp.x * sp.x) / (R * R)) - sp.y;
    const disc = TILT * TILT - 4 * qa * qc;
    const z = disc > 0 ? (TILT - Math.sqrt(disc)) / (2 * qa) : 0;
    const h = Math.max(0, H * (1 - (sp.x * sp.x + z * z) / (R * R)));
    const rx = avg * (0.75 + rnd() * 0.55);
    const ry = rx * (0.52 + rnd() * 0.2); // flattish river stones lying down
    const cx = W / 2 + sp.x;
    // rest on the ground at the edge
    const cy = Math.min(sp.y, GROUND - z * TILT - ry * 0.5);
    const rot = (rnd() - 0.5) * 0.7;
    const pick = rnd();
    const color = pick < 0.85 ? [0, 1, 2, 3, 5, 6][Math.floor(rnd() * 6)] : [4, 7, 8][Math.floor(rnd() * 3)];
    const speck = Array.from({ length: Math.floor(rnd() * 4) }, () => ({ cx: cx + (rnd() - 0.5) * rx * 1.2, cy: cy + (rnd() - 0.4) * ry * 0.9, r: 0.35 + rnd() * 0.5 }));
    stones.push({ gen: i, d: stonePath(cx, cy, rx, ry, rot, rnd), cx, cy, rx, ry, rot, color, depth: z - h * 0.35, speck });
  });
  // fill order for the drop-in animation: bottom first, top last
  stones.sort((a, b) => b.cy - a.cy).forEach((st, i) => (st.gen = i));
  // painter's order: far and low first, near and high last
  stones.sort((a, b) => b.depth - a.depth);
  const top = stones.length ? Math.max(...stones.map((st) => GROUND - (st.cy - st.ry))) : 0;
  const peak = stones.reduce((best, st) => (st.cy - st.ry < best.cy - best.ry ? st : best), stones[0] ?? ({ cx: W / 2, cy: GROUND, ry: 0 } as Stone));
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
          <radialGradient key={i} id={`${gid}-s${i}`} cx="0.4" cy="0.32" r="0.8">
            <stop offset="0" stopColor={l} />
            <stop offset="0.55" stopColor={b} />
            <stop offset="1" stopColor={s} />
          </radialGradient>
        ))}
        {/* stone grain: fine noise multiplied into the stones */}
        <filter id={`${gid}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.8 0.42" result="dots" />
          <feComposite in="dots" in2="SourceGraphic" operator="in" result="grain" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="grain" />
          </feMerge>
        </filter>
        <radialGradient id={`${gid}-ground`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.32" />
          <stop offset="0.65" stopColor="#000" stopOpacity="0.14" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      {n > 0 ? (
        <>
          <ellipse cx={W / 2} cy={GROUND + 1} rx={radius * 1.15 + 10} ry={radius * TILT * 1.15 + 6} fill={`url(#${gid}-ground)`} />
          {/* where the pile meets the ground */}
          <ellipse cx={W / 2} cy={GROUND - 1} rx={radius * 0.98} ry={radius * TILT * 0.7 + 2} fill="#000" opacity="0.18" />
        </>
      ) : (
        <g opacity="0.6">
          <ellipse cx={W / 2} cy={GROUND - 4} rx={22} ry={8} fill={`url(#${gid}-ground)`} />
          <ellipse cx={W / 2} cy={GROUND - 9} rx={14} ry={8} fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="3 4" />
        </g>
      )}
      <g filter={`url(#${gid}-grain)`}>
        {stones.map((p) => {
          const drop = animate && p.gen >= firstNew;
          return (
            <g key={p.gen} className={`pebble${drop ? ' drop' : ''}`} style={drop ? { animationDelay: `${(p.gen - firstNew) * 40}ms` } : undefined}>
              {/* shade cast on the stones underneath */}
              <ellipse cx={p.cx + p.rx * 0.1} cy={p.cy + p.ry * 0.55} rx={p.rx * 1.02} ry={p.ry * 0.5} fill="#000" opacity="0.22" />
              <path d={p.d} fill={`url(#${gid}-s${p.color})`} stroke={STONES[p.color][2]} strokeOpacity="0.45" strokeWidth="0.6" />
              {/* a soft matte sheen, not a glossy highlight */}
              <ellipse
                cx={p.cx - p.rx * 0.28}
                cy={p.cy - p.ry * 0.38}
                rx={p.rx * 0.42}
                ry={p.ry * 0.22}
                fill="#fff"
                opacity="0.1"
                transform={`rotate(${(p.rot * 180) / Math.PI - 8} ${p.cx - p.rx * 0.28} ${p.cy - p.ry * 0.38})`}
              />
              {p.speck.map((sp, k) => (
                <circle key={k} cx={sp.cx} cy={sp.cy} r={sp.r} fill="#2a2724" opacity="0.28" />
              ))}
            </g>
          );
        })}
      </g>
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
