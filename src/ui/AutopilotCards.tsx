import { useState } from 'react';
import { Check, Circle, Compass, PiggyBank, TriangleAlert, CircleCheck, CircleDot, SlidersHorizontal } from 'lucide-react';
import { GemIcon, NumberInput, Sheet, useToast } from './components';
import { store } from '../data/store';
import { saveSettings } from '../data/actions';
import { setGoalSplit } from '../core/savingsAccount';
import { round2 } from '../core/money';
import type { Account, Goal } from '../core/types';
import type { AppData } from '../data/useData';
import { setBonusMove, setMove } from '../data/autopilot';
import { fmtDay, fmtDayOrd, fmtShort } from '../core/dates';
import { usd } from '../core/money';
import { projectSavings } from '../core/savingsAccount';
import type { Standing } from '../core/guidelines';

/** Home: what to do with this paycheck. The only part of money you have to think about. */
export function MovesCard({ data }: { data: AppData }) {
  const m = data.movesFor;
  if (!m) return null;
  const { period, plan, moves, isPast } = m;
  const daysTo = Math.round((Date.parse(period.payday) - Date.parse(data.today)) / 86_400_000);
  const allDone = moves.filter((x) => x.checkable).every((x) => x.done);
  const header = isPast || daysTo <= 0 ? `Payday Moves · ${fmtDay(period.payday)}` : `On Payday (${fmtDay(period.payday)}), Do This`;
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
  const [splitting, setSplitting] = useState(false);
  if (!acct) {
    return (
      <div className="card tint mt">
        <div className="row">
          <PiggyBank style={{ color: 'var(--jade)' }} />
          <div className="grow small ink2">
            Keep your goals in a high-yield savings account like Marcus? Connect it (Budget → Accounts) or import its statement. Pebbles keeps your goals equal to its balance, splits every deposit between goals, and adds the interest to your pile.
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
          <div className="small muted">{apy ? `${apy}% APY · interest compounds daily, paid monthly` : 'Add the APY under Budget → Accounts to project interest'}</div>
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
      {acct.balance != null && (
        <div className="row between mt" style={{ gap: 10 }}>
          <p className="small ink2" style={{ margin: 0 }}>
            {rec && Math.abs(rec.difference) < 1
              ? `Your goals add up to your ${acct.name} balance. Each deposit is split the way that paycheck’s plan split it.`
              : `Matching your goals to ${acct.name}…`}
          </p>
          <button className="btn small" onClick={() => setSplitting(true)}>
            <SlidersHorizontal /> Adjust Split
          </button>
        </div>
      )}
      {splitting && <SplitSheet account={acct} data={data} onClose={() => setSplitting(false)} />}
    </div>
  );
}

function SplitSheet({ account, data, onClose }: { account: Account; data: AppData; onClose: () => void }) {
  const toast = useToast();
  const goals = data.goals.filter((g) => !g.archived);
  const [vals, setVals] = useState<Map<string, number>>(() => new Map(goals.map((g) => [g.id, round2(data.balances.get(g.id) ?? 0)])));
  const total = round2([...vals.values()].reduce((s, v) => s + v, 0));
  const target = account.balance ?? 0;
  const off = round2(target - total);
  const fill = (g: Goal) => setVals(new Map(vals).set(g.id, round2((vals.get(g.id) ?? 0) + off)));
  return (
    <Sheet
      title={`Split ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={Math.abs(off) >= 0.01}
            onClick={async () => {
              await store.putMany('contributions', setGoalSplit(account, vals, data.contributions, data.today));
              toast('Goals updated');
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          How much of your {usd(target)} belongs to each goal. New deposits keep splitting by your plan.
        </p>
        {goals.map((g) => (
          <div key={g.id} className="row" style={{ gap: 10 }}>
            <GemIcon gem={g.gem} size={22} />
            <div className="grow strong small">{g.name}</div>
            <div style={{ width: 150 }}>
              <NumberInput value={vals.get(g.id) ?? 0} onChange={(v) => setVals(new Map(vals).set(g.id, v ?? 0))} prefix="$" ariaLabel={`${g.name} amount`} />
            </div>
          </div>
        ))}
        <div className={`small ${Math.abs(off) < 0.01 ? 'good' : 'warn'}`}>
          {Math.abs(off) < 0.01 ? 'Adds up to your balance.' : off > 0 ? `${usd(off)} left to place.` : `${usd(-off)} more than your balance.`}
          {Math.abs(off) >= 0.01 && goals.length > 0 && (
            <>
              {' '}
              <button className="btn ghost small" onClick={() => fill(goals[0])}>
                Put it in {goals[0].name}
              </button>
            </>
          )}
        </div>
      </div>
    </Sheet>
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
  good: { icon: CircleCheck, color: 'var(--good)', label: 'On Track' },
  close: { icon: CircleDot, color: 'var(--warn)', label: 'Getting There' },
  off: { icon: TriangleAlert, color: 'var(--bad)', label: 'Needs Attention' },
};

/** Plan: how your split compares to what the experts broadly agree on. */
export function GuidelinesCard({ data }: { data: AppData }) {
  return (
    <div className="card mt">
      <div className="card-head">
        <div>
          <div className="eyebrow">How You Compare to the Experts</div>
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

/** Before payday: is what's in checking enough for the bills still due, plus groceries and gas? */
export function CoverageCard({ data, compact }: { data: AppData; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const c = data.coverage;
  const b = c.bills;
  const sp = c.spending;
  const pickable = data.accounts.filter((a) => (a.type === 'checking' || a.type === 'savings') && !a.holdsGoals && (a.available ?? a.balance) != null);
  if (!b) return null;
  const chosen = !!data.settings.budget.billsAccountId;
  const isToday = c.nextPayday === data.today;
  const next = isToday ? 'Today' : fmtDay(c.nextPayday);
  // "Fri, Nov 20th’s check" — the day reads as a date, the rest follows the sentence
  const nextCheck = isToday ? 'today’s' : `${fmtDayOrd(c.nextPayday)}’s`;
  const NextCheck = isToday ? 'Today’s' : nextCheck;
  const through = fmtDay(c.followingPayday);
  // "Same amount every check" can put in a bit more than the bare top-up, to smooth out rent; show what the plan says
  const planned = chosen && data.plan.billsTopUp && data.upcoming.period.payday === c.nextPayday ? data.plan.bills : b.topUp;
  const ahead = round2(planned - b.topUp);
  const before = b.bills.filter((x) => x.beforePayday && !x.paid);
  const after = b.bills.filter((x) => !x.beforePayday && !x.paid);
  const tone = b.status === 'short' ? 'bad' : b.status === 'topup' ? 'warn' : 'good';
  const name = (a: Account) => `${a.institution && !a.name.includes(a.institution) ? `${a.institution} ` : ''}${a.name}`;
  const cover = Math.ceil(b.shortNow / 5) * 5;
  const pick = (key: 'billsAccountId' | 'spendingAccountId', id: string) =>
    void saveSettings((s) => ({
      ...s,
      budget: { ...s.budget, billsAccountId: s.budget.billsAccountId ?? b.account.id, spendingAccountId: s.budget.spendingAccountId ?? sp?.account.id ?? null, [key]: id || null },
    }));
  const select = (key: 'billsAccountId' | 'spendingAccountId', value: string, label: string, allowNone: boolean) => (
    <label className="row between small" style={{ gap: 8 }}>
      <span className="ink2">{label}</span>
      <select className="input coverage-pick" value={value} aria-label={label} onChange={(e) => pick(key, e.target.value)}>
        {allowNone && <option value="">None</option>}
        {pickable.map((a) => (
          <option key={a.id} value={a.id}>
            {name(a)}
            {a.mask ? ` ••${a.mask}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className={`card coverage cov-${tone} mt`}>
      <div className="eyebrow">Bills Through {through}</div>
      <div className={`strong ${b.status === 'short' ? 'bad' : ''}`} style={{ fontSize: 17, marginTop: 2 }}>
        {b.status === 'short'
          ? `Short ${usd(b.shortNow)} for Bills Before ${next}`
          : b.status === 'topup'
            ? `Move ${usd(planned, true)} to ${b.account.name} From ${NextCheck} Check`
            : `${b.account.name} Covers Every Bill Through ${through}`}
      </div>
      <div className="coverage-math mt-s">
        <div className="row between small">
          <span>{name(b.account)} now</span>
          <span className="num strong">{usd(b.balance)}</span>
        </div>
        {!(isToday && !before.length) && (
          <div className="row between small">
            <span>{isToday ? `Bills still due before today` : `Bills before ${next}`} ({before.length})</span>
            <span className="num">{b.dueBeforePayday ? `−${usd(b.dueBeforePayday)}` : usd(0)}</span>
          </div>
        )}
        <div className="row between small">
          <span>
            Bills {isToday ? 'today' : next} → {through} ({after.length})
          </span>
          <span className="num">{b.dueNextCycle ? `−${usd(b.dueNextCycle)}` : usd(0)}</span>
        </div>
        <div className="divider" style={{ margin: '6px 0' }} />
        {b.status === 'ok' ? (
          <div className="row between small">
            <span className="strong">Extra in the account</span>
            <span className="num strong good">{usd(b.extra)}</span>
          </div>
        ) : (
          <>
            {b.shortNow > 0 && (
              <div className="row between small">
                <span className="strong">Needed before {next}</span>
                <span className="num strong bad">{usd(b.shortNow)}</span>
              </div>
            )}
            {b.topUp > 0 && (
              <div className="row between small">
                <span className="strong">From {nextCheck} check</span>
                <span className="num strong">{usd(planned, true)}</span>
              </div>
            )}
          </>
        )}
      </div>
      {b.status === 'short' && (
        <p className="small ink2" style={{ margin: '8px 0 0' }}>
          {sp && sp.balance >= cover
            ? `Move ${usd(cover, true)} from ${sp.account.name} to ${b.account.name} now so nothing bounces. `
            : (data.goalsAccount?.balance ?? 0) >= cover
              ? `Move ${usd(cover, true)} from ${data.goalsAccount?.name ?? 'savings'} to ${b.account.name} now. Pebbles will rebuild your goals from the next checks. `
              : `Move what you can into ${b.account.name}, and if a bill allows it, pay it the day after payday. `}
        </p>
      )}
      {b.status === 'topup' && b.shortNow === 0 && (
        <p className="small ink2" style={{ margin: '8px 0 0' }}>
          {before.length ? `Everything due before ${next} is covered. ` : ''}
          {!chosen ? 'Confirm your accounts below and the payday plan will use this amount.' : <>The payday plan puts {usd(planned, true)} of {isToday ? 'today’s' : 'that'} check into {b.account.name}
          {ahead > 0 ? ` (${usd(ahead, true)} of it toward later bills, since you set bills to the same amount every check)` : ''}, and the rest is planned for savings and you.</>}
        </p>
      )}
      {b.status === 'ok' && (
        <p className="small ink2" style={{ margin: '8px 0 0' }}>
          Nothing from {nextCheck} check has to go to bills, so the payday plan leaves it for savings and you.
        </p>
      )}

      {sp && (
        <>
          <div className="eyebrow mt">Spending Until {next}</div>
          <div className="coverage-math mt-s">
            <div className="row between small">
              <span>{name(sp.account)} now</span>
              <span className="num strong">{usd(sp.balance)}</span>
            </div>
            <div className="row between small">
              <span>
                Groceries, gas & basics · {sp.days} day{sp.days === 1 ? '' : 's'}
              </span>
              <span className="num">−{usd(sp.living)}</span>
            </div>
            <div className="divider" style={{ margin: '6px 0' }} />
            <div className="row between small">
              <span className="strong">{sp.left >= 0 ? 'Yours to spend' : 'Short by'}</span>
              <span className={`num strong ${sp.status === 'short' ? 'bad' : sp.status === 'tight' ? 'warn' : 'good'}`}>{usd(Math.abs(sp.left))}</span>
            </div>
          </div>
          {sp.status !== 'ok' && (
            <p className="small ink2" style={{ margin: '8px 0 0' }}>
              {sp.status === 'short' ? `Groceries and gas need a bit more than ${sp.account.name} has. Keep extras on hold until ${next}.` : `Covered, with only a little to spare. Go easy on extras until ${next}.`}
            </p>
          )}
        </>
      )}

      {b.bills.length > 0 && (
        <>
          <button className="link-btn small mt" onClick={() => setOpen(!open)}>
            {open ? 'Hide Bills' : `Show the ${b.bills.length} Bill${b.bills.length === 1 ? '' : 's'}`}
          </button>
          {open && (
            <div className="list mt-s">
              {b.bills.map((x) => (
                <div key={`${x.bill.id}${x.date}`} className="row between small" style={{ padding: '4px 0', opacity: x.paid ? 0.55 : 1 }}>
                  <span>
                    {x.paid ? '✓ ' : ''}
                    {x.bill.name} · {fmtDay(x.date)}
                    {x.bill.toRoommate ? ' · to roommate' : ''}
                  </span>
                  <span className="num">{x.paid ? 'paid' : usd(x.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="coverage-accounts mt">
        {!chosen && <p className="small ink2" style={{ margin: '0 0 6px' }}>Which account is only for bills? Once you pick it, the payday plan counts what’s already in it and only tops it up.</p>}
        {select('billsAccountId', b.account.id, 'Bills Account', false)}
        {select('spendingAccountId', sp?.account.id ?? '', 'Spending Account', true)}
        {!chosen && (
          <button className="btn small mt-s" onClick={() => pick('billsAccountId', b.account.id)}>
            Use These Accounts
          </button>
        )}
      </div>
      <p className="tiny muted" style={{ margin: '8px 0 0' }}>
        {b.asOf ? `Balances as of ${fmtShort(b.asOf)}. ` : ''}Uses the available balance, so pending charges are already out.
      </p>
    </div>
  );
}
