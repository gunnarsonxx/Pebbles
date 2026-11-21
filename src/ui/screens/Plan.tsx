import { CalendarDays, ChevronLeft, ChevronRight, Sparkles, Settings as SettingsIcon } from 'lucide-react';
import type { AppData } from '../../data/useData';
import type { GoTo } from '../App';
import { SplitBar } from '../charts';
import { CategoryIcon, GemIcon } from '../components';
import { InsightList } from '../InsightList';
import { CoverageCard, GuidelinesCard, PastPlanCard } from '../AutopilotCards';
import { useState } from 'react';
import { monthlyBillsTotal } from '../../core/budget';
import { detectRecurring } from '../../core/analytics';
import { fmtDay, fmtShort, addDays } from '../../core/dates';
import { FOOD_PLAN_LABEL } from '../../core/food';
import { usd, pebbles } from '../../core/money';
import { setSavingsOverride } from '../../data/actions';

export function PlanScreen({ data, go }: { data: AppData; go: GoTo }) {
  const [back, setBack] = useState(0); // looking at an earlier paycheck's plan
  const { plan, essentials, upcoming } = data;
  const recurring = detectRecurring(data.txns, data.bills, data.today).slice(0, 6);
  const monthly = monthlyBillsTotal(data.bills);
  const override = data.paychecks.get(upcoming.period.start)?.savingsOverride ?? null;

  if (back > 0)
    return (
      <div>
        <PastPlanCard data={data} back={back} setBack={setBack} />
      </div>
    );

  return (
    <div>
      <CoverageCard data={data} />
      <div className="mt" />
      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Paycheck Plan · {fmtDay(upcoming.period.payday)}</div>
            <div className="small muted">
              {usd(plan.net)} {data.paychecks.get(upcoming.period.start)?.actualNet != null ? 'take-home from your stub' : 'expected take-home'}
            </div>
          </div>
          <button className="btn ghost small" onClick={() => setBack(1)} aria-label="Earlier paychecks">
            <ChevronLeft /> Earlier
          </button>
        </div>
        <SplitBar
          total={plan.net}
          parts={[
            {
              key: 'bills',
              label: 'Bills',
              value: plan.bills,
              color: 'var(--sapphire)',
              hint: plan.billsTopUp
                ? `Into ${data.coverage.bills?.account.name ?? 'your Bills Account'} · covers bills through ${fmtShort(data.coverage.followingPayday)}`
                : data.settings.budget.billsMode === 'due_dates'
                  ? `Due by ${fmtShort(addDays(data.afterUpcoming.payday, -1))}`
                  : 'Even share of monthly bills',
            },
            {
              key: 'you',
              label: 'Your Money',
              value: plan.essentials + Math.max(0, plan.personal),
              color: 'var(--amethyst)',
              hint: `${usd(plan.essentials, true)} groceries, gas & basics · ${usd(Math.max(0, plan.personal), true)} to enjoy (${usd(plan.personalPerDay)}/day)`,
            },
            { key: 'save', label: 'Savings', value: plan.savings, color: 'var(--jade)', hint: `${pebbles(plan.savings)} pebbles · ${Math.round(plan.savingsRate * 100)}%` },
          ]}
        />
        {plan.available > 0 && (
          <div className="mt-l">
            <div className="row between small">
              <span className="strong">Savings This Check</span>
              <span className="num">
                {usd(plan.savings, true)}
                {override != null && (
                  <button className="btn ghost small" onClick={() => void setSavingsOverride(upcoming.period, upcoming.net, upcoming.gross.gross, null)}>
                    Use suggestion ({usd(plan.savingsSuggested, true)})
                  </button>
                )}
              </span>
            </div>
            <input
              className="range"
              type="range"
              min={0}
              max={Math.max(0, Math.floor(plan.available))}
              step={5}
              value={plan.savings}
              aria-label="Savings this paycheck"
              onChange={(e) => void setSavingsOverride(upcoming.period, upcoming.net, upcoming.gross.gross, Number(e.target.value))}
            />
            <div className="row between tiny muted">
              <span>More for you</span>
              <span>More pebbles</span>
            </div>
          </div>
        )}
        {plan.notes.map((n) => (
          <p key={n} className="small ink2 mt">
            {n}
          </p>
        ))}
        {plan.allocations.length > 0 && (
          <div className="mt">
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Savings Goes To
            </div>
            {plan.allocations.map((a) => {
              const g = data.goals.find((x) => x.id === a.goalId);
              return (
                <div key={a.goalId} className="row" style={{ padding: '5px 0' }}>
                  {g && <GemIcon gem={g.gem} size={16} />}
                  <span className="grow">
                    {g?.name} <span className="tiny muted">· {a.reason}</span>
                  </span>
                  <span className="amount small">+{pebbles(a.amount)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid two mt">
        <button className="card action-card" onClick={() => go('budget', 'bills')}>
          <span className="list-icon" style={{ background: 'color-mix(in srgb, var(--sapphire) 14%, var(--card))', color: 'var(--sapphire)' }}>
            <CalendarDays />
          </span>
          <div className="grow">
            <div className="eyebrow">Bills</div>
            <div className="strong">
              {usd(monthly)} a month · {usd((monthly * 12) / 26)} per paycheck
            </div>
            <div className="tiny muted">
              {plan.billsDue.length
                ? `This check covers ${plan.billsDue
                    .slice(0, 3)
                    .map((x) => x.bill.name)
                    .join(', ')}${plan.billsDue.length > 3 ? '…' : ''}`
                : 'Calendar, suggestions and roommate split'}
              {recurring.length ? ` · ${recurring.length} found in your statements` : ''}
            </div>
          </div>
          <ChevronRight size={18} className="muted" />
        </button>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Groceries, Gas & Basics</div>
              <div className="small muted">
                Part of your money · {usd(essentials.totalMonthly)} a month, {usd(essentials.perPaycheck)} per paycheck
              </div>
            </div>
            <button className="icon-btn" onClick={() => go('settings', 'budget')} aria-label="Household settings">
              <SettingsIcon />
            </button>
          </div>
          <div className="list">
            <div className="list-item">
              <CategoryIcon id="groceries" size={34} />
              <div className="grow">
                <div className="strong">Groceries</div>
                <div className="tiny muted">{essentials.groceriesReason}</div>
                <div className="tiny muted">
                  USDA {FOOD_PLAN_LABEL[data.settings.household.foodPlan]} plan: {usd(essentials.groceriesPlan, true)}
                  {essentials.groceriesActualAvg > 0 && ` · you average ${usd(essentials.groceriesActualAvg, true)}`}
                </div>
              </div>
              <div className="amount">{usd(essentials.groceriesMonthly, true)}</div>
            </div>
            <div className="list-item">
              <CategoryIcon id="gas" size={34} />
              <div className="grow">
                <div className="strong">Gas</div>
                <div className="tiny muted">{essentials.gasReason}</div>
                {essentials.gasActualAvg > 0 && <div className="tiny muted">you average {usd(essentials.gasActualAvg, true)}</div>}
              </div>
              <div className="amount">{usd(essentials.gasMonthly, true)}</div>
            </div>
            <div className="list-item">
              <CategoryIcon id="household" size={34} />
              <div className="grow">
                <div className="strong">Other Basics</div>
                <div className="tiny muted">Toiletries, cleaning, pet food… (Settings → Budget)</div>
              </div>
              <div className="amount">{usd(essentials.otherMonthly, true)}</div>
            </div>
          </div>
        </div>
      </div>

      <GuidelinesCard data={data} />

      <div className="section-title">
        <h2>
          <Sparkles size={18} style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--amethyst)' }} />
          Field notes
        </h2>
        <span className="small muted">Ways to save, habits to keep or quit</span>
      </div>
      <div className="card">
        <InsightList items={data.insights} />
      </div>
    </div>
  );
}
