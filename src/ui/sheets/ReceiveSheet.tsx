import { useMemo, useState } from 'react';
import { Field, NumberInput, Sheet, GemIcon, useToast } from '../components';
import { SplitBar } from '../charts';
import { buildPlan } from '../../core/budget';
import { addDays, fmtDay } from '../../core/dates';
import { pebbles, usd } from '../../core/money';
import { receivePaycheck } from '../../data/actions';
import type { AppData } from '../../data/useData';
import type { PaycheckEstimate } from '../../core/paycheck';

/** Payday! Confirm what landed and drop the savings into your goals. */
export function ReceiveSheet({ data, estimate, onClose }: { data: AppData; estimate: PaycheckEstimate; onClose: () => void }) {
  const toast = useToast();
  const rec = data.paychecks.get(estimate.period.start);
  const [actual, setActual] = useState<number | null>(rec?.actualNet ?? estimate.net);
  const [savingsOverride, setSavingsOverride] = useState<number | null>(rec?.savingsOverride ?? null);
  const nextPayday = addDays(estimate.period.payday, 14);

  const plan = useMemo(
    () =>
      buildPlan({
        settings: data.settings,
        net: actual ?? estimate.net,
        payday: estimate.period.payday,
        nextPayday,
        bills: data.bills,
        essentials: data.essentials,
        // ignore this paycheck's earlier contributions so re-recording is stable
        goals: data.goals,
        contributions: data.contributions.filter((c) => c.paycheckId !== estimate.period.start),
        savingsOverride,
      }),
    [actual, estimate, data, nextPayday, savingsOverride],
  );

  const goalName = (id: string) => data.goals.find((g) => g.id === id);
  const diff = (actual ?? 0) - estimate.net;

  return (
    <Sheet
      title={`Payday · ${fmtDay(estimate.period.payday)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Not yet
          </button>
          <button
            className="btn primary"
            disabled={actual == null || actual <= 0}
            onClick={async () => {
              await receivePaycheck({
                period: estimate.period,
                estimatedNet: estimate.net,
                estimatedNetRaw: estimate.withholding.net,
                estimatedGross: estimate.gross.gross,
                actualNet: actual ?? estimate.net,
                split: { bills: plan.bills, essentials: plan.essentials, savings: plan.savings, personal: plan.personal },
                allocations: plan.allocations,
              });
              toast(plan.savings > 0 ? `+${pebbles(plan.savings)} pebbles added to your savings` : 'Paycheck recorded');
              onClose();
            }}
          >
            Split my paycheck
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <Field label="What landed in your account" hint={`Pebbles estimated ${usd(estimate.net)}`}>
          <NumberInput value={actual} onChange={setActual} prefix="$" autoFocus ariaLabel="Actual take-home" />
        </Field>
        {actual != null && Math.abs(diff) >= 1 && (
          <p className="small ink2">
            {diff > 0 ? 'A little more' : 'A little less'} than estimated ({usd(Math.abs(diff))}). Pebbles learns from your last few paychecks and adjusts future estimates automatically.
          </p>
        )}
        <SplitBar
          total={plan.net}
          parts={[
            { key: 'bills', label: 'Bills', value: plan.bills, color: 'var(--sapphire)' },
            { key: 'you', label: 'Your money', value: plan.essentials + Math.max(0, plan.personal), color: 'var(--amethyst)' },
            { key: 'save', label: 'Savings', value: plan.savings, color: 'var(--jade)' },
          ]}
        />
        <Field label="Savings from this check">
          <input
            className="range"
            type="range"
            min={0}
            max={Math.max(0, Math.floor(plan.available))}
            step={5}
            value={plan.savings}
            onChange={(e) => setSavingsOverride(Number(e.target.value))}
            aria-label="Savings amount"
          />
        </Field>
        {plan.allocations.length > 0 ? (
          <div className="card tint" style={{ padding: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Pebbles going to
            </div>
            {plan.allocations.map((a) => {
              const g = goalName(a.goalId);
              return (
                <div key={a.goalId} className="row" style={{ padding: '5px 0' }}>
                  {g && <GemIcon gem={g.gem} size={18} />}
                  <div className="grow">
                    <div className="strong">{g?.name}</div>
                    <div className="tiny muted">{a.reason}</div>
                  </div>
                  <div className="amount">+{pebbles(a.amount)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          plan.savings > 0 && <p className="small muted">Add a savings goal to send these pebbles somewhere specific.</p>
        )}
        {plan.notes.map((n) => (
          <p key={n} className="small ink2">
            {n}
          </p>
        ))}
      </div>
    </Sheet>
  );
}
