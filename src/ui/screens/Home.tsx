import { useState } from 'react';
import { ArrowRight, CalendarDays, Fuel, Receipt, ShoppingBasket, Sprout } from 'lucide-react';
import type { AppData } from '../../data/useData';
import type { GoTo } from '../App';
import { SplitBar } from '../charts';
import { PebblePile } from '../PebblePile';
import { CategoryIcon, GemIcon, Progress } from '../components';
import { InsightList } from '../InsightList';
import { UpdateBanner } from '../UpdateCard';
import { CoverageCard, MovesCard } from '../AutopilotCards';
import { ReceiveSheet } from '../sheets/ReceiveSheet';
import { fmtDay, fmtDayOrd, fmtShort, relativeDays, addDays, diffDays } from '../../core/dates';
import { billsDueBetween } from '../../core/budget';
import { pebbles, usd } from '../../core/money';
import { currentGasPrice } from '../../core/food';
import { gemBar } from '../../core/categories';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Ridge() {
  return (
    <svg className="ridge" viewBox="0 0 400 70" preserveAspectRatio="none" aria-hidden>
      <path d="M0,70 L0,48 L40,38 L70,44 L110,22 L140,30 L170,12 L205,34 L240,26 L270,40 L310,28 L350,42 L400,30 L400,70 Z" fill="var(--moss)" opacity="0.10" />
      <path d="M0,70 L0,56 L50,50 L90,58 L130,44 L180,52 L220,46 L260,56 L300,48 L350,58 L400,50 L400,70 Z" fill="var(--moss)" opacity="0.10" />
    </svg>
  );
}

export function HomeScreen({ data, go }: { data: AppData; go: GoTo }) {
  const [receiving, setReceiving] = useState(false);
  const { upcoming, settings } = data;
  // the same paycheck the payday steps are about, so every number matches
  const plan = data.movesFor?.plan ?? data.plan;
  const planPayday = data.movesFor?.period.payday ?? upcoming.period.payday;
  const p = upcoming.period;
  const record = data.paychecks.get(p.start);
  const actual = record?.received && record.actualNet != null ? record.actualNet : null;
  const changes = upcoming.gross.adjustments.length;
  const isPayday = diffDays(p.payday, data.today) <= 0;
  const bills = billsDueBetween(data.bills, data.today, addDays(data.today, 15));
  const activeGoals = data.goals.filter((g) => !g.archived);
  const gas = currentGasPrice(data.market);
  const completedGems = activeGoals.filter((g) => g.completedAt).map((g) => g.gem);

  return (
    <div>
      <div style={{ margin: '4px 2px 14px' }}>
        <h1>
          {greeting()}
          {settings.name ? `, ${settings.name}` : ''}
        </h1>
        <p className="muted">{fmtDay(data.today)}</p>
      </div>
      <UpdateBanner />

      <div className="grid two-wide">
        <div className="card" style={{ overflow: 'hidden', paddingBottom: 26 }}>
          <Ridge />
          <div className="eyebrow">
            {isPayday ? 'Payday is today' : `Next payday · ${fmtDay(p.payday)} · ${relativeDays(p.payday, data.today)}`}
          </div>
          <div className="hero-number" style={{ margin: '8px 0 4px' }}>
            {usd(actual ?? upcoming.net)}
          </div>
          {actual != null ? (
            <>
              <div className="ink2 small">
                Take-home from your pay stub{record?.actualGross ? ` · ${usd(record.actualGross)} gross` : ''}
              </div>
              {Math.abs(actual - upcoming.net) >= 0.01 && (
                <div className={`diff-chip ${actual >= upcoming.net ? 'up' : 'down'}`}>
                  {actual >= upcoming.net ? '▲' : '▼'} {usd(Math.abs(actual - upcoming.net))} {actual >= upcoming.net ? 'more' : 'less'} than the {usd(upcoming.net)} Pebbles expected
                </div>
              )}
            </>
          ) : (
            <div className="ink2 small">
              Expected take-home · {usd(upcoming.gross.gross)} gross · {upcoming.gross.workedHours + upcoming.gross.leaveHours} h
              {upcoming.gross.otHours > 0 && ` · ${upcoming.gross.otHours} h overtime`}
            </div>
          )}
          <div className="small muted" style={{ marginTop: 2 }}>
            For work {fmtShort(p.start)} – {fmtShort(p.end)}
            {changes > 0 ? ` · ${changes} change${changes > 1 ? 's' : ''} from your normal 2 weeks` : ' · your normal schedule'}
          </div>
          <div className="row wrap mt-l" style={{ position: 'relative' }}>
            <button className="btn" onClick={() => go('paycheck')}>
              <CalendarDays /> Adjust Days
            </button>
            {(isPayday || diffDays(p.payday, data.today) <= 1) && !record?.received && (
              <button className="btn primary" onClick={() => setReceiving(true)}>
                <Sprout /> I Got Paid
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Savings</div>
              <div className="big-number num" style={{ marginTop: 4 }}>
                {pebbles(data.saved)} <span className="small muted" style={{ fontWeight: 500 }}>pebbles saved</span>
              </div>
            </div>
            <button className="icon-btn" onClick={() => go('savings')} aria-label="Open savings">
              <ArrowRight />
            </button>
          </div>
          {data.saved > 0 ? (
            <PebblePile amount={data.saved} seed="all-savings" height={130} gems={completedGems} />
          ) : (
            <p className="small muted" style={{ margin: '6px 0 4px' }}>
              Your first pebbles land on payday.
            </p>
          )}
          {activeGoals.slice(0, 2).map((g) => {
            const bal = data.balances.get(g.id) ?? 0;
            return (
              <div key={g.id} className="mt">
                <div className="row between small">
                  <span className="row gap-s">
                    <GemIcon gem={g.gem} size={14} /> {g.name}
                  </span>
                  <span className="muted num">
                    {pebbles(bal)} / {pebbles(g.target)}
                  </span>
                </div>
                <div style={{ marginTop: 5 }}>
                  <Progress value={bal / g.target} color={gemBar(g.gem)} />
                </div>
              </div>
            );
          })}
          {!activeGoals.length && (
            <button className="btn small mt" onClick={() => go('savings')}>
              Start a Savings Goal
            </button>
          )}
        </div>
      </div>

      <CoverageCard data={data} compact />
      <MovesCard data={data} />

      <div className="card mt">
        <div className="card-head">
          <div>
            <div className="eyebrow">Paycheck Plan · {fmtDayOrd(planPayday)}</div>
            <div className="small muted">How {usd(plan.net, true)} splits up</div>
          </div>
          <button className="btn ghost small" onClick={() => go('plan')}>
            Details <ArrowRight />
          </button>
        </div>
        <SplitBar
          total={plan.net}
          parts={[
            { key: 'bills', label: 'Bills', value: plan.bills, color: 'var(--sapphire)', hint: plan.billsTopUp ? (plan.bills > 0 ? `Into ${data.coverage.bills?.account.name ?? 'your Bills Account'}` : 'Bills Account already covered') : plan.billsDue.length ? `${plan.billsDue.length} due before next payday` : undefined },
            { key: 'you', label: 'Your Money', value: plan.essentials + Math.max(0, plan.personal), color: 'var(--amethyst)', hint: `${usd(plan.essentials, true)} groceries & gas · ${usd(plan.personalPerDay, true)} a day to enjoy` },
            { key: 'save', label: 'Savings', value: plan.savings, color: 'var(--jade)', hint: `${Math.round(plan.savingsRate * 100)}% of take-home` },
          ]}
        />
        {plan.shortfall > 0 && <p className="small bad mt">Short by {usd(plan.shortfall)} this check. See Plan for ideas.</p>}
      </div>

      <div className="grid two mt">
        <div className="card">
          <div className="card-head">
            <div className="eyebrow">Bills in the Next 2 Weeks</div>
            <button className="btn ghost small" onClick={() => go('budget', 'bills')}>
              All Bills
            </button>
          </div>
          {bills.length ? (
            <div className="list">
              {bills.slice(0, 5).map((b) => (
                <div key={b.bill.id + b.date} className="list-item">
                  <CategoryIcon id={b.bill.category} size={34} />
                  <div className="grow">
                    <div className="strong ellipsis">{b.bill.name}</div>
                    <div className="tiny muted">
                      {fmtDay(b.date)} · {relativeDays(b.date, data.today)}
                      {b.bill.autopay ? ' · autopay' : ''}
                    </div>
                  </div>
                  <div className="amount">{usd(b.amount)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">{data.bills.length ? 'Nothing due in the next two weeks.' : 'Add your monthly bills in Plan so Pebbles can set money aside for them.'}</p>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="eyebrow">Field Notes</div>
            <button className="btn ghost small" onClick={() => go('plan')}>
              More
            </button>
          </div>
          <InsightList items={data.insights} limit={2} />
        </div>
      </div>

      <div className="row wrap mt" style={{ gap: 8 }}>
        {gas && (
          <span className="chip">
            <Fuel /> Gas {usd(gas.price)} · {gas.source}
          </span>
        )}
        {data.market?.foodCpi && (
          <span className="chip">
            <ShoppingBasket /> Groceries {data.market.foodCpi.yoyPct >= 0 ? '+' : ''}
            {data.market.foodCpi.yoyPct}% vs last year
          </span>
        )}
        {data.txns.length > 0 && (
          <button className="chip" onClick={() => go('spending')}>
            <Receipt />
            {data.txns.length} transactions tracked
          </button>
        )}
      </div>

      {receiving && <ReceiveSheet data={data} estimate={upcoming} onClose={() => setReceiving(false)} />}
    </div>
  );
}
