import { useState } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { Field, NumberInput, PebbleLogo, Segmented, TextInput, ToggleRow } from '../components';
import { saveSettings, saveGoal, newGoal } from '../../data/actions';
import { addDays, dayOfWeek, diffDays, fmtDay, fmtShort, today } from '../../core/dates';
import { shiftHours, upcomingPayPeriod } from '../../core/pay';
import { STATE_NAMES } from '../../core/taxrules';
import { statusLabel } from '../../core/tax';
import { usd } from '../../core/money';
import { platformKind } from '../../platform';
import { DesktopSync, PhoneSync } from './Settings';
import { ShiftSchedule } from '../ShiftSchedule';
import type { Settings } from '../../core/types';

export function Onboarding({ data }: { data: AppData }) {
  const [step, setStep] = useState(0);
  const [s, setS] = useState<Settings>(() => {
    const t = today();
    const lastSunday = addDays(t, -dayOfWeek(t));
    return { ...data.settings, pay: { ...data.settings.pay, periodAnchor: lastSunday, paydayOffset: 6 } };
  });
  const [bedrock, setBedrock] = useState(true);
  const [pairFirst, setPairFirst] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState<number | null>(null);

  const p = s.pay;
  const periodEnd = addDays(p.periodAnchor, 13);
  const payday = addDays(periodEnd, p.paydayOffset);
  const next = upcomingPayPeriod(p, today());
  const steps = 5;

  const finish = async () => {
    await saveSettings({ ...s, onboarded: true });
    if (bedrock) await saveGoal(newGoal({ name: 'Bedrock fund', isEmergency: true, gem: 'obsidian', priority: 3, target: 3000 }));
    if (goalName.trim() && goalTarget && goalTarget > 0) await saveGoal(newGoal({ name: goalName.trim(), target: goalTarget, gem: 'sapphire', priority: 2 }));
  };

  return (
    <div className="onboard">
      <div className="card">
        <div className="steps">
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>

        {step === 0 && (
          <div className="col gap-l">
            <PebbleLogo size={56} />
            <h1>Welcome to Pebbles</h1>
            <p className="ink2">
              A calm place for your money. Know exactly what payday will bring, see where it goes, and build your savings one pebble at a time.
            </p>
            <Field label="What should we call you?">
              <TextInput value={s.name} onChange={(v) => setS({ ...s, name: v })} placeholder="First name" autoFocus />
            </Field>
            {platformKind === 'android' &&
              (pairFirst ? (
                <PhoneSync />
              ) : (
                <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPairFirst(true)}>
                  I already set up Pebbles on my computer
                </button>
              ))}
            {platformKind === 'desktop' &&
              (pairFirst ? (
                <div className="col">
                  <p className="small ink2">
                    Click <strong>Pair a phone</strong>, then on your phone open <strong>Settings → Sync & devices</strong> and enter the address and code (or scan the QR code). Everything from your phone appears here in a few seconds.
                  </p>
                  <DesktopSync />
                </div>
              ) : (
                <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPairFirst(true)}>
                  I already set up Pebbles on my phone
                </button>
              ))}
          </div>
        )}

        {step === 1 && (
          <div className="col gap-l">
            <h1>Your pay</h1>
            <div className="form-grid two">
              <Field label="Base hourly rate">
                <NumberInput value={p.baseRate} onChange={(v) => setS({ ...s, pay: { ...p, baseRate: v ?? 0 } })} prefix="$" suffix="/hr" />
              </Field>
            </div>
            <ShiftSchedule pay={p} onChange={(np) => setS({ ...s, pay: np })} />
            <div className="card tint" style={{ padding: 14 }}>
              <div className="small muted">Base pay per paycheck</div>
              <div className="big-number">{usd(p.workDays.length * 2 * shiftHours(p) * p.baseRate)}</div>
              <div className="small muted">
                {p.workDays.length * 2 * shiftHours(p)} hours every two weeks. Different-rate days and missed days get adjusted from here.
              </div>
            </div>
            <div className="form-grid two">
              <Field label="First day of a recent pay period">
                <input className="input" type="date" value={p.periodAnchor} onChange={(e) => e.target.value && setS({ ...s, pay: { ...p, periodAnchor: e.target.value } })} />
              </Field>
              <Field label="Payday for that period">
                <input
                  className="input"
                  type="date"
                  value={payday}
                  onChange={(e) => e.target.value && setS({ ...s, pay: { ...p, paydayOffset: Math.max(0, diffDays(e.target.value, periodEnd)) } })}
                />
              </Field>
            </div>
            <p className="small ink2">
              Periods run {fmtDay(p.periodAnchor)} – {fmtDay(periodEnd)}. Your next payday is <strong>{fmtDay(next.payday)}</strong> for work {fmtShort(next.start)} – {fmtShort(next.end)}.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="col gap-l">
            <h1>Taxes</h1>
            <p className="ink2">Pebbles estimates federal, Social Security, Medicare, state and local taxes for every paycheck, and checks online for tax changes.</p>
            <div className="form-grid two">
              <Field label="State you work in">
                <select className="input" value={s.stateTax.state} onChange={(e) => setS({ ...s, stateTax: { ...s.stateTax, state: e.target.value, localTax: null } })}>
                  {Object.entries(STATE_NAMES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="City">
                <TextInput value={s.stateTax.city} onChange={(v) => setS({ ...s, stateTax: { ...s.stateTax, city: v } })} />
              </Field>
            </div>
            <Field label="Filing status on your W-4">
              <select className="input" value={s.filingStatus} onChange={(e) => setS({ ...s, filingStatus: e.target.value as Settings['filingStatus'] })}>
                {(['single', 'married_joint', 'married_separate', 'head_of_household'] as const).map((f) => (
                  <option key={f} value={f}>
                    {statusLabel(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Children under 17 claimed on your W-4">
              <NumberInput value={s.w4.childrenUnder17} onChange={(v) => setS({ ...s, w4: { ...s.w4, childrenUnder17: Math.max(0, Math.round(v ?? 0)) } })} />
            </Field>
            <p className="small muted">Retirement, insurance and other deductions from your pay stub can be added later in Settings for an exact match.</p>
          </div>
        )}

        {step === 3 && (
          <div className="col gap-l">
            <h1>Home & car</h1>
            <p className="ink2">This sets your essentials: enough groceries for your home and enough gas to get around, adjusted to live prices.</p>
            <div className="form-grid two">
              <Field label="Adults in your home">
                <NumberInput value={s.household.adults} onChange={(v) => setS({ ...s, household: { ...s.household, adults: Math.max(0, Math.round(v ?? 1)) } })} />
              </Field>
              <Field label="Children">
                <NumberInput value={s.household.children} onChange={(v) => setS({ ...s, household: { ...s.household, children: Math.max(0, Math.round(v ?? 0)) } })} />
              </Field>
              <Field label="Car fuel economy">
                <NumberInput value={s.household.vehicleMpg} allowEmpty onChange={(v) => setS({ ...s, household: { ...s.household, vehicleMpg: v } })} suffix="mpg" />
              </Field>
              <Field label="Miles per month">
                <NumberInput value={s.household.milesPerMonth} allowEmpty onChange={(v) => setS({ ...s, household: { ...s.household, milesPerMonth: v } })} suffix="mi" />
              </Field>
            </div>
            <Field label="Grocery comfort level">
              <Segmented
                value={s.household.foodPlan}
                options={[
                  { value: 'thrifty', label: 'Thrifty' },
                  { value: 'low', label: 'Low-cost' },
                  { value: 'moderate', label: 'Moderate' },
                  { value: 'liberal', label: 'Liberal' },
                ]}
                onChange={(v) => setS({ ...s, household: { ...s.household, foodPlan: v } })}
              />
            </Field>
          </div>
        )}

        {step === 4 && (
          <div className="col gap-l">
            <h1>Start your pile</h1>
            <p className="ink2">Every dollar you save becomes a pebble. Pick something to save for, and add a photo of it later in Savings.</p>
            <ToggleRow title="Bedrock fund (recommended)" hint="An emergency cushion Pebbles fills first" on={bedrock} onChange={setBedrock} />
            <div className="form-grid two">
              <Field label="Something you’re saving for">
                <TextInput value={goalName} onChange={setGoalName} placeholder="Ring, car, down payment…" />
              </Field>
              <Field label="How much?">
                <NumberInput value={goalTarget} onChange={setGoalTarget} prefix="$" allowEmpty />
              </Field>
            </div>
            {platformKind === 'android' && <p className="small muted">To sync with your Windows computer, open Settings → Sync & devices after this.</p>}
          </div>
        )}

        <div className="row between mt-l">
          {step > 0 ? (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              <ChevronLeft /> Back
            </button>
          ) : (
            <span />
          )}
          {step < steps - 1 ? (
            <button className="btn primary" onClick={() => setStep(step + 1)} disabled={step === 1 && !(p.baseRate > 0)}>
              Next <ArrowRight />
            </button>
          ) : (
            <button className="btn primary" onClick={() => void finish()}>
              Let’s go <ArrowRight />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
