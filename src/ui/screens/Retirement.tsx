import { useState } from 'react';
import { ChevronDown, Pencil } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { Field, NumberInput, Progress, Sheet } from '../components';
import { saveSettings } from '../../data/actions';
import { monthlyBillsTotal } from '../../core/budget';
import { ACCOUNT_ORDER, SIMPLE_PORTFOLIO, firePlan, yearsToFiFromSavingsRate } from '../../core/fire';
import { usd } from '../../core/money';
import type { FireSettings } from '../../core/types';

/** Retirement planning, one answer at a time: where you'll land, your next step, then details on demand. */
export function RetirementView({ data }: { data: AppData }) {
  const f = data.settings.fire;
  const [editing, setEditing] = useState(false);
  const perMonth = (perCheck: number) => (perCheck * 26) / 12;

  // what already goes toward retirement from each paycheck
  const w = data.upcoming.withholding;
  const payroll = perMonth([...w.preTax.filter((d) => d.kind === 'traditional_401k'), ...w.postTax.filter((d) => d.kind === 'roth_401k')].reduce((s, d) => s + d.amount, 0));
  const match = perMonth((data.upcoming.gross.gross * f.matchPct) / 100);
  const monthlyInvest = payroll + match + f.extraMonthly;
  // retirement spending: what your life costs today, in today's dollars
  const needsMonthly = monthlyBillsTotal(data.bills) + data.essentials.totalMonthly;
  const lifestyle = (needsMonthly + perMonth(Math.max(0, data.plan.personal))) * 12;
  const annualSpending = f.annualSpending ?? Math.round(lifestyle);
  const plan = firePlan({ age: f.age, retireAge: f.retireAge, invested: f.invested, monthlyInvest, annualSpending, returnPct: f.returnPct, inflationPct: f.inflationPct, withdrawalPct: f.withdrawalPct }, needsMonthly * 12);
  const monthlyIncome = perMonth(data.upcoming.net) + match;
  const savingsRate = monthlyIncome > 0 ? ((monthlyInvest + perMonth(data.plan.savings)) / (monthlyIncome + payroll)) * 100 : 0;

  // the one next step, from the usual order of priorities
  const emergency = data.goals.find((g) => g.isEmergency && !g.archived);
  const emergencyBal = emergency ? (data.balances.get(emergency.id) ?? 0) : 0;
  const monthlyNeeds = needsMonthly || 1;
  const payrollPct = data.upcoming.gross.gross > 0 ? (perMonth(data.upcoming.gross.gross) > 0 ? (payroll / perMonth(data.upcoming.gross.gross)) * 100 : 0) : 0;
  let stepIdx: number;
  if (emergencyBal < monthlyNeeds) stepIdx = 0;
  else if (f.matchPct > 0 && payrollPct + 0.01 < f.matchPct) stepIdx = 1;
  else if (emergencyBal < monthlyNeeds * data.settings.budget.emergencyMonths) stepIdx = 3;
  else if (f.extraMonthly <= 0) stepIdx = 4;
  else if (payrollPct < 15) stepIdx = 6;
  else stepIdx = 7;
  const step = ACCOUNT_ORDER[stepIdx];

  const onTrack = plan.fiAge != null && plan.fiAge <= f.retireAge;
  const empty = f.invested <= 0 && monthlyInvest <= 0;
  const headline = empty
    ? 'Let’s map out retirement'
    : plan.fiAge == null
      ? 'Not on track yet'
      : onTrack
        ? `On track to retire by ${Math.ceil(plan.fiAge)}`
        : `At this pace: retire around ${Math.ceil(plan.fiAge)}`;

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* 1. the answer */}
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow">Retirement</div>
            <h2 style={{ fontSize: 24, marginTop: 4 }}>{headline}</h2>
          </div>
          <button className="btn small" onClick={() => setEditing(true)}>
            <Pencil /> Your numbers
          </button>
        </div>
        <p className="small ink2" style={{ margin: '8px 0 0' }}>
          {empty
            ? `Tap “Your numbers” to add your age and anything you already have in a 401(k) or IRA. To cover today’s ${usd(annualSpending / 12, true)} a month, you’d want about ${usd(plan.fi, true)} invested.`
            : plan.fiAge == null
            ? `With ${usd(monthlyInvest, true)} a month going in, savings won’t reach ${usd(plan.fi, true)}. Your next step below is the best way to change that.`
            : `You’ll need about ${usd(plan.fi, true)} invested to cover ${usd(annualSpending / 12, true)} a month for life. You’re ${Math.round(plan.progress * 100)}% of the way there.`}
        </p>
        <div className="mt">
          <Progress value={plan.progress} color="var(--jade)" />
          <div className="row between tiny muted" style={{ marginTop: 4 }}>
            <span>{usd(f.invested, true)} invested</span>
            <span>Goal {usd(plan.fi, true)}</span>
          </div>
        </div>
        <Projection points={plan.projection} target={plan.fi} />
        <div className="stat-row mt">
          <Stat label="Investing" value={`${usd(monthlyInvest, true)}/mo`} />
          <Stat label={`At age ${f.retireAge}`} value={usd(plan.atRetireAge, true)} />
          <Stat label="Pays you" value={`${usd(plan.incomeAtRetireAge / 12, true)}/mo`} />
        </div>
        <p className="tiny muted mt">All amounts are in today’s dollars.</p>
      </div>

      {/* 2. the one thing to do next */}
      <div className="card next-step">
        <div className="eyebrow">Your next step</div>
        <div className="strong" style={{ fontSize: 17, margin: '4px 0 2px' }}>
          {step.step}
        </div>
        <div className="small ink2">{step.detail}</div>
      </div>

      {/* 3. details, folded away */}
      <Disclosure title="Every step, in order">
        <ol className="small steps">
          {ACCOUNT_ORDER.map((s, i) => (
            <li key={s.step} className={i < stepIdx ? 'done' : i === stepIdx ? 'now' : ''}>
              <strong>{s.step}</strong>
              <div className="ink2">{s.detail}</div>
            </li>
          ))}
        </ol>
      </Disclosure>

      <Disclosure title="Different ways to retire">
        <div className="list">
          <Row label="Lean" value={usd(plan.leanFi, true)} note="Covers bills, groceries and gas only" />
          <Row label="Comfortable" value={usd(plan.fi, true)} note="Your life as it is today" />
          <Row label="Roomy" value={usd(plan.fatFi, true)} note="1.5× today’s spending" />
          <Row
            label="Coast"
            value={usd(plan.coastFi, true)}
            note={plan.coastReached ? `Reached: growth alone gets you there by ${f.retireAge}` : `Have this much invested and growth alone gets you there by ${f.retireAge}`}
          />
        </div>
      </Disclosure>

      <Disclosure title="How your savings rate changes things">
        <p className="small ink2" style={{ marginTop: 0 }}>
          You put away about <strong>{Math.round(savingsRate)}%</strong> of your pay. Starting from zero, here’s how long it takes to be able to retire:
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Save</th>
              <th className="r">Years to retire</th>
            </tr>
          </thead>
          <tbody>
            {[10, 15, 20, 30, 40, 50].map((r) => (
              <tr key={r} style={Math.abs(r - savingsRate) < 5 ? { background: 'var(--moss-soft)' } : undefined}>
                <td>{r}%</td>
                <td className="r num">{yearsToFiFromSavingsRate(r)?.toFixed(0) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>

      <Disclosure title="Investing, kept simple">
        {SIMPLE_PORTFOLIO.map((p) => (
          <div key={p.name} style={{ marginBottom: 10 }}>
            <div className="strong small">{p.name}</div>
            <div className="small ink2">{p.detail}</div>
          </div>
        ))}
        <p className="tiny muted">General education, not personal investment advice.</p>
      </Disclosure>

      {editing && <NumbersSheet f={f} lifestyle={lifestyle} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="tiny muted">{label}</div>
      <div className="strong num">{value}</div>
    </div>
  );
}

export function Disclosure({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [o, setO] = useState(!!open);
  return (
    <div className={`card disclosure${o ? ' open' : ''}`}>
      <button className="disclosure-head" onClick={() => setO(!o)} aria-expanded={o}>
        <span className="strong">{title}</span>
        <ChevronDown size={18} />
      </button>
      {o && <div className="disclosure-body">{children}</div>}
    </div>
  );
}

function NumbersSheet({ f, lifestyle, onClose }: { f: FireSettings; lifestyle: number; onClose: () => void }) {
  const [v, setV] = useState(f);
  const up = (patch: Partial<FireSettings>) => setV({ ...v, ...patch });
  return (
    <Sheet
      title="Your retirement numbers"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await saveSettings((s) => ({ ...s, fire: v }));
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <div className="form-grid two">
          <Field label="Your age">
            <NumberInput value={v.age} onChange={(x) => up({ age: Math.round(x ?? 28) })} />
          </Field>
          <Field label="Retire by age">
            <NumberInput value={v.retireAge} onChange={(x) => up({ retireAge: Math.round(x ?? 60) })} />
          </Field>
        </div>
        <Field label="Invested today" hint="401(k), IRA and brokerage combined. Not your Marcus savings.">
          <NumberInput value={v.invested} onChange={(x) => up({ invested: x ?? 0 })} prefix="$" />
        </Field>
        <div className="form-grid two">
          <Field label="Employer 401(k) match" hint="% of your pay">
            <NumberInput value={v.matchPct} onChange={(x) => up({ matchPct: x ?? 0 })} suffix="%" />
          </Field>
          <Field label="Other investing" hint="Roth IRA, brokerage">
            <NumberInput value={v.extraMonthly} onChange={(x) => up({ extraMonthly: x ?? 0 })} prefix="$" suffix="/mo" />
          </Field>
        </div>
        <Field label="Spending in retirement" hint={`Per year. Leave empty to use today’s ${usd(lifestyle, true)}.`}>
          <NumberInput value={v.annualSpending} allowEmpty onChange={(x) => up({ annualSpending: x })} prefix="$" />
        </Field>
        <Disclosure title="Assumptions">
          <div className="col gap-l">
            <Field label="Expected return" hint="The stock market has averaged about 7–10% a year before inflation">
              <NumberInput value={v.returnPct} onChange={(x) => up({ returnPct: x ?? 7 })} suffix="%" />
            </Field>
            <Field label="Inflation">
              <NumberInput value={v.inflationPct} onChange={(x) => up({ inflationPct: x ?? 3 })} suffix="%" />
            </Field>
            <Field label="Withdrawal rate" hint="4% is the classic rule; 3.5% if you retire very early">
              <NumberInput value={v.withdrawalPct} onChange={(x) => up({ withdrawalPct: x ?? 4 })} suffix="%" />
            </Field>
          </div>
        </Disclosure>
        <p className="tiny muted">Your 401(k) contributions come from your paycheck deductions. Upload a pay stub to fill them in.</p>
      </div>
    </Sheet>
  );
}

function Row({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <div className="grow">
        <div className="strong">{label}</div>
        <div className="small muted">{note}</div>
      </div>
      <div className="amount">{value}</div>
    </div>
  );
}

function Projection({ points, target }: { points: { age: number; balance: number }[]; target: number }) {
  const W = 600;
  const H = 150;
  const max = Math.max(target * 1.05, ...points.map((p) => p.balance), 1);
  const x = (i: number) => 4 + (i / Math.max(1, points.length - 1)) * (W - 8);
  const y = (v: number) => H - 18 - (v / max) * (H - 30);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const cross = points.findIndex((p) => p.balance >= target);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 14 }} role="img" aria-label="Invested balance by age, with your goal">
      <line x1={0} x2={W} y1={H - 18} y2={H - 18} stroke="var(--line)" strokeWidth="1" />
      <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--ink-3)" strokeWidth="1" />
      <text x={W - 4} y={y(target) - 5} fontSize="11" fill="var(--ink-2)" textAnchor="end">
        Goal
      </text>
      <path d={`${line} L${x(points.length - 1)},${H - 18} L${x(0)},${H - 18} Z`} fill="var(--jade)" opacity="0.1" />
      <path d={line} fill="none" stroke="var(--jade)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {cross >= 0 && <circle cx={x(cross)} cy={y(points[cross].balance)} r="4.5" fill="var(--jade)" stroke="var(--card)" strokeWidth="2" />}
      <text x={4} y={H - 4} fontSize="11" fill="var(--ink-3)">
        Age {points[0]?.age}
      </text>
      <text x={W - 4} y={H - 4} fontSize="11" fill="var(--ink-3)" textAnchor="end">
        Age {points[points.length - 1]?.age}
      </text>
    </svg>
  );
}

