import { useEffect, useState } from 'react';
import { ExternalLink, Flame, Mountain, RefreshCw, TrendingUp } from 'lucide-react';
import { Browser } from '@capacitor/browser';
import type { AppData } from '../../data/useData';
import { Field, NumberInput, Progress } from '../components';
import { saveSettings } from '../../data/actions';
import { store } from '../../data/store';
import { desktop, http, platformKind } from '../../platform';
import { monthlyBillsTotal } from '../../core/budget';
import { ACCOUNT_ORDER, SIMPLE_PORTFOLIO, firePlan, parseRedditFeed, yearsToFiFromSavingsRate, type FeedItem } from '../../core/fire';
import { usd } from '../../core/money';
import type { FireSettings } from '../../core/types';

const FEED = 'https://www.reddit.com/r/financialindependence/top/.rss?t=week';

function openLink(url: string) {
  if (desktop) void desktop.openExternal(url);
  else if (platformKind === 'android') void Browser.open({ url });
  else window.open(url, '_blank');
}

export function GrowScreen({ data }: { data: AppData }) {
  const f = data.settings.fire;
  const up = (patch: Partial<FireSettings>) => void saveSettings((s) => ({ ...s, fire: { ...s.fire, ...patch } }));
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

  return (
    <div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="eyebrow">Your FI number</div>
        <div className="hero-number" style={{ margin: '6px 0 2px' }}>
          {usd(plan.fi, true)}
        </div>
        <div className="small ink2">
          {usd(annualSpending, true)} a year × {Math.round(100 / f.withdrawalPct)} (the {f.withdrawalPct}% rule). At this point your investments can pay for your life on their own.
        </div>
        <div className="mt">
          <Progress value={plan.progress} color="var(--jade)" />
          <div className="row between tiny muted" style={{ marginTop: 4 }}>
            <span>{usd(f.invested, true)} invested</span>
            <span>{Math.round(plan.progress * 100)}%</span>
          </div>
        </div>
        <div className="grid three mt-l">
          <div>
            <div className="small muted">Financially independent at</div>
            <div className="big-number">{plan.fiAge != null ? `age ${Math.floor(plan.fiAge)}` : '—'}</div>
            <div className="tiny muted">{plan.monthsToFi != null ? `in about ${Math.round(plan.monthsToFi / 12)} years` : 'Increase investing to get there'}</div>
          </div>
          <div>
            <div className="small muted">At age {f.retireAge} you’d have</div>
            <div className="big-number">{usd(plan.atRetireAge, true)}</div>
            <div className="tiny muted">≈ {usd(plan.incomeAtRetireAge / 12, true)}/month for life (today’s dollars)</div>
          </div>
          <div>
            <div className="small muted">Investing each month</div>
            <div className="big-number">{usd(monthlyInvest, true)}</div>
            <div className="tiny muted">
              {payroll > 0 ? `${usd(payroll, true)} from paychecks` : 'No 401(k) on your pay stub yet'}
              {match > 0 ? ` + ${usd(match, true)} match` : ''}
              {f.extraMonthly > 0 ? ` + ${usd(f.extraMonthly, true)} IRA/other` : ''}
            </div>
          </div>
        </div>
        <Projection points={plan.projection} target={plan.fi} />
      </div>

      <div className="grid two mt">
        <div className="card">
          <div className="row gap-s" style={{ marginBottom: 8 }}>
            <Flame size={18} style={{ color: 'var(--spend)' }} />
            <div className="eyebrow">Flavors of FIRE</div>
          </div>
          <div className="list">
            <Row label="Lean FI" value={usd(plan.leanFi, true)} note="Covers needs only (bills + essentials)" />
            <Row label="FI" value={usd(plan.fi, true)} note="Your life as it is today" />
            <Row label="Fat FI" value={usd(plan.fatFi, true)} note="1.5× today’s spending, room to splurge" />
            <Row
              label="Coast FI"
              value={usd(plan.coastFi, true)}
              note={plan.coastReached ? `Reached! Even with no more investing you’d hit FI by ${f.retireAge}.` : `Invested by now, growth alone gets you to FI by ${f.retireAge}.`}
            />
          </div>
        </div>
        <div className="card">
          <div className="row gap-s" style={{ marginBottom: 8 }}>
            <TrendingUp size={18} style={{ color: 'var(--jade)' }} />
            <div className="eyebrow">Savings rate is the lever</div>
          </div>
          <p className="small ink2">
            You’re putting away about <strong>{Math.round(savingsRate)}%</strong> of your pay (investing + Pebbles savings). Starting from zero, years until financial independence:
          </p>
          <table className="table mt">
            <thead>
              <tr>
                <th>Savings rate</th>
                <th className="r">Years to FI</th>
              </tr>
            </thead>
            <tbody>
              {[10, 15, 20, 30, 40, 50, 65].map((r) => (
                <tr key={r} style={Math.abs(r - savingsRate) < 5 ? { background: 'var(--moss-soft)' } : undefined}>
                  <td>{r}%</td>
                  <td className="r num">{yearsToFiFromSavingsRate(r)?.toFixed(0) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted mt">5% real return, 4% withdrawals. Every extra 5% saved cuts years off, which is why Pebbles keeps nudging it up.</p>
        </div>
      </div>

      <div className="grid two mt">
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Where your next dollar goes
          </div>
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {ACCOUNT_ORDER.map((s) => (
              <li key={s.step} style={{ marginBottom: 6 }}>
                <strong>{s.step}.</strong> <span className="ink2">{s.detail}</span>
              </li>
            ))}
          </ol>
          <p className="tiny muted mt">The order most of r/personalfinance and r/financialindependence agree on.</p>
        </div>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Investing, kept simple
          </div>
          {SIMPLE_PORTFOLIO.map((p) => (
            <div key={p.name} style={{ marginBottom: 8 }}>
              <div className="strong small">{p.name}</div>
              <div className="small ink2">{p.detail}</div>
            </div>
          ))}
          <p className="tiny muted">General education, not personalized investment advice.</p>
        </div>
      </div>

      <RedditCard />

      <div className="card mt">
        <div className="row gap-s" style={{ marginBottom: 12 }}>
          <Mountain size={18} />
          <h2>Your numbers</h2>
        </div>
        <div className="form-grid two">
          <Field label="Your age">
            <NumberInput value={f.age} onChange={(v) => up({ age: Math.round(v ?? 28) })} />
          </Field>
          <Field label="Age you’d like the option to stop working">
            <NumberInput value={f.retireAge} onChange={(v) => up({ retireAge: Math.round(v ?? 60) })} />
          </Field>
          <Field label="Invested today" hint="401(k), IRA and brokerage combined (not your Marcus savings)">
            <NumberInput value={f.invested} onChange={(v) => up({ invested: v ?? 0 })} prefix="$" />
          </Field>
          <Field label="Employer 401(k) match" hint="% of your pay they add">
            <NumberInput value={f.matchPct} onChange={(v) => up({ matchPct: v ?? 0 })} suffix="%" />
          </Field>
          <Field label="Other investing per month" hint="Roth IRA, brokerage">
            <NumberInput value={f.extraMonthly} onChange={(v) => up({ extraMonthly: v ?? 0 })} prefix="$" />
          </Field>
          <Field label="Yearly spending in retirement" hint={`Leave empty to use today’s ${usd(lifestyle, true)}`}>
            <NumberInput value={f.annualSpending} allowEmpty onChange={(v) => up({ annualSpending: v })} prefix="$" />
          </Field>
          <Field label="Expected return" hint="Long-run stock market average is around 7–10% before inflation">
            <NumberInput value={f.returnPct} onChange={(v) => up({ returnPct: v ?? 7 })} suffix="%" />
          </Field>
          <Field label="Inflation">
            <NumberInput value={f.inflationPct} onChange={(v) => up({ inflationPct: v ?? 3 })} suffix="%" />
          </Field>
          <Field label="Withdrawal rate" hint="4% is the classic rule; 3.5% for very early retirement">
            <NumberInput value={f.withdrawalPct} onChange={(v) => up({ withdrawalPct: v ?? 4 })} suffix="%" />
          </Field>
        </div>
        <p className="tiny muted mt">Your 401(k) contributions come straight from your paycheck deductions (upload a pay stub to fill them in).</p>
      </div>
    </div>
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
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 14 }} role="img" aria-label="Invested balance by age, with your FI number">
      <line x1={0} x2={W} y1={H - 18} y2={H - 18} stroke="var(--line)" strokeWidth="1" />
      <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--ink-3)" strokeWidth="1" />
      <text x={W - 4} y={y(target) - 5} fontSize="11" fill="var(--ink-2)" textAnchor="end">
        FI number
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

function RedditCard() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (force = false) => {
    const cached = await store.getMeta<{ items: FeedItem[]; at: number }>('fireFeed');
    if (cached && !force && Date.now() - cached.at < 12 * 3600_000) {
      setItems(cached.items);
      return;
    }
    setBusy(true);
    try {
      const res = await http(FEED, { headers: { 'User-Agent': 'Pebbles personal budgeting app', Accept: 'application/atom+xml' } });
      if (res.status !== 200) throw new Error(`Reddit replied ${res.status}`);
      const list = parseRedditFeed(res.text).slice(0, 10);
      setItems(list);
      setErr('');
      await store.setMeta('fireFeed', { items: list, at: Date.now() });
    } catch (e) {
      setErr((e as Error).message);
      if (cached) setItems(cached.items);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="card mt">
      <div className="card-head">
        <div>
          <div className="eyebrow">This week on r/financialindependence</div>
          <div className="small muted">Top posts from the community. Tap to read.</div>
        </div>
        <button className="btn small" disabled={busy} onClick={() => void load(true)}>
          <RefreshCw /> {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {items && items.length > 0 ? (
        <div className="list">
          {items.map((it) => (
            <button key={it.url} className="list-item" onClick={() => openLink(it.url)}>
              <div className="grow small">{it.title}</div>
              <ExternalLink size={15} className="muted" />
            </button>
          ))}
        </div>
      ) : (
        <p className="small muted">{err ? `Couldn’t load posts right now (${err}).` : busy ? 'Loading…' : 'No posts yet.'}</p>
      )}
    </div>
  );
}
