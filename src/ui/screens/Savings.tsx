import { useRef, useState } from 'react';
import { ImagePlus, Minus, Pencil, Plus, Trash2, Target, ShieldCheck } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { PebblePile } from '../PebblePile';
import { compressImage, Empty, Field, GemIcon, NumberInput, Progress, Segmented, Sheet, TextInput, ToggleRow, useConfirm, useToast } from '../components';
import { GEMS, GEM_BY_ID, gemBar } from '../../core/categories';
import { fmtLong, fmtShort, diffDays, today } from '../../core/dates';
import { pebbles, usd, uid } from '../../core/money';
import { projectGoalDate } from '../../core/budget';
import { addContribution, deleteContribution, deleteGoal, newGoal, saveGoal } from '../../data/actions';
import { SavingsAccountCard } from '../AutopilotCards';
import type { Goal, GemName } from '../../core/types';
import type { GoTo } from '../App';
import { autoTarget } from '../../core/emergency';
import { RetirementView } from './Retirement';

export const MILESTONES: { pct: number; gem: GemName; label: string }[] = [
  { pct: 0.25, gem: 'quartz', label: 'Quartz · a Quarter of the Way' },
  { pct: 0.5, gem: 'amethyst', label: 'Amethyst · Halfway' },
  { pct: 0.75, gem: 'topaz', label: 'Topaz · Three Quarters' },
  { pct: 1, gem: 'emerald', label: 'Emerald · Goal Reached' },
];

export function earnedGems(balance: number, target: number): GemName[] {
  return MILESTONES.filter((m) => target > 0 && balance >= target * m.pct).map((m) => m.gem);
}

export function SavingsScreen({ data, view, setView }: { data: AppData; go: GoTo; view?: string; setView: (v: 'goals' | 'retirement') => void }) {
  const v = view === 'retirement' ? 'retirement' : 'goals';
  return (
    <div>
      <div className="subnav">
        <Segmented
          value={v}
          options={[
            { value: 'goals', label: 'Goals' },
            { value: 'retirement', label: 'Retirement' },
          ]}
          onChange={setView}
        />
      </div>
      {v === 'goals' ? <GoalsView data={data} /> : <RetirementView data={data} />}
    </div>
  );
}

function GoalsView({ data }: { data: AppData }) {
  const [editing, setEditing] = useState<Goal | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const goals = data.goals.filter((g) => !g.archived);
  const perCheck = new Map(data.plan.allocations.map((a) => [a.goalId, a.amount]));
  const completed = goals.filter((g) => g.completedAt);
  const gems = completed.map((g) => g.gem);
  const viewingGoal = viewing ? data.goals.find((g) => g.id === viewing) : null;

  return (
    <div>
      <div className="card center" style={{ paddingTop: 22 }}>
        <div className="eyebrow">All Your Savings</div>
        <div className="hero-number" style={{ marginTop: 6 }}>
          {pebbles(data.saved)}
        </div>
        <div className="ink2">pebbles saved</div>
        <div style={{ maxWidth: 520, margin: '8px auto 0' }}>
          <PebblePile amount={data.saved} seed="all-savings" height={190} gems={gems} label={`${pebbles(data.saved)} pebbles saved`} />
        </div>
        <div className="small muted">
          1 pebble = $1 · {goals.length} goal{goals.length === 1 ? '' : 's'}
          {data.plan.savings > 0 && ` · about ${pebbles(data.plan.savings)} more planned next payday`}
        </div>
      </div>

      <SavingsAccountCard data={data} />

      <div className="section-title">
        <h2>Goals</h2>
        <button className="btn primary small" onClick={() => setEditing(newGoal({ gem: GEMS[(goals.length + 3) % GEMS.length].id }))}>
          <Plus /> New Goal
        </button>
      </div>

      {!goals.length && (
        <div className="card">
          <Empty icon={<Target className="big" />} title="What are you saving for?">
            A ring, a car, a down payment, a trip: add a photo so you can see it grow. Pebbles suggests starting with a Bedrock fund for emergencies.
          </Empty>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button
              className="btn"
              onClick={() => setEditing(newGoal({ name: 'Bedrock Fund', isEmergency: true, gem: 'obsidian', priority: 3, target: 3000 }))}
            >
              <ShieldCheck /> Start a Bedrock Fund
            </button>
            <button className="btn primary" onClick={() => setEditing(newGoal())}>
              <Plus /> Something Else
            </button>
          </div>
        </div>
      )}

      <div className="grid two">
        {goals.map((g) => {
          const bal = data.balances.get(g.id) ?? 0;
          const pct = g.target > 0 ? bal / g.target : 0;
          const next = perCheck.get(g.id) ?? 0;
          const eta = projectGoalDate(g, bal, next, data.upcoming.period.payday);
          const gem = GEM_BY_ID[g.gem];
          return (
            <button key={g.id} className="card" style={{ textAlign: 'left', border: 0, cursor: 'pointer', color: 'inherit', width: '100%' }} onClick={() => setViewing(g.id)}>
              <div className="goal-cover" style={!g.image ? { background: `linear-gradient(135deg, color-mix(in srgb, ${gem.color} 45%, var(--card)), color-mix(in srgb, ${gem.color} 15%, var(--bg-deep)))` } : undefined}>
                {g.image && <img src={g.image} alt="" />}
                <div className="over row between">
                  <div>
                    <div className="strong" style={{ fontSize: 18, fontFamily: 'var(--font-serif)' }}>
                      {g.name}
                    </div>
                    <div className="tiny" style={{ opacity: 0.9 }}>
                      {g.isEmergency ? emergencyLabel(data, g) : g.targetDate ? `by ${fmtLong(g.targetDate)}` : 'No deadline'}
                    </div>
                  </div>
                  <GemIcon gem={g.gem} size={26} />
                </div>
              </div>
              <div className="row between mt">
                <div>
                  <span className="strong num" style={{ fontSize: 18 }}>
                    {pebbles(bal)}
                  </span>{' '}
                  <span className="small muted">of {pebbles(g.target)} pebbles</span>
                </div>
                <span className="small strong">{Math.min(100, Math.round(pct * 100))}%</span>
              </div>
              <div style={{ margin: '8px 0' }}>
                <Progress value={pct} color={gemBar(g.gem)} />
              </div>
              <div className="row between tiny muted">
                <span>{g.completedAt ? 'Reached! 🎉' : next > 0 ? `+${pebbles(next)} next payday` : 'Not in this paycheck’s plan'}</span>
                <span>{!g.completedAt && eta ? `on track for ${fmtShort(eta)}${eta.slice(0, 4) !== today().slice(0, 4) ? ` ${eta.slice(0, 4)}` : ''}` : ''}</span>
              </div>
              <div className="row mt" style={{ gap: 4 }}>
                {MILESTONES.map((m) => (
                  <span key={m.gem} style={{ opacity: bal >= g.target * m.pct ? 1 : 0.2 }} title={m.label}>
                    <GemIcon gem={m.gem} size={16} title={m.label} />
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {editing && <GoalEditor goal={editing} onClose={() => setEditing(null)} />}
      {viewingGoal && (
        <GoalDetail
          goal={viewingGoal}
          data={data}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewingGoal);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

function GoalEditor({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const [g, setG] = useState(goal);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title={goal.name ? 'Edit Goal' : 'New Savings Goal'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!g.name.trim() || !(g.target > 0)}
            onClick={async () => {
              await saveGoal({ ...g, name: g.name.trim() });
              onClose();
            }}
          >
            Save Goal
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              setG({ ...g, image: await compressImage(f) });
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
        <button className="goal-cover" style={{ border: 0, cursor: 'pointer', width: '100%', padding: 0 }} onClick={() => fileRef.current?.click()}>
          {g.image && <img src={g.image} alt="" />}
          <div className="over row" style={{ justifyContent: 'center', alignSelf: 'center' }}>
            <ImagePlus /> <span className="strong">{busy ? 'Loading…' : g.image ? 'Change photo' : 'Add a photo of what you’re saving for'}</span>
          </div>
        </button>
        {g.image && (
          <button className="btn ghost small" onClick={() => setG({ ...g, image: null })}>
            Remove Photo
          </button>
        )}
        <Field label="What are you saving for?">
          <TextInput value={g.name} onChange={(v) => setG({ ...g, name: v })} placeholder="Engagement ring, new car, down payment…" autoFocus={!goal.name} />
        </Field>
        <div className="form-grid two">
          <Field label="Goal Amount" hint={autoTarget(g) ? 'Set by the steps below' : '1 pebble = $1'}>
            <NumberInput value={g.target} onChange={(v) => setG({ ...g, target: v ?? 0 })} prefix="$" />
          </Field>
          <Field label="Target Date (Optional)" hint="Pebbles paces savings to hit it">
            <input className="input" type="date" value={g.targetDate ?? ''} onChange={(e) => setG({ ...g, targetDate: e.target.value || null })} />
          </Field>
        </div>
        <Field label="Priority">
          <Segmented
            value={g.priority}
            options={[
              { value: 1, label: 'Someday' },
              { value: 2, label: 'Steady' },
              { value: 3, label: 'High' },
            ]}
            onChange={(v) => setG({ ...g, priority: v as Goal['priority'] })}
          />
        </Field>
        <Field label="Gemstone">
          <div className="row wrap" style={{ gap: 6 }}>
            {GEMS.map((gm) => (
              <button key={gm.id} className={`chip${g.gem === gm.id ? ' on' : ''}`} onClick={() => setG({ ...g, gem: gm.id })} title={gm.meaning}>
                <GemIcon gem={gm.id} size={14} /> {gm.name}
              </button>
            ))}
          </div>
        </Field>
        <ToggleRow title="This Is My Emergency Fund" hint="Filled first until it covers a month of expenses" on={g.isEmergency} onChange={(v) => setG({ ...g, isEmergency: v })} />
        {g.isEmergency && (
          <ToggleRow
            title="Raise the Goal Step by Step"
            hint="Starter month first, then the full fund. Pebbles moves the goal amount up on its own and follows your expenses."
            on={g.autoTarget !== false}
            onChange={(v) => setG({ ...g, autoTarget: v })}
          />
        )}
      </div>
    </Sheet>
  );
}

function GoalDetail({ goal, data, onClose, onEdit }: { goal: Goal; data: AppData; onClose: () => void; onEdit: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const bal = data.balances.get(goal.id) ?? 0;
  const [amount, setAmount] = useState<number | null>(null);
  const [prevBal, setPrevBal] = useState<number | undefined>(undefined);
  const contribs = data.contributions.filter((c) => c.goalId === goal.id).sort((a, b) => b.date.localeCompare(a.date));
  const remaining = Math.max(0, goal.target - bal);
  const checksLeft = goal.targetDate ? Math.max(1, Math.floor(diffDays(goal.targetDate, data.upcoming.period.payday) / 14) + 1) : null;
  const gems = earnedGems(bal, goal.target);

  const add = async (sign: 1 | -1) => {
    if (!amount || amount <= 0) return;
    setPrevBal(bal);
    await addContribution({ id: uid('c_'), goalId: goal.id, amount: sign * amount, date: today(), note: sign > 0 ? 'Added' : 'Taken out', paycheckId: null });
    if (sign > 0 && bal + amount >= goal.target && !goal.completedAt && !autoTarget(goal)) {
      await saveGoal({ ...goal, completedAt: Date.now() });
      toast(`You reached ${goal.name}! 🎉`);
    } else toast(sign > 0 ? `+${pebbles(amount)} pebbles` : `${pebbles(amount)} pebbles taken out`);
    setAmount(null);
  };

  return (
    <Sheet
      title={goal.name}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              if (await ask({ title: `Delete “${goal.name}”?`, body: 'This removes the goal and its history. Money in your bank isn’t touched.', confirm: 'Delete', danger: true })) {
                await deleteGoal(goal.id);
                onClose();
              }
            }}
          >
            <Trash2 /> Delete
          </button>
          <button className="btn" onClick={onEdit}>
            <Pencil /> Edit
          </button>
        </>
      }
    >
      <div className="col gap-l">
        {goal.image && (
          <div className="goal-cover" style={{ height: 190 }}>
            <img src={goal.image} alt={goal.name} />
          </div>
        )}
        <div className="center">
          <PebblePile amount={bal} seed={goal.id} height={160} gems={gems} animateFrom={prevBal} label={`${pebbles(bal)} pebbles`} />
          <div className="big-number num">{pebbles(bal)} pebbles saved</div>
          <div className="small muted">
            {remaining > 0 ? `${pebbles(remaining)} to go` : 'Goal reached'} · goal {pebbles(goal.target)}
          </div>
        </div>
        <Progress value={bal / goal.target} color={gemBar(goal.gem)} />
        {goal.isEmergency && data.emergency?.goalId === goal.id && <EmergencySteps data={data} goal={goal} />}
        {checksLeft && remaining > 0 && (
          <p className="small ink2 center">
            To reach it by {fmtLong(goal.targetDate!)}: about {usd(remaining / checksLeft, true)} per paycheck for {checksLeft} paycheck{checksLeft === 1 ? '' : 's'}.
          </p>
        )}
        <div className="row">
          <div className="grow">
            <NumberInput value={amount} onChange={setAmount} prefix="$" placeholder="Amount" allowEmpty ariaLabel="Amount" />
          </div>
          <button className="btn" onClick={() => add(-1)} disabled={!amount} aria-label="Take out">
            <Minus />
          </button>
          <button className="btn primary" onClick={() => add(1)} disabled={!amount}>
            <Plus /> Add
          </button>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Milestones
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {MILESTONES.map((m) => (
              <span key={m.gem} className={`chip${bal >= goal.target * m.pct ? ' on' : ''}`} style={{ opacity: bal >= goal.target * m.pct ? 1 : 0.55 }}>
                <GemIcon gem={m.gem} size={14} /> {Math.round(m.pct * 100)}%
              </span>
            ))}
          </div>
        </div>
        {contribs.length > 0 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              History
            </div>
            <div className="list">
              {contribs.slice(0, 30).map((c) => (
                <div key={c.id} className="list-item">
                  <div className="grow">
                    <div className="small strong">{c.note || (c.amount > 0 ? 'Added' : 'Taken out')}</div>
                    <div className="tiny muted">{fmtLong(c.date)}</div>
                  </div>
                  <div className={`amount ${c.amount > 0 ? 'in' : ''}`}>
                    {c.amount > 0 ? '+' : '−'}
                    {pebbles(Math.abs(c.amount))}
                  </div>
                  <button className="icon-btn" aria-label="Remove entry" onClick={() => void deleteContribution(c.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function emergencyLabel(data: AppData, g: Goal): string {
  const e = data.emergency;
  if (!e || e.goalId !== g.id || !autoTarget(g)) return 'Emergency fund';
  if (e.full) return `Emergency fund · full (${e.levels[e.levels.length - 1].months} months)`;
  return `Step ${e.step + 1} of ${e.levels.length}: ${e.levels[e.step].name}`;
}

/** The steps of the emergency fund: starter month, then the full fund. */
function EmergencySteps({ data, goal }: { data: AppData; goal: Goal }) {
  const e = data.emergency!;
  const auto = autoTarget(goal);
  return (
    <div style={{ background: 'var(--card-2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
      <div className="eyebrow">Emergency Fund Steps</div>
      <div className="list mt-s">
        {e.levels.map((l, i) => {
          const done = i < e.step;
          const now = i === e.step;
          return (
            <div key={l.months} className="row between small" style={{ padding: '4px 0', opacity: done || now ? 1 : 0.6 }}>
              <span className={now ? 'strong' : ''}>
                {done ? '✓ ' : now ? '→ ' : ''}
                {l.name} · {l.months} month{l.months === 1 ? '' : 's'}
              </span>
              <span className="num">{usd(l.amount, true)}</span>
            </div>
          );
        })}
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 0' }}>
        {e.monthsCovered.toFixed(1)} months of expenses covered ({usd(e.monthlyNeeds, true)} a month for bills, groceries and gas).{' '}
        {!auto
          ? 'Steps are off, so the goal stays where you set it.'
          : e.full
            ? 'All steps reached. New savings now go to your other goals; if you dip into it, Pebbles builds it back first.'
            : 'When a step is reached, Pebbles raises the goal to the next one. Once the full fund is there, savings go to your other goals.'}
      </p>
    </div>
  );
}
