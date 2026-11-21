import { useState, type ReactNode } from 'react';
import {
  Check,
  Pencil,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Landmark,
  ShoppingBasket,
  Smile,
  Circle,
  Compass,
  PiggyBank,
  TriangleAlert,
  CircleCheck,
  CircleDot,
  SlidersHorizontal,
} from 'lucide-react';
import { SplitBar } from './charts';
import { Field, GemIcon, NumberInput, Sheet, useToast } from './components';
import { store } from '../data/store';
import { saveSettings } from '../data/actions';
import { setGoalSplit } from '../core/savingsAccount';
import { round2 } from '../core/money';
import type { Account, Goal } from '../core/types';
import type { AppData } from '../data/useData';
import { setBonusMove, setMove } from '../data/autopilot';
import { fmtDay, fmtDayOrd, fmtShort } from '../core/dates';
import { pebbles, usd } from '../core/money';
import { minimumAdvance } from '../core/dailypay';
import { MARCUS_REFERRAL } from '../core/edition';
import { desktop, platformKind } from '../platform';
import { Browser } from '@capacitor/browser';
import type { Standing } from '../core/guidelines';

/** Home: what to do with this paycheck. The only part of money you have to think about. */
export function MovesCard({ data, m = data.movesFor, foldable }: { data: AppData; m?: AppData['movesFor']; foldable?: boolean }) {
  const [open, setOpen] = useState(!foldable);
  if (!m) return null;
  const { period, plan, moves, isPast } = m;
  const daysTo = Math.round((Date.parse(period.payday) - Date.parse(data.today)) / 86_400_000);
  const allDone = moves.filter((x) => x.checkable).every((x) => x.done);
  const header = isPast || daysTo <= 0 ? `Payday Moves · ${fmtDay(period.payday)}` : `On Payday (${fmtDay(period.payday)}), Do This`;
  return (
    <div className="card mt">
      <button
        className="card-head"
        style={{ width: '100%', background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', cursor: foldable ? 'pointer' : 'default', marginBottom: open ? undefined : 0 }}
        onClick={() => foldable && setOpen(!open)}
        aria-expanded={open}
      >
        <div>
          <div className="eyebrow">{header}</div>
          {(open || allDone) && (
            <div className="small muted">{allDone && (isPast || daysTo <= 0) ? 'All done. Nothing else to think about until next payday.' : 'Pebbles did the math. You just move the money.'}</div>
          )}
        </div>
        {foldable ? <ChevronDown style={{ color: 'var(--ink-3)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} /> : <Compass style={{ color: 'var(--moss)' }} />}
      </button>
      {open && (
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
                    } else void setMove(period, plan, mv.key, !mv.done, false, mv.key === 'sweep' && data.goalsAccount?.source === 'plaid');
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
      )}
    </div>
  );
}

/** Savings: the real account your goals live in (e.g. Marcus) and its interest. */
export function SavingsAccountCard({ data }: { data: AppData }) {
  const acct = data.goalsAccount;
  const balance = acct?.balance ?? data.saved;
  const apy = acct?.apy ?? null;
  // the next 12 months (26 paychecks) of the same forecast the goals use: your usual deposits, interest, and
  // each goal's money coming out on its date
  const pts = data.forecast.series.slice(0, 27);
  const end = pts[pts.length - 1];
  const yearEnd = pts[pts.length - 1]?.date ?? data.today;
  const outs = data.forecast.withdrawals.filter((w) => w.date <= yearEnd);
  const avg = data.savingsAvg;
  const proj = apy != null && end ? end : null;
  const rec = data.reconcile;
  const [splitting, setSplitting] = useState(false);
  const [showMath, setShowMath] = useState(false);
  if (!acct) {
    return (
      <div className="card tint mt">
        <div className="row">
          <PiggyBank style={{ color: 'var(--jade)' }} />
          <div className="grow small ink2">
            Keep your goals in a high-yield savings account like Marcus? Connect it (Budget → Accounts) or import its statement. Pebbles keeps your goals equal to its balance, splits every deposit
            between goals, and adds the interest to your pile.
          </div>
        </div>
        {MARCUS_REFERRAL && <MarcusSignUp />}
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
          <div className="big-number">{usd(balance)}</div>
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
            <div className="big-number">{usd(proj.balance)}</div>
            <div className="tiny muted">
              incl. about {usd(proj.interest)} interest{proj.spent > 0 ? `, after ${usd(proj.spent)} spent on goals` : ''}
            </div>
          </div>
        )}
      </div>
      {proj && <Projection points={pts.map((p) => p.balance)} />}
      {proj && apy != null && (
        <>
          <button className="link-btn small mt-s" onClick={() => setShowMath(!showMath)}>
            {showMath ? 'Hide the Math' : 'How the 12-Month Number Is Figured'}
          </button>
          {showMath && (
            <div className="coverage-math mt-s">
              <div className="row between small">
                <span>{acct.name} now</span>
                <span className="num strong">{usd(balance)}</span>
              </div>
              <div className="row between small">
                <span>
                  + Deposits: this paycheck’s {usd(data.plan.savings)}, then about {usd(avg.perCheck)} a paycheck for {pts.length - 2} more
                </span>
                <span className="num">+{usd(proj.deposits)}</span>
              </div>
              <div className="row between small">
                <span>+ Interest: {apy}% APY on the balance as it grows and shrinks</span>
                <span className="num">+{usd(proj.interest)}</span>
              </div>
              {outs.map((w) => (
                <div key={w.goalId} className="row between small">
                  <span>
                    − {data.goals.find((g) => g.id === w.goalId)?.name ?? 'A goal'} on {fmtDay(w.date)}
                  </span>
                  <span className="num">−{usd(w.amount)}</span>
                </div>
              ))}
              <div className="divider" style={{ margin: '6px 0' }} />
              <div className="row between small">
                <span className="strong">In 12 months</span>
                <span className="num strong">{usd(proj.balance)}</span>
              </div>
              <div className="row wrap tiny muted mt-s" style={{ gap: 12 }}>
                {[7, 13, 20].map((k) => (
                  <span key={k}>
                    {Math.round(((k - 1) * 14) / 30.4)} months: {usd(pts[k]?.balance ?? 0)}
                  </span>
                ))}
              </div>
              <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                {avg.basis === 'deposits'
                  ? `About ${usd(avg.perCheck)} a paycheck is what you’ve actually deposited on average over your last ${avg.count} paychecks.`
                  : avg.basis === 'paychecks'
                    ? `About ${usd(avg.perCheck)} a paycheck is what your average take-home (${usd(avg.avgNet ?? 0)}, from your last ${avg.count} paycheck${avg.count === 1 ? '' : 's'}) saves after bills and basics. Once you have a few deposits, Pebbles uses your real average instead.`
                    : `About ${usd(avg.perCheck)} a paycheck is what your expected take-home saves after bills and basics. Once you have a few deposits, Pebbles uses your real average instead.`}{' '}
                This paycheck uses its own plan ({usd(data.plan.savings)}). Goals for things are spent on their dates; when a must-be-ready goal needs more than usual, those checks save more. The rate
                is assumed to stay at {apy}%.
              </p>
            </div>
          )}
        </>
      )}
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
  if (!b) return null;
  const chosen = !!data.settings.budget.billsAccountId;
  const isToday = c.nextPayday === data.today;
  const next = isToday ? 'Today' : fmtDay(c.nextPayday);
  // "Fri, Nov 20th’s check" — the day reads as a date, the rest follows the sentence
  const nextCheck = isToday ? 'today’s' : `${fmtDayOrd(c.nextPayday)}’s`;
  const NextCheck = isToday ? 'Today’s' : nextCheck;
  const through = fmtDay(c.followingPayday);
  // "Same amount every check" can put in a bit more than the bare top-up, to smooth out rent; show what the plan says
  const st = chosen ? (b.steady ?? null) : null;
  const planned = chosen && data.plan.billsTopUp && data.upcoming.period.payday === c.nextPayday ? data.plan.bills : b.topUp;
  const ahead = round2(planned - b.topUp);
  const before = b.bills.filter((x) => x.beforePayday && !x.paid);
  const after = b.bills.filter((x) => !x.beforePayday && !x.paid);
  const tone = b.status === 'short' ? 'bad' : b.status === 'topup' ? 'warn' : 'good';
  const name = (a: Account) => `${a.institution && !a.name.includes(a.institution) ? `${a.institution} ` : ''}${a.name}`;
  const cover = Math.ceil(b.shortNow / 5) * 5;
  // DailyPay, only as a last resort and only the minimum: what's short after what the Spending account can give
  const dp = data.settings.pay.dailyPay?.enabled ? data.settings.pay.dailyPay : null;
  const dpBills = dp ? minimumAdvance(b.shortNow - Math.max(0, sp ? sp.balance : 0)) : 0;
  // PayPal purchases the bank hasn't taken out yet are already subtracted; say so under that account
  const fl = data.inFlight;
  const flNote = (a: Account) => {
    if (!fl || fl.accountId !== a.id) return null;
    const raw = data.accounts.find((x) => x.id === a.id);
    const bank = raw ? (raw.available ?? raw.balance) : null;
    const what = fl.txns.length === 1 ? `${fl.txns[0].merchant || 'a PayPal purchase'} (${usd(fl.amount)})` : `${fl.txns.length} PayPal purchases (${usd(fl.amount)})`;
    return (
      <div className="tiny muted" style={{ marginTop: -2 }}>
        {bank != null ? `Bank shows ${usd(bank)}; ` : ''}
        {what} went through PayPal and hasn’t reached {a.name} yet, so it’s already taken off.{' '}
        <button
          className="link-btn tiny"
          onClick={() =>
            void store.putMany(
              'transactions',
              fl.txns.map((t) => ({ ...t, bankHas: true })),
            )
          }
          title="Your bank already shows it: stop taking it off"
        >
          Already Taken Out
        </button>
      </div>
    );
  };
  return (
    <div className={`card coverage cov-${tone} mt`}>
      <div className="eyebrow">{st ? 'Bills · Same Every Check' : `Bills Through ${through}`}</div>
      <div className={`strong ${b.status === 'short' ? 'bad' : ''}`} style={{ fontSize: 17, marginTop: 2 }}>
        {b.status === 'short'
          ? `Short ${usd(b.shortNow)} for Bills Before ${next}`
          : st
            ? `${usd(st.perCheck, true)} to ${b.account.name} Every Check`
            : b.status === 'topup'
              ? `Move ${usd(planned, true)} to ${b.account.name} From ${NextCheck} Check`
              : `${b.account.name} Covers Every Bill Through ${through}`}
      </div>
      <div className="coverage-math mt-s">
        <div className="row between small">
          <span>{name(b.account)} now</span>
          <span className="num strong">{usd(b.balance)}</span>
        </div>
        {flNote(b.account)}
        {!(isToday && !before.length) && (
          <div className="row between small">
            <span>
              {isToday ? `Bills still due before today` : `Bills before ${next}`} ({before.length})
            </span>
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
      {b.status === 'short' && dp && dpBills > 0 && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          <strong>Last resort, if it’s due before a transfer would land:</strong> take just <strong>{usd(dpBills)}</strong> from DailyPay, the least that covers it (about {usd(dp.fee)} fee; it comes
          out of your next check).
        </p>
      )}
      {b.status === 'short' && (
        <p className="small ink2" style={{ margin: '8px 0 0' }}>
          {sp && sp.balance >= cover
            ? `Move ${usd(cover, true)} from ${sp.account.name} to ${b.account.name} now so nothing bounces. `
            : (data.goalsAccount?.balance ?? 0) >= cover
              ? `Move ${usd(cover, true)} from ${data.goalsAccount?.name ?? 'savings'} to ${b.account.name} now. Pebbles will rebuild your goals from the next checks. `
              : `Move what you can into ${b.account.name}, and if a bill allows it, pay it the day after payday. `}
        </p>
      )}
      {st && b.shortNow === 0 && (
        <div className="small ink2" style={{ margin: '8px 0 0' }}>
          <p style={{ margin: 0 }}>
            Pebbles played out the next 12 months ({st.checks} paychecks): with {usd(st.perCheck, true)} going in every payday, every bill is paid in full on its due date. The lowest the account gets
            is <strong>{usd(st.lowest)}</strong>
            {st.lowestDate ? ` on ${fmtShort(st.lowestDate)}` : ''}, so there’s always at least a $50 cushion.
          </p>
        </div>
      )}
      {st && <SteadyMath st={st} />}
      {!st && b.status === 'topup' && b.shortNow === 0 && (
        <p className="small ink2" style={{ margin: '8px 0 0' }}>
          {before.length ? `Everything due before ${next} is covered. ` : ''}
          {!chosen ? (
            'Confirm your accounts below and the payday plan will use this amount.'
          ) : (
            <>
              The payday plan puts {usd(planned, true)} of {isToday ? 'today’s' : 'that'} check into {b.account.name}
              {ahead > 0 ? ` (${usd(ahead, true)} of it toward later bills, since you set bills to the same amount every check)` : ''}, and the rest is planned for savings and you.
            </>
          )}
        </p>
      )}
      {!st && b.status === 'ok' && (
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
            {flNote(sp.account)}
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
          {sp.status === 'short' && dp && minimumAdvance(-sp.left) >= 5 && (data.goalsAccount?.balance ?? 0) < -sp.left && (
            <p className="small" style={{ margin: '8px 0 0' }}>
              If you can’t wait for payday for groceries or gas: take only <strong>{usd(minimumAdvance(-sp.left))}</strong> from DailyPay (about {usd(dp.fee)} fee; it comes out of your next check).
            </p>
          )}
          {sp.status !== 'ok' && (
            <p className="small ink2" style={{ margin: '8px 0 0' }}>
              {sp.status === 'short'
                ? `Groceries and gas need a bit more than ${sp.account.name} has. Keep extras on hold until ${next}.`
                : `Covered, with only a little to spare. Go easy on extras until ${next}.`}
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

      {!chosen && <AccountPicks data={data} />}
      <p className="tiny muted" style={{ margin: '8px 0 0' }}>
        {b.asOf ? `Balances as of ${fmtShort(b.asOf)}. ` : ''}Uses the available balance, so pending charges are already out.
      </p>
    </div>
  );
}

/** Community build: open a Marcus account through Pebbles' link. */
function MarcusSignUp() {
  const [why, setWhy] = useState(false);
  const open = () => {
    if (desktop) void desktop.openExternal(MARCUS_REFERRAL);
    else if (platformKind === 'android') void Browser.open({ url: MARCUS_REFERRAL });
    else window.open(MARCUS_REFERRAL, '_blank');
  };
  return (
    <div className="mt-s">
      <button className="btn primary small" onClick={open}>
        <PiggyBank /> Open a Marcus Account
      </button>
      <button className="tour-skip" style={{ display: 'block', marginTop: 8 }} onClick={() => setWhy(!why)} aria-expanded={why}>
        Why sign up through Pebbles?
      </button>
      {why && (
        <p className="tiny ink2" style={{ margin: '6px 0 0' }}>
          It’s a referral link: you get an extra 1% APY on top of Marcus’s regular rate for your first 3 months, and so does the person who shared Pebbles. Nothing else changes, it’s the same free
          account, and you can always sign up on marcus.com instead.
        </p>
      )}
    </div>
  );
}

/** An earlier paycheck's plan: what it was split into, where savings went, and the moves (you can still check them off). */
export function PastPlanCard({ data, back, setBack }: { data: AppData; back: number; setBack: (n: number) => void }) {
  const p = data.planFor(data.upcoming.period.index - back);
  const { plan, period } = p;
  const a = p.actual;
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <button className="icon-btn" onClick={() => setBack(back + 1)} aria-label="Earlier paycheck">
            <ChevronLeft />
          </button>
          <div className="center">
            <div className="eyebrow">{back === 1 ? 'Last Paycheck' : `${back} Paychecks Ago`}</div>
            <div className="strong">Paid {fmtDay(period.payday)}</div>
          </div>
          <button className="icon-btn" onClick={() => setBack(back - 1)} aria-label="Later paycheck">
            <ChevronRight />
          </button>
        </div>
        <div className="hero-number" style={{ margin: '4px 0' }}>
          {usd(plan.net)}
        </div>
        <div className="small ink2">
          {p.received ? 'Take-home that came in' : 'Expected take-home (no deposit recorded)'}
          {data.paychecks.get(period.start)?.depositPending ? ' · pending' : ''}
        </div>
        <div className="mt">
          <SplitBar
            total={plan.net}
            parts={[
              { key: 'bills', label: 'Bills', value: plan.bills, color: 'var(--sapphire)', hint: plan.billsTopUp ? 'Into your Bills account' : 'Bills' },
              {
                key: 'you',
                label: 'Your Money',
                value: plan.essentials + Math.max(0, plan.personal),
                color: 'var(--amethyst)',
                hint: `${usd(plan.essentials, true)} groceries, gas & basics · ${usd(Math.max(0, plan.personal), true)} to enjoy`,
              },
              { key: 'save', label: 'Savings', value: plan.savings, color: 'var(--jade)', hint: `${pebbles(plan.savings)} pebbles` },
            ]}
          />
        </div>
        {plan.allocations.length > 0 && (
          <div className="mt">
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Savings Went To
            </div>
            {plan.allocations.map((a) => {
              const g = data.goals.find((x) => x.id === a.goalId);
              return (
                <div key={a.goalId} className="row" style={{ padding: '4px 0' }}>
                  {g && <GemIcon gem={g.gem} size={16} />}
                  <span className="grow small">{g?.name ?? 'A goal'}</span>
                  <span className="amount small">+{pebbles(a.amount)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt">
          <div className="row between">
            <div className="eyebrow">What Actually Happened</div>
            <button className="btn ghost small" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </button>
          </div>
          {a ? (
            <>
              <div className="coverage-math mt-s">
                <div className="row between tiny muted">
                  <span />
                  <span style={{ display: 'flex', gap: 18 }}>
                    <span style={{ width: 70, textAlign: 'right' }}>Planned</span>
                    <span style={{ width: 70, textAlign: 'right' }}>Actual</span>
                  </span>
                </div>
                {[
                  { k: 'Take-home', p: plan.net, v: a.net },
                  { k: 'To bills', p: plan.bills, v: a.bills },
                  { k: 'To savings', p: plan.savings, v: a.savings },
                  { k: 'Left for you', p: round2(plan.net - plan.bills - plan.savings), v: round2(a.net - a.bills - a.savings) },
                ].map((r) => (
                  <div key={r.k} className="row between small">
                    <span>{r.k}</span>
                    <span style={{ display: 'flex', gap: 18 }}>
                      <span className="num muted" style={{ width: 70, textAlign: 'right' }}>
                        {usd(r.p, true)}
                      </span>
                      <span className={`num strong ${Math.abs(r.v - r.p) >= 1 ? (r.k === 'Left for you' ? (r.v < r.p ? 'good' : 'warn') : '') : ''}`} style={{ width: 70, textAlign: 'right' }}>
                        {usd(r.v, true)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                {a.source === 'bank'
                  ? 'Filled in from your bank: what landed in your Bills account and savings between this payday and the next. Edit it if something was different.'
                  : 'As you entered it.'}
              </p>
            </>
          ) : (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Nothing from your bank yet for this check. Tap Edit to enter what you moved.
            </p>
          )}
        </div>
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>
          {p.saved ? 'The plan as Pebbles had it when this check came in.' : 'Rebuilt from your bills and goals today; Pebbles didn’t save a plan for this check.'}{' '}
          <button className="tour-skip" onClick={() => setBack(0)}>
            Back to the next paycheck
          </button>
        </p>
      </div>
      <MovesCard data={data} m={p} />
      {editing && <ActualSheet data={data} period={period} planNet={plan.net} start={a ?? { net: plan.net, bills: plan.bills, savings: plan.savings }} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Enter what really happened with a past check: take-home, what went to bills, what went to savings. */
function ActualSheet({
  data,
  period,
  planNet,
  start,
  onClose,
}: {
  data: AppData;
  period: { start: string; payday: string };
  planNet: number;
  start: { net: number; bills: number; savings: number };
  onClose: () => void;
}) {
  const toast = useToast();
  const [net, setNet] = useState<number | null>(start.net);
  const [bills, setBills] = useState<number | null>(start.bills);
  const [savings, setSavings] = useState<number | null>(start.savings);
  const rec = data.paychecks.get(period.start);
  const save = async (clear = false) => {
    const base = rec ?? {
      id: period.start,
      periodStart: period.start,
      payday: period.payday,
      estimatedNet: planNet,
      estimatedGross: 0,
      actualNet: null,
      actualGross: null,
      received: true,
      savingsOverride: null,
      split: null,
      goalAllocations: [],
      note: 'Entered by you',
    };
    await store.put(
      'paychecks',
      clear ? { ...base, actual: null } : { ...base, actualNet: net ?? base.actualNet, received: true, actual: { net: net ?? planNet, bills: bills ?? 0, savings: savings ?? 0, by: 'you' } },
    );
    toast(clear ? 'Back to what your bank shows' : 'Saved what happened');
    onClose();
  };
  return (
    <Sheet
      title={`What Happened · ${fmtDay(period.payday)}`}
      onClose={onClose}
      footer={
        <>
          {rec?.actual && (
            <button className="btn" onClick={() => void save(true)}>
              Use the Bank’s Numbers
            </button>
          )}
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          What really came in and where it went. Pebbles uses this for your history and averages; your goals keep following your savings account’s balance.
        </p>
        <div className="form-grid two">
          <Field label="Take-Home That Came In">
            <NumberInput value={net} onChange={setNet} prefix="$" money allowEmpty />
          </Field>
          <Field label="Moved to Bills">
            <NumberInput value={bills} onChange={setBills} prefix="$" money allowEmpty />
          </Field>
          <Field label="Moved to Savings">
            <NumberInput value={savings} onChange={setSavings} prefix="$" money allowEmpty />
          </Field>
          <Field label="Left for You">
            <div className="big-number num">{usd((net ?? 0) - (bills ?? 0) - (savings ?? 0))}</div>
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

/** Which account is for bills, which for spending, and where PayPal pulls from (Settings → Budget, and first-time setup). */
export function AccountPicks({ data, inSettings }: { data: AppData; inSettings?: boolean }) {
  const c = data.coverage;
  const b = c.bills;
  const sp = c.spending;
  const pickable = data.accounts.filter((a) => (a.type === 'checking' || a.type === 'savings') && !a.holdsGoals && (a.available ?? a.balance) != null);
  if (!pickable.length) return inSettings ? <p className="small muted">Connect your bank (Budget → Accounts) to pick your bills and spending accounts.</p> : null;
  const chosen = !!data.settings.budget.billsAccountId;
  const name = (a: Account) => `${a.institution && !a.name.includes(a.institution) ? `${a.institution} ` : ''}${a.name}`;
  const hasPaypal = data.accounts.some((a) => /paypal/i.test(`${a.name} ${a.institution ?? ''}`));
  const pick = (key: 'billsAccountId' | 'spendingAccountId', id: string) =>
    void saveSettings((s) => ({
      ...s,
      budget: { ...s.budget, billsAccountId: s.budget.billsAccountId ?? b?.account.id ?? null, spendingAccountId: s.budget.spendingAccountId ?? sp?.account.id ?? null, [key]: id || null },
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
    <div className={inSettings ? 'col' : 'coverage-accounts mt'} style={inSettings ? { gap: 10 } : undefined}>
      {!chosen && (
        <p className="small ink2" style={{ margin: '0 0 6px' }}>
          Which account is only for bills? Once you pick it, the payday plan counts what’s already in it and only tops it up.
        </p>
      )}
      {select('billsAccountId', b?.account.id ?? '', 'Bills Account', false)}
      {select('spendingAccountId', sp?.account.id ?? '', 'Spending Account', true)}
      {hasPaypal && (
        <label className="row between small" style={{ gap: 8 }}>
          <span className="ink2">PayPal Pays From</span>
          <select
            className="input coverage-pick"
            value={data.settings.budget.paypalFromAccountId ?? data.paypalFrom?.id ?? 'paypal-balance'}
            aria-label="PayPal Pays From"
            onChange={(e) => void saveSettings((s) => ({ ...s, budget: { ...s.budget, paypalFromAccountId: e.target.value } }))}
          >
            {pickable.map((a) => (
              <option key={a.id} value={a.id}>
                {name(a)}
                {a.mask ? ` ••${a.mask}` : ''}
              </option>
            ))}
            <option value="paypal-balance">PayPal Balance</option>
          </select>
        </label>
      )}
      {!chosen && b && (
        <button className="btn small mt-s" onClick={() => pick('billsAccountId', b.account.id)}>
          Use These Accounts
        </button>
      )}
    </div>
  );
}

/**
 * Home: three numbers at a glance. Bills (what's left in the Bills account once its bills are paid), groceries,
 * gas & basics until payday, and guilt-free money. Tap to see how each is figured.
 */
export function MoneyGlance({ data }: { data: AppData }) {
  const [open, setOpen] = useState(false);
  const c = data.coverage;
  const b = c.bills;
  const sp = c.spending;
  const plan = data.plan;
  // bills: after what's due before payday; if that's covered, after next check's move and the bills until the one after
  let billsLeft: number | null = null;
  if (b) {
    const before = round2(b.balance - b.dueBeforePayday);
    const planned = data.settings.budget.billsAccountId && plan.billsTopUp && data.upcoming.period.payday === c.nextPayday ? plan.bills : b.topUp;
    billsLeft = before < 0 ? before : round2(before + planned - b.dueNextCycle);
  }
  // groceries/gas/basics and guilt-free: from the Spending account when there is one, else this check's plan
  const basics = sp ? sp.living : plan.essentials;
  const free = sp ? sp.left : plan.personal;
  const tone = (v: number) => (v < 0 ? 'bad' : 'good');
  const tiles = [
    b && billsLeft != null ? { key: 'bills', icon: <Landmark />, value: billsLeft, color: 'var(--sapphire)', label: 'Bills account after its bills', tone: tone(billsLeft) } : null,
    { key: 'basics', icon: <ShoppingBasket />, value: basics, color: 'var(--citrine)', label: sp ? 'Groceries, gas & basics until payday' : 'Groceries, gas & basics this check', tone: '' },
    { key: 'free', icon: <Smile />, value: free, color: 'var(--amethyst)', label: sp ? 'Guilt-free until payday' : 'Guilt-free this check', tone: tone(free) },
  ].filter(Boolean) as { key: string; icon: ReactNode; value: number; color: string; label: string; tone: string }[];
  return (
    <>
      <button className="card mt glance" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Hide the details' : 'Show the details'}>
        <div className="glance-row">
          {tiles.map((t) => (
            <div key={t.key} className="glance-tile" title={t.label}>
              <span className="glance-icon" style={{ background: `color-mix(in srgb, ${t.color} 16%, var(--card))`, color: t.color }}>
                {t.icon}
              </span>
              <span className={`glance-num num ${t.tone}`}>
                {t.value < 0 ? '−' : ''}
                {usd(Math.abs(t.value), true)}
              </span>
              {open && <span className="tiny muted center">{t.label}</span>}
            </div>
          ))}
          <ChevronDown className="glance-chev" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </div>
      </button>
      {open && <CoverageCard data={data} />}
    </>
  );
}

/** Exactly how the "same every check" amount is worked out. */
function SteadyMath({ st }: { st: NonNullable<NonNullable<AppData['coverage']['bills']>['steady']> }) {
  const [open, setOpen] = useState(false);
  const t = st.tight;
  const extra = round2(st.perCheck - st.average);
  return (
    <div className="mt-s">
      <button className="link-btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide the Math' : `How ${usd(st.perCheck, true)} Is Figured`}
      </button>
      {open && (
        <div className="coverage-math mt-s">
          <div className="row between small">
            <span>Your bills over the next year, per check ({st.checks} paychecks)</span>
            <span className="num">{usd(st.average)}</span>
          </div>
          {t && t.need > st.average ? (
            <>
              <div className="small strong mt-s">The tightest stretch: {fmtDay(t.date)}</div>
              <div className="row between small">
                <span>Bills paid from now through {fmtShort(t.date)}</span>
                <span className="num">{usd(t.bills)}</span>
              </div>
              <div className="row between small">
                <span>+ Cushion kept in the account</span>
                <span className="num">+{usd(t.cushion)}</span>
              </div>
              <div className="row between small">
                <span>− In the account to start{st.shortNow > 0 ? ` (with the ${usd(st.shortNow)} to move in now)` : ''}</span>
                <span className="num">−{usd(t.start)}</span>
              </div>
              <div className="row between small">
                <span>÷ Deposits by then</span>
                <span className="num">÷ {t.deposits}</span>
              </div>
              <div className="divider" style={{ margin: '6px 0' }} />
              <div className="row between small">
                <span className="strong">Needed per check</span>
                <span className="num strong">{usd(t.need)}</span>
              </div>
              <div className="row between small">
                <span>Rounded up to $5</span>
                <span className="num strong">{usd(st.perCheck, true)}</span>
              </div>
              <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                That stretch needs more than the year’s average because the bills before it come faster than the deposits do, starting from {usd(t.start)}. The {usd(extra)} a check over the average
                isn’t spent: it builds up in the account as a buffer. Pebbles works this out again every payday from what’s really in the account, so as the buffer grows the amount comes down toward
                the average.
              </p>
            </>
          ) : (
            <>
              <div className="row between small">
                <span>Rounded up to $5</span>
                <span className="num strong">{usd(st.perCheck, true)}</span>
              </div>
              <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                No stretch of the year needs more than the average, so it’s just the average rounded up. Every bill is paid on time with at least a $50 cushion.
              </p>
            </>
          )}
          <div className="row between tiny muted mt-s">
            <span>Lowest the account gets over the year</span>
            <span className="num">
              {usd(st.lowest)}
              {st.lowestDate ? ` · ${fmtShort(st.lowestDate)}` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
