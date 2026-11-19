import { Check, Circle, Compass, PiggyBank, Sparkles, TriangleAlert, CircleCheck, CircleDot } from 'lucide-react';
import type { AppData } from '../data/useData';
import { setBonusMove, setMove } from '../data/autopilot';
import { fmtDay, fmtShort } from '../core/dates';
import { pebbles, usd } from '../core/money';
import { projectSavings } from '../core/savingsAccount';
import type { Standing } from '../core/guidelines';

/** Home: what to do with this paycheck. The only part of money you have to think about. */
export function MovesCard({ data }: { data: AppData }) {
  const m = data.movesFor;
  if (!m) return null;
  const { period, plan, moves, isPast } = m;
  const daysTo = Math.round((Date.parse(period.payday) - Date.parse(data.today)) / 86_400_000);
  const allDone = moves.filter((x) => x.checkable).every((x) => x.done);
  const header = isPast || daysTo <= 0 ? `Payday moves · ${fmtDay(period.payday)}` : `On payday (${fmtDay(period.payday)}), do this`;
  return (
    <div className="card mt">
      <div className="card-head">
        <div>
          <div className="eyebrow">{header}</div>
          <div className="small muted">
            {allDone && (isPast || daysTo <= 0) ? 'All done. Nothing else to think about until next payday.' : 'Pebbles did the math. You just move the money.'}
          </div>
        </div>
        <Compass style={{ color: 'var(--moss)' }} />
      </div>
      <div className="list">
        {moves.map((mv) => (
          <div key={mv.key} className="list-item" style={{ alignItems: 'flex-start' }}>
            {mv.checkable ? (
              <button
                className="icon-btn"
                style={{ marginTop: -6 }}
                aria-label={mv.done ? 'Mark not done' : 'Mark done'}
                onClick={() => {
                  if (mv.key === 'bonus') {
                    const g = data.goals.find((x) => !x.archived && !x.completedAt && !x.isEmergency) ?? data.goals.find((x) => !x.archived);
                    void setBonusMove(period, mv.amount, g?.id ?? null, !mv.done);
                  } else void setMove(period, plan, mv.key, !mv.done);
                }}
              >
                {mv.done ? <CircleCheck style={{ color: 'var(--good)' }} /> : <Circle />}
              </button>
            ) : (
              <div className="icon-btn" style={{ marginTop: -6, cursor: 'default' }}>
                <CircleDot style={{ color: 'var(--ink-3)' }} />
              </div>
            )}
            <div className="grow">
              <div className="strong" style={mv.done ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}>
                {mv.title}
              </div>
              <div className="small muted">{mv.detail}</div>
              {mv.done && mv.auto && (
                <div className="tiny good row gap-s">
                  <Check size={12} /> Spotted in your bank, checked off for you
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Savings: the real account your goals live in (e.g. Marcus) and its interest. */
export function SavingsAccountCard({ data }: { data: AppData }) {
  const acct = data.goalsAccount;
  const monthlyDeposit = (data.plan.savings * 26) / 12;
  const balance = acct?.balance ?? data.saved;
  const apy = acct?.apy ?? null;
  const proj = apy ? projectSavings(balance, apy, monthlyDeposit, 12) : null;
  const rec = data.reconcile;
  if (!acct) {
    return (
      <div className="card tint mt">
        <div className="row">
          <PiggyBank style={{ color: 'var(--jade)' }} />
          <div className="grow small ink2">
            Keep your goals in a high-yield savings account like Marcus? Connect it (Spending → Accounts) or import its statement, then mark it as “My savings goals live here”. Pebbles will add its interest to your pile and project the next 12 months.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="card mt">
      <div className="card-head">
        <div>
          <div className="eyebrow">{acct.name}</div>
          <div className="small muted">{apy ? `${apy}% APY · interest compounds daily, paid monthly` : 'Add the APY under Spending → Accounts to project interest'}</div>
        </div>
        <PiggyBank style={{ color: 'var(--jade)' }} />
      </div>
      <div className="grid three">
        <div>
          <div className="small muted">Balance</div>
          <div className="big-number">{usd(balance, true)}</div>
          {acct.balanceDate && <div className="tiny muted">as of {fmtShort(acct.balanceDate)}</div>}
        </div>
        <div>
          <div className="small muted">Interest next month</div>
          <div className="big-number good">+{usd(data.interestMonthly)}</div>
          <div className="tiny muted">added to your goals automatically</div>
        </div>
        {proj && (
          <div>
            <div className="small muted">In 12 months</div>
            <div className="big-number">{usd(proj[12].balance, true)}</div>
            <div className="tiny muted">incl. about {usd(proj[12].interestTotal, true)} interest</div>
          </div>
        )}
      </div>
      {proj && <Projection points={proj.map((p) => p.balance)} />}
      {rec && Math.abs(rec.difference) >= 1 && (
        <p className="small ink2 mt row gap-s" style={{ alignItems: 'flex-start' }}>
          <Sparkles size={15} style={{ flexShrink: 0, marginTop: 2, color: 'var(--amethyst)' }} />
          {rec.difference > 0
            ? `${acct.name} holds ${usd(rec.difference)} more than your goals track (${pebbles(rec.goals)} pebbles). That’s money saved before Pebbles or interest not yet split; it’s still yours.`
            : `Your goals track ${usd(-rec.difference)} more than ${acct.name} shows. If you took money out, record it on the goal so the pile stays honest.`}
        </p>
      )}
    </div>
  );
}

function Projection({ points }: { points: number[] }) {
  const W = 600;
  const H = 120;
  const min = Math.min(...points) * 0.98;
  const max = Math.max(...points) * 1.01;
  const x = (i: number) => (i / (points.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 6 - ((v - min) / Math.max(1, max - min)) * (H - 16);
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 12 }} role="img" aria-label="Savings balance over the next 12 months">
      <line x1={0} x2={W} y1={H - 6} y2={H - 6} stroke="var(--line)" strokeWidth="1" />
      <path d={`${line} L${x(points.length - 1)},${H - 6} L${x(0)},${H - 6} Z`} fill="var(--jade)" opacity="0.1" />
      <path d={line} fill="none" stroke="var(--jade)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="4" fill="var(--jade)" stroke="var(--card)" strokeWidth="2" />
      <text x={4} y={H - 10} fontSize="11" fill="var(--ink-3)">
        Now
      </text>
      <text x={W - 4} y={H - 10} fontSize="11" fill="var(--ink-3)" textAnchor="end">
        12 months
      </text>
    </svg>
  );
}

const STANDING: Record<Standing, { icon: typeof Check; color: string; label: string }> = {
  good: { icon: CircleCheck, color: 'var(--good)', label: 'On track' },
  close: { icon: CircleDot, color: 'var(--warn)', label: 'Getting there' },
  off: { icon: TriangleAlert, color: 'var(--bad)', label: 'Needs attention' },
};

/** Plan: how your split compares to what the experts broadly agree on. */
export function GuidelinesCard({ data }: { data: AppData }) {
  return (
    <div className="card mt">
      <div className="card-head">
        <div>
          <div className="eyebrow">How you compare to the experts</div>
          <div className="small muted">Pebbles follows these automatically when it plans each paycheck</div>
        </div>
      </div>
      <div className="list">
        {data.guidelineChecks.map((c) => {
          const s = STANDING[c.standing];
          return (
            <div key={c.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <s.icon size={20} style={{ color: s.color, flexShrink: 0, marginTop: 2 }} aria-label={s.label} />
              <div className="grow">
                <div className="row between">
                  <span className="strong">{c.label}</span>
                  <span className="num small">
                    <strong>{c.yours}</strong> <span className="muted">· aim {c.target}</span>
                  </span>
                </div>
                <div className="small muted">{c.note}</div>
              </div>
            </div>
          );
        })}
      </div>
      <details className="mt">
        <summary className="small strong" style={{ cursor: 'pointer' }}>
          Where these come from
        </summary>
        <ul className="small ink2" style={{ paddingLeft: 18 }}>
          {data.guidelines.consensus.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <ul className="tiny muted" style={{ paddingLeft: 18 }}>
          {data.guidelines.sources.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong> ({s.by}): {s.summary}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
