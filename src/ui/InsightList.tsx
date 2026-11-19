import { Ban, Lightbulb, Scissors, Sprout, ThumbsUp, TriangleAlert, X, Sparkles } from 'lucide-react';
import type { Insight, InsightKind } from '../core/insights';
import { usd } from '../core/money';
import { dismissInsight } from '../data/actions';

const KIND: Record<InsightKind, { icon: typeof Lightbulb; color: string; label: string }> = {
  save: { icon: Sprout, color: 'var(--jade)', label: 'Save more' },
  quit: { icon: Ban, color: 'var(--spend)', label: 'Habit to quit' },
  keep: { icon: ThumbsUp, color: 'var(--good)', label: 'Habit to keep' },
  cut: { icon: Scissors, color: 'var(--citrine)', label: 'Cut back' },
  heads_up: { icon: TriangleAlert, color: 'var(--warn)', label: 'Heads up' },
  win: { icon: Sparkles, color: 'var(--amethyst)', label: 'Good news' },
};

export function InsightList({ items, limit, dismissable = true }: { items: Insight[]; limit?: number; dismissable?: boolean }) {
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length) return <p className="small muted">Nothing new to flag. Your money is behaving.</p>;
  return (
    <div className="list">
      {shown.map((n) => {
        const k = KIND[n.kind];
        return (
          <div key={n.id} className="list-item insight">
            <div className="list-icon" style={{ background: `color-mix(in srgb, ${k.color} 14%, var(--card))`, color: k.color }}>
              <k.icon />
            </div>
            <div className="grow">
              <div className="tiny muted strong" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {k.label}
                {n.monthlyImpact > 1 && <span className="badge good" style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>≈ {usd(n.monthlyImpact, true)}/mo</span>}
              </div>
              <div className="strong" style={{ margin: '2px 0 3px' }}>
                {n.title}
              </div>
              <div className="small ink2">{n.body}</div>
            </div>
            {dismissable && (
              <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => void dismissInsight(n.id)}>
                <X />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
