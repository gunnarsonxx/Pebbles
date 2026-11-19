import { useState } from 'react';
import { fmtMonthShort, fmtMonth } from '../core/dates';
import { usd } from '../core/money';

export interface SplitPart {
  key: string;
  label: string;
  value: number;
  color: string;
  hint?: string;
}

/** One paycheck, split into parts (tall segmented bar + legend). */
export function SplitBar({ parts, total }: { parts: SplitPart[]; total: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const visible = parts.filter((p) => p.value > 0.5);
  const sum = visible.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="split-bar" role="img" aria-label={parts.map((p) => `${p.label} ${usd(p.value, true)}`).join(', ')}>
        {visible.map((p) => {
          const share = p.value / sum;
          return (
            <div
              key={p.key}
              className="seg"
              title={`${p.label}: ${usd(p.value)} (${Math.round(share * 100)}%)`}
              style={{ flexGrow: p.value, background: p.color, opacity: hover && hover !== p.key ? 0.55 : 1 }}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(null)}
            >
              {share > 0.12 ? `${Math.round(share * 100)}%` : ''}
            </div>
          );
        })}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <div key={p.key} className="legend-item" onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
            <span className="swatch" style={{ background: p.color }} />
            <div className="grow">
              <div className="small ink2">{p.label}</div>
              <div className="strong num">{usd(p.value, total >= 1000)}</div>
              {p.hint && <div className="tiny muted">{p.hint}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Income vs spending columns by month, with a hover tooltip. */
export function MonthBars({ data, onSelect, selected }: { data: { month: string; income: number; spending: number }[]; onSelect?: (m: string) => void; selected?: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; m: (typeof data)[number] } | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.spending]));
  const nice = niceMax(max);
  const Wd = 600;
  const Ht = 200;
  const padL = 44;
  const padB = 24;
  const plotH = Ht - padB - 8;
  const band = (Wd - padL) / Math.max(1, data.length);
  const bw = Math.min(22, band / 3.2);
  const ticks = [0, nice / 2, nice];
  const y = (v: number) => 8 + plotH - (v / nice) * plotH;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${Wd} ${Ht}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Income and spending by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={Wd} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" className="num">
              {compact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + band * i + band / 2;
          const sel = selected === d.month;
          return (
            <g
              key={d.month}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
              onClick={() => onSelect?.(d.month)}
              onMouseMove={(e) => {
                const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({ x: ((cx) / Wd) * r.width, y: (y(Math.max(d.income, d.spending)) / Ht) * r.height, m: d });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <rect x={cx - band / 2} y={0} width={band} height={Ht - padB} fill={sel ? 'var(--card-2)' : 'transparent'} rx="8" />
              <path d={barPath(cx - bw - 1, y(d.income), bw, y(0))} fill="var(--income)" />
              <path d={barPath(cx + 1, y(d.spending), bw, y(0))} fill="var(--spend)" />
              <text x={cx} y={Ht - 6} textAnchor="middle" fontSize="11" fill={sel ? 'var(--ink)' : 'var(--ink-3)'} fontWeight={sel ? 700 : 500}>
                {fmtMonthShort(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="strong">{fmtMonth(tip.m.month)}</div>
          <div>
            <span className="swatch" style={{ display: 'inline-block', background: 'var(--income)', marginRight: 6, marginTop: 0 }} />
            In {usd(tip.m.income, true)}
          </div>
          <div>
            <span className="swatch" style={{ display: 'inline-block', background: 'var(--spend)', marginRight: 6, marginTop: 0 }} />
            Out {usd(tip.m.spending, true)}
          </div>
        </div>
      )}
      <div className="row small ink2" style={{ gap: 16, marginTop: 6 }}>
        <span className="row gap-s">
          <span className="swatch" style={{ background: 'var(--income)', marginTop: 0 }} /> Money in
        </span>
        <span className="row gap-s">
          <span className="swatch" style={{ background: 'var(--spend)', marginTop: 0 }} /> Money out
        </span>
      </div>
    </div>
  );
}

function barPath(x: number, top: number, w: number, base: number): string {
  const h = base - top;
  if (h <= 0.5) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function compact(v: number): string {
  if (v >= 10000) return `$${Math.round(v / 1000)}K`;
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K`;
  return `$${Math.round(v)}`;
}

/** Horizontal bars for categories (single series, sorted). */
export function CategoryBars({ rows, onPick }: { rows: { id: string; label: string; value: number; color: string; icon?: React.ReactNode }[]; onPick?: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <button
          key={r.id}
          className="hbar-row"
          onClick={() => onPick?.(r.id)}
          style={{ width: '100%', background: 'none', border: 0, padding: '7px 0', cursor: onPick ? 'pointer' : 'default', color: 'inherit', textAlign: 'left' }}
          title={`${r.label}: ${usd(r.value)}`}
        >
          <span className="row gap-s small ellipsis">
            {r.icon}
            <span className="ellipsis">{r.label}</span>
          </span>
          <span className="hbar-track">
            <span className="hbar" style={{ display: 'block', width: `${(r.value / max) * 100}%`, background: r.color }} />
          </span>
          <span className="amount small">{usd(r.value, true)}</span>
        </button>
      ))}
    </div>
  );
}
