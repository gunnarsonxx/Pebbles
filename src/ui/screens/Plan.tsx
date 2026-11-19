import { useState } from 'react';
import { Plus, Sparkles, Settings as SettingsIcon } from 'lucide-react';
import type { AppData } from '../../data/useData';
import type { GoTo } from '../App';
import { SplitBar } from '../charts';
import { CategoryIcon, Field, GemIcon, NumberInput, Sheet, TextInput, ToggleRow, useToast } from '../components';
import { InsightList } from '../InsightList';
import { GuidelinesCard } from '../AutopilotCards';
import { monthlyBillsTotal, monthlyEquivalent } from '../../core/budget';
import { detectRecurring } from '../../core/analytics';
import { CATEGORIES, categoryOf } from '../../core/categories';
import { fmtDay, fmtShort, addDays } from '../../core/dates';
import { FOOD_PLAN_LABEL } from '../../core/food';
import { usd, pebbles } from '../../core/money';
import { deleteBill, newBill, saveBill, setSavingsOverride } from '../../data/actions';
import type { Bill, BillFrequency } from '../../core/types';

export function PlanScreen({ data, go }: { data: AppData; go: GoTo }) {
  const toast = useToast();
  const { plan, essentials, upcoming } = data;
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const recurring = detectRecurring(data.txns, data.bills, data.today).slice(0, 6);
  const due = new Set(plan.billsDue.map((b) => b.bill.id));
  const bills = [...data.bills].sort((a, b) => Number(b.active) - Number(a.active) || a.dueDay - b.dueDay);
  const monthly = monthlyBillsTotal(data.bills);
  const override = data.paychecks.get(upcoming.period.start)?.savingsOverride ?? null;

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Paycheck plan · {fmtDay(upcoming.period.payday)}</div>
            <div className="small muted">{usd(plan.net)} expected take-home</div>
          </div>
        </div>
        <SplitBar
          total={plan.net}
          parts={[
            { key: 'bills', label: 'Bills', value: plan.bills, color: 'var(--sapphire)', hint: data.settings.budget.billsMode === 'due_dates' ? `Due by ${fmtShort(addDays(data.afterUpcoming.payday, -1))}` : 'Even share of monthly bills' },
            {
              key: 'you',
              label: 'Your money',
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
              <span className="strong">Savings this check</span>
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
              Savings goes to
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
        <div className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Monthly bills</div>
              <div className="small muted">
                {usd(monthly)} a month · about {usd((monthly * 12) / 26)} per paycheck
              </div>
            </div>
            <button className="btn small" onClick={() => setEditingBill(newBill())}>
              <Plus /> Add
            </button>
          </div>
          {bills.length ? (
            <div className="list">
              {bills.map((b) => (
                <button key={b.id} className="list-item" onClick={() => setEditingBill(b)} style={!b.active ? { opacity: 0.5 } : undefined}>
                  <CategoryIcon id={b.category} size={34} />
                  <div className="grow">
                    <div className="strong ellipsis">{b.name}</div>
                    <div className="tiny muted">
                      {freqLabel(b)}
                      {b.autopay ? ' · autopay' : ''}
                      {due.has(b.id) ? ' · this paycheck' : ''}
                    </div>
                  </div>
                  <div className="amount">{usd(b.amount)}</div>
                </button>
              ))}
            </div>
          ) : (
            <p className="small muted">Add rent, utilities, phone, insurance, car payment and subscriptions. Pebbles sets aside money for each before payday.</p>
          )}
          {recurring.length > 0 && (
            <div className="mt">
              <div className="eyebrow" style={{ marginBottom: 4 }}>
                Found in your statements
              </div>
              {recurring.map((r) => (
                <div key={r.key} className="row" style={{ padding: '6px 0' }}>
                  <CategoryIcon id={r.category} size={30} />
                  <div className="grow">
                    <div className="small strong">{r.name}</div>
                    <div className="tiny muted">
                      {usd(r.amount)} {r.frequency} · seen {r.count}×
                    </div>
                  </div>
                  <button
                    className="btn small"
                    onClick={async () => {
                      await saveBill(
                        newBill({
                          name: r.name,
                          amount: r.amount,
                          dueDay: r.dueDay,
                          frequency: r.frequency === 'yearly' ? 'yearly' : r.frequency,
                          dueMonth: r.frequency === 'yearly' ? Number(r.lastDate.slice(5, 7)) : null,
                          anchorDate: r.frequency === 'weekly' || r.frequency === 'biweekly' ? r.lastDate : null,
                          category: categoryOf(r.category).group === 'bills' ? r.category : 'subscriptions',
                          matchPattern: r.pattern,
                        }),
                      );
                      toast(`${r.name} added to bills`);
                    }}
                  >
                    <Plus /> Bill
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Groceries, gas & basics</div>
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
                <div className="strong">Other basics</div>
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

      {editingBill && <BillSheet bill={editingBill} onClose={() => setEditingBill(null)} />}
    </div>
  );
}

function freqLabel(b: Bill): string {
  const th = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
  switch (b.frequency) {
    case 'monthly':
      return `Monthly on the ${th(b.dueDay)}`;
    case 'yearly':
      return `Yearly · ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(b.dueMonth ?? 1) - 1]} ${b.dueDay} (${usd(monthlyEquivalent(b))}/mo)`;
    case 'quarterly':
      return `Every 3 months on the ${th(b.dueDay)}`;
    case 'weekly':
      return 'Weekly';
    case 'biweekly':
      return 'Every 2 weeks';
  }
}

function BillSheet({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [b, setB] = useState(bill);
  const isNew = !bill.name;
  const billCats = CATEGORIES.filter((c) => c.group === 'bills' || ['transport', 'health', 'pets', 'household'].includes(c.id));
  return (
    <Sheet
      title={isNew ? 'New bill' : 'Edit bill'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button
              className="btn danger"
              onClick={async () => {
                await deleteBill(b.id);
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <button
            className="btn primary"
            disabled={!b.name.trim() || !(b.amount > 0)}
            onClick={async () => {
              await saveBill({ ...b, name: b.name.trim() });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <Field label="Name">
          <TextInput value={b.name} onChange={(v) => setB({ ...b, name: v })} placeholder="Rent, Colorado Springs Utilities, phone…" autoFocus={isNew} />
        </Field>
        <div className="form-grid two">
          <Field label="Amount">
            <NumberInput value={b.amount} onChange={(v) => setB({ ...b, amount: v ?? 0 })} prefix="$" />
          </Field>
          <Field label="How often">
            <select className="input" value={b.frequency} onChange={(e) => setB({ ...b, frequency: e.target.value as BillFrequency })}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="quarterly">Every 3 months</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          {(b.frequency === 'monthly' || b.frequency === 'quarterly' || b.frequency === 'yearly') && (
            <Field label="Due day of the month">
              <NumberInput value={b.dueDay} onChange={(v) => setB({ ...b, dueDay: Math.min(31, Math.max(1, Math.round(v ?? 1))) })} />
            </Field>
          )}
          {(b.frequency === 'yearly' || b.frequency === 'quarterly') && (
            <Field label={b.frequency === 'yearly' ? 'Month' : 'First month'}>
              <select className="input" value={b.dueMonth ?? 1} onChange={(e) => setB({ ...b, dueMonth: Number(e.target.value) })}>
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(b.frequency === 'weekly' || b.frequency === 'biweekly') && (
            <Field label="A recent due date">
              <input className="input" type="date" value={b.anchorDate ?? ''} onChange={(e) => setB({ ...b, anchorDate: e.target.value || null })} />
            </Field>
          )}
        </div>
        <Field label="Category">
          <div className="row wrap" style={{ gap: 6 }}>
            {billCats.map((c) => (
              <button key={c.id} className={`chip${b.category === c.id ? ' on' : ''}`} onClick={() => setB({ ...b, category: c.id })}>
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Shows up on statements as (optional)" hint="Helps Pebbles recognize the payment">
          <TextInput value={b.matchPattern} onChange={(v) => setB({ ...b, matchPattern: v })} placeholder="e.g. CSU, T-MOBILE" />
        </Field>
        <ToggleRow title="Autopay" hint="No reminder needed" on={b.autopay} onChange={(v) => setB({ ...b, autopay: v })} />
        <ToggleRow title="Active" on={b.active} onChange={(v) => setB({ ...b, active: v })} />
        <p className="small muted center">
          {usd(monthlyEquivalent(b))} a month · about {usd((monthlyEquivalent(b) * 12) / 26)} per paycheck
        </p>
      </div>
    </Sheet>
  );
}
