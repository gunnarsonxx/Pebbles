import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { CalendarClock, ChevronRight, Download, FolderOpen, Landmark, Laptop, Link2, MonitorSmartphone, Palette, Plug, Plus, RefreshCw, Smartphone, Trash2, Unlink, Upload, Wallet } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { useSync } from '../../data/useData';
import { Field, NumberInput, Segmented, TextInput, ToggleRow, useConfirm, useToast } from '../components';
import { saveSettings, checkTaxUpdates, exportBackup, restoreBackup } from '../../data/actions';
import { syncClient, DEFAULT_PORT } from '../../data/syncClient';
import { desktop, platformKind, type DesktopInfo, type DeviceInfo, type PairingInfo } from '../../platform';
import { addDays, diffDays, fmtDay, fmtLong } from '../../core/dates';
import { STATE_NAMES, rulesForYear } from '../../core/taxrules';
import { holidaysInYear } from '../../core/holidays';
import { statusLabel } from '../../core/tax';
import { FOOD_PLAN_LABEL, foodPlanMonthly } from '../../core/food';
import { usd, uid } from '../../core/money';
import { store } from '../../data/store';
import type { DeductionKind, PayrollDeduction, Settings } from '../../core/types';

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <div className="card" id={id}>
      <h2 style={{ marginBottom: 14 }}>{title}</h2>
      <div className="col gap-l">{children}</div>
    </div>
  );
}

import { UpdateCard } from '../UpdateCard';
import { ShiftSchedule } from '../ShiftSchedule';
import { ACCENTS, PALETTES } from '../themes';
import { ChecksCard } from '../ChecksCard';
import { BankSettings, GasStationSettings, GroceryPriceSettings } from './ConnectionsSettings';

export const SETTINGS_SECTIONS: { id: string; title: string; hint: string; icon: typeof Wallet }[] = [
  { id: 'pay', title: 'Pay & Schedule', hint: 'Rate, shifts, pay periods, overtime, holidays', icon: CalendarClock },
  { id: 'taxes', title: 'Taxes & Deductions', hint: 'Filing status, W-4, Colorado, 401(k), insurance', icon: Landmark },
  { id: 'budget', title: 'Budget', hint: 'How each paycheck is split, household and car', icon: Wallet },
  { id: 'connections', title: 'Connections', hint: 'Banks, King Soopers, gas prices, status checks', icon: Plug },
  { id: 'look', title: 'Appearance', hint: 'Your name, colors, light and dark mode, reminders', icon: Palette },
  { id: 'sync', title: 'Sync & Devices', hint: 'Pair your phone and computer', icon: MonitorSmartphone },
  { id: 'app', title: 'Updates & Backup', hint: 'Get the newest version, tax tables, back up your data', icon: Download },
];

export function SettingsScreen({ data, section, open }: { data: AppData; section?: string; open: (id: string | undefined) => void }) {
  const s = data.settings;
  const set = (patch: (s: Settings) => Settings) => void saveSettings(patch);
  const sync = useSync();
  if (!section || !SETTINGS_SECTIONS.some((x) => x.id === section)) {
    return (
      <div className="col" style={{ gap: 14, maxWidth: 720 }}>
        <div className="card" style={{ padding: 6 }}>
          <div className="list">
            {SETTINGS_SECTIONS.map((x) => (
              <button key={x.id} className="list-item settings-link" onClick={() => open(x.id)}>
                <span className="list-icon" style={{ width: 38, height: 38, background: 'var(--moss-soft)', color: 'var(--moss-strong)' }}>
                  <x.icon />
                </span>
                <div className="grow">
                  <div className="strong">{x.title}</div>
                  <div className="tiny muted">{x.id === 'sync' ? syncHint(sync.status) : x.hint}</div>
                </div>
                <ChevronRight size={18} className="muted" />
              </button>
            ))}
          </div>
        </div>
        <p className="tiny muted center">Pebbles · your data stays on your phone and your computer.</p>
      </div>
    );
  }
  return (
    <div className="col settings-page" style={{ gap: 14, maxWidth: 720 }}>
      {section === 'pay' && <PaySection s={s} set={set} />}
      {section === 'taxes' && (
        <>
          <TaxSection data={data} set={set} />
          <DeductionsSection s={s} set={set} />
        </>
      )}
      {section === 'budget' && (
        <>
          <BudgetSection s={s} set={set} />
          <HouseholdSection s={s} set={set} />
        </>
      )}
      {section === 'connections' && (
        <>
          <ChecksCard />
          <BankSettings s={s} set={set} />
          <GroceryPriceSettings s={s} set={set} />
          <GasStationSettings s={s} set={set} />
          <PricesSection s={s} set={set} />
        </>
      )}
      {section === 'look' && <GeneralSection s={s} set={set} />}
      {section === 'sync' && <SyncSection />}
      {section === 'app' && (
        <>
          <UpdateCard />
          <DataSection />
        </>
      )}
    </div>
  );
}

function syncHint(status: string): string {
  if (status === 'ok') return 'Synced with your computer';
  if (status === 'unpaired') return 'Not paired yet';
  if (status === 'offline') return 'Away from home Wi-Fi';
  if (status === 'error') return 'Sync problem: tap to see';
  return 'Pair your phone and computer';
}

// ---------------- pay ----------------

function PaySection({ s, set }: { s: Settings; set: (f: (s: Settings) => Settings) => void }) {
  const p = s.pay;
  const periodEnd = addDays(p.periodAnchor, 13);
  const payday = addDays(periodEnd, p.paydayOffset);
  return (
    <Section title="Pay">
      <div className="form-grid two">
        <Field label="Base Hourly Rate">
          <NumberInput value={p.baseRate} onChange={(v) => set((x) => ({ ...x, pay: { ...x.pay, baseRate: v ?? 0 } }))} prefix="$" suffix="/hr" />
        </Field>
      </div>
      <ShiftSchedule pay={p} onChange={(np) => set((x) => ({ ...x, pay: np }))} />
      <div className="form-grid two">
        <Field label="A Pay Period Started On" hint={`So periods run ${fmtDay(p.periodAnchor)} – ${fmtDay(periodEnd)}`}>
          <input
            className="input"
            type="date"
            value={p.periodAnchor}
            onChange={(e) => e.target.value && set((x) => ({ ...x, pay: { ...x.pay, periodAnchor: e.target.value } }))}
          />
        </Field>
        <Field label="…And That Period Was Paid On" hint={`${p.paydayOffset} day${p.paydayOffset === 1 ? '' : 's'} after it ends`}>
          <input
            className="input"
            type="date"
            value={payday}
            onChange={(e) => {
              if (!e.target.value) return;
              const off = diffDays(e.target.value, periodEnd);
              set((x) => ({ ...x, pay: { ...x.pay, paydayOffset: Math.max(0, off) } }));
            }}
          />
        </Field>
      </div>
      <details>
        <summary className="strong small" style={{ cursor: 'pointer' }}>
          Overtime
        </summary>
        <div className="form-grid two mt">
          <Field label="Overtime After (Hours / Week)">
            <NumberInput value={p.overtime.weeklyThreshold} onChange={(v) => set((x) => ({ ...x, pay: { ...x.pay, overtime: { ...x.pay.overtime, weeklyThreshold: v ?? 40 } } }))} suffix="h" />
          </Field>
          <Field label="…Or After (Hours / Day)" hint="Colorado law: 12. Leave empty for none.">
            <NumberInput value={p.overtime.dailyThreshold} allowEmpty onChange={(v) => set((x) => ({ ...x, pay: { ...x.pay, overtime: { ...x.pay.overtime, dailyThreshold: v } } }))} suffix="h" />
          </Field>
          <Field label="Overtime Multiplier">
            <NumberInput value={p.overtime.multiplier} onChange={(v) => set((x) => ({ ...x, pay: { ...x.pay, overtime: { ...x.pay.overtime, multiplier: v ?? 1.5 } } }))} suffix="×" />
          </Field>
        </div>
        <div className="mt">
          <Field label="Overtime Rate Is Based On">
            <Segmented
              value={p.overtime.method}
              options={[
                { value: 'weighted', label: 'Blended Rate (Law)' },
                { value: 'base', label: 'Base Rate' },
              ]}
              onChange={(v) => set((x) => ({ ...x, pay: { ...x.pay, overtime: { ...x.pay.overtime, method: v } } }))}
            />
          </Field>
          <p className="tiny muted mt">With different rates in one week, the law uses the week’s blended (weighted average) rate for overtime. Pick “Base rate” if your stubs show otherwise.</p>
        </div>
      </details>
      <HolidaySettings p={p} set={set} />
    </Section>
  );
}

export function HolidaySettings({ p, set }: { p: Settings['pay']; set: (f: (s: Settings) => Settings) => void }) {
  const h = p.holidays;
  const up = (patch: Partial<Settings['pay']['holidays']>) => set((x) => ({ ...x, pay: { ...x.pay, holidays: { ...x.pay.holidays, ...patch, confirmed: true } } }));
  const year = new Date().getFullYear();
  const list = holidaysInYear(year, h);
  return (
    <div className="col gap-l">
      <div className="divider" />
      <div>
        <h3 style={{ fontSize: 17 }}>Holiday Pay</h3>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Tick only the holidays your job pays extra for. Pebbles adds that pay when you work one. A pay stub that shows holiday pay ticks it for you.
        </p>
      </div>
      <Field label="Holiday Pay Rate" hint="1.5× is time and a half. Set 1× if you don’t get extra.">
        <NumberInput value={p.holidayMultiplier} onChange={(v) => set((x) => ({ ...x, pay: { ...x.pay, holidayMultiplier: v ?? 1 } }))} suffix="×" />
      </Field>
      <Field label="Which Hours Count">
        <Segmented
          value={h.rule}
          options={[
            { value: 'calendar', label: 'Hours on the Date' },
            { value: 'shiftStart', label: 'Shifts Starting That Day' },
          ]}
          onChange={(v) => up({ rule: v })}
        />
      </Field>
      <ToggleRow title="Move Weekend Holidays to Friday or Monday" hint="How offices observe them. Most 24/7 jobs pay on the real date." on={h.observed} onChange={(v) => up({ observed: v })} />
      <Field label={`Paid holidays in ${year}`}>
        <div className="list">
          {list.map(({ def, date }) => {
            const on = h.ids.includes(def.id);
            return (
              <label key={def.id} className="list-item check-row">
                <input type="checkbox" checked={on} onChange={() => up({ ids: on ? h.ids.filter((x) => x !== def.id) : [...h.ids, def.id] })} />
                <div className="grow">
                  <div className="small strong">{def.name}</div>
                  <div className="tiny muted">
                    {fmtDay(date)}
                    {def.federal ? '' : ' · not a federal holiday'}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

// ---------------- taxes ----------------

function TaxSection({ data, set }: { data: AppData; set: (f: (s: Settings) => Settings) => void }) {
  const toast = useToast();
  const s = data.settings;
  const st = s.stateTax;
  const yr = rulesForYear(data.rulesFile, Number(data.today.slice(0, 4)));
  const stateRules = yr.rules.states[st.state];
  const locals = Object.keys(stateRules?.localTaxes ?? {});
  const [checking, setChecking] = useState(false);
  return (
    <Section title="Taxes">
      <Field label="Filing Status (from Your W-4)">
        <select className="input" value={s.filingStatus} onChange={(e) => set((x) => ({ ...x, filingStatus: e.target.value as Settings['filingStatus'] }))}>
          {(['single', 'married_joint', 'married_separate', 'head_of_household'] as const).map((f) => (
            <option key={f} value={f}>
              {statusLabel(f)}
            </option>
          ))}
        </select>
      </Field>
      <ToggleRow title="W-4 Step 2 Box Checked" hint="Two jobs, or both spouses work" on={s.w4.step2MultipleJobs} onChange={(v) => set((x) => ({ ...x, w4: { ...x.w4, step2MultipleJobs: v } }))} />
      <div className="form-grid two">
        <Field label="Children Under 17">
          <NumberInput value={s.w4.childrenUnder17} onChange={(v) => set((x) => ({ ...x, w4: { ...x.w4, childrenUnder17: Math.max(0, Math.round(v ?? 0)) } }))} />
        </Field>
        <Field label="Other Dependents">
          <NumberInput value={s.w4.otherDependents} onChange={(v) => set((x) => ({ ...x, w4: { ...x.w4, otherDependents: Math.max(0, Math.round(v ?? 0)) } }))} />
        </Field>
        <Field label="Extra Federal Withholding" hint="W-4 step 4(c), per paycheck">
          <NumberInput value={s.w4.extraWithholding} onChange={(v) => set((x) => ({ ...x, w4: { ...x.w4, extraWithholding: v ?? 0 } }))} prefix="$" />
        </Field>
        <Field label="Other Income / Deductions" hint="W-4 step 4(a) / 4(b), yearly">
          <div className="row">
            <NumberInput value={s.w4.otherIncome} onChange={(v) => set((x) => ({ ...x, w4: { ...x.w4, otherIncome: v ?? 0 } }))} prefix="+" />
            <NumberInput value={s.w4.deductions} onChange={(v) => set((x) => ({ ...x, w4: { ...x.w4, deductions: v ?? 0 } }))} prefix="−" />
          </div>
        </Field>
      </div>
      <div className="divider" />
      <div className="form-grid two">
        <Field label="State">
          <select className="input" value={st.state} onChange={(e) => set((x) => ({ ...x, stateTax: { ...x.stateTax, state: e.target.value, localTax: null } }))}>
            {Object.entries(STATE_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="City">
          <TextInput value={st.city} onChange={(v) => set((x) => ({ ...x, stateTax: { ...x.stateTax, city: v } }))} />
        </Field>
      </div>
      {locals.length > 0 && (
        <Field label="Local Tax Where You Work" hint={stateRules?.noLocalTaxNote}>
          <select className="input" value={st.localTax ?? ''} onChange={(e) => set((x) => ({ ...x, stateTax: { ...x.stateTax, localTax: e.target.value || null } }))}>
            <option value="">None (e.g. Colorado Springs)</option>
            {locals.map((l) => (
              <option key={l} value={l}>
                {stateRules!.localTaxes![l].label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {st.state === 'CO' && (
        <>
          <div className="form-grid two">
            <Field label="DR 0004 Allowance (Optional)" hint="Line 2 of your Colorado DR 0004, if you filed one">
              <NumberInput value={st.dr0004Allowance} allowEmpty onChange={(v) => set((x) => ({ ...x, stateTax: { ...x.stateTax, dr0004Allowance: v } }))} prefix="$" />
            </Field>
            <Field label="Extra Colorado Withholding" hint="per paycheck">
              <NumberInput value={st.extraWithholding} onChange={(v) => set((x) => ({ ...x, stateTax: { ...x.stateTax, extraWithholding: v ?? 0 } }))} prefix="$" />
            </Field>
          </div>
          <ToggleRow title="Colorado FAMLI Premium" hint="Paid family & medical leave: most employers withhold the employee share" on={st.famliEnabled} onChange={(v) => set((x) => ({ ...x, stateTax: { ...x.stateTax, famliEnabled: v } }))} />
        </>
      )}
      {!stateRules && (
        <Field label={`${STATE_NAMES[st.state]} income tax rate`} hint="Pebbles models Colorado in detail. For other states, enter your effective rate from a pay stub.">
          <NumberInput value={st.customFlatRate} allowEmpty onChange={(v) => set((x) => ({ ...x, stateTax: { ...x.stateTax, customFlatRate: v } }))} suffix="%" />
        </Field>
      )}
      <div className="card tint" style={{ padding: 14 }}>
        <div className="row between wrap">
          <div>
            <div className="strong">Tax tables · version {data.rulesFile.version}</div>
            <div className="tiny muted">
              Years: {Object.keys(data.rulesFile.years).join(', ')} · {yr.year} is {yr.rules.status}
            </div>
          </div>
          <button
            className="btn small"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              const r = await checkTaxUpdates(true);
              setChecking(false);
              toast(r.error ? r.error : r.updated ? `Updated to tax tables ${r.version}` : 'Your tax tables are up to date');
            }}
          >
            <RefreshCw /> {checking ? 'Checking…' : 'Check for Updates'}
          </button>
        </div>
        {yr.rules.statusNote && <p className="tiny ink2 mt">{yr.rules.statusNote}</p>}
        <ul className="tiny muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {yr.rules.sources.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
      <ToggleRow title="Check for Tax Changes Automatically" hint="Once a day when online" on={s.integrations.autoUpdate} onChange={(v) => set((x) => ({ ...x, integrations: { ...x.integrations, autoUpdate: v } }))} />
    </Section>
  );
}

// ---------------- deductions ----------------

const KIND_LABEL: Record<DeductionKind, string> = {
  traditional_401k: '401(k) / 403(b) (Pre-Tax)',
  roth_401k: 'Roth 401(k) (After Tax)',
  section125: 'Health / Dental / Vision (Pre-Tax)',
  hsa: 'HSA Through Work (Pre-Tax)',
  post_tax: 'Other (After Tax)',
};

function DeductionsSection({ s, set }: { s: Settings; set: (f: (s: Settings) => Settings) => void }) {
  const update = (id: string, patch: Partial<PayrollDeduction>) => set((x) => ({ ...x, deductions: x.deductions.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  return (
    <Section title="Paycheck Deductions">
      <p className="small ink2">Copy these from a pay stub: retirement, insurance, HSA, union dues. They make the take-home estimate exact.</p>
      {s.deductions.map((d) => (
        <div key={d.id} className="card tint" style={{ padding: 12 }}>
          <div className="form-grid two">
            <Field label="Name">
              <TextInput value={d.name} onChange={(v) => update(d.id, { name: v })} />
            </Field>
            <Field label="Type">
              <select className="input" value={d.kind} onChange={(e) => update(d.id, { kind: e.target.value as DeductionKind })}>
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount">
              <div className="row">
                <NumberInput value={d.amount} onChange={(v) => update(d.id, { amount: v ?? 0 })} prefix={d.mode === 'fixed' ? '$' : undefined} suffix={d.mode === 'percent' ? '%' : undefined} />
                <Segmented
                  value={d.mode}
                  options={[
                    { value: 'fixed', label: '$' },
                    { value: 'percent', label: '%' },
                  ]}
                  onChange={(v) => update(d.id, { mode: v })}
                />
              </div>
            </Field>
            <div style={{ alignSelf: 'end' }}>
              <button className="btn ghost danger small" onClick={() => set((x) => ({ ...x, deductions: x.deductions.filter((y) => y.id !== d.id) }))}>
                <Trash2 /> Remove
              </button>
            </div>
          </div>
        </div>
      ))}
      <div className="row wrap">
        <button className="btn small" onClick={() => set((x) => ({ ...x, deductions: [...x.deductions, { id: uid('d_'), name: '401(k)', kind: 'traditional_401k', mode: 'percent', amount: 5 }] }))}>
          <Plus /> Retirement
        </button>
        <button className="btn small" onClick={() => set((x) => ({ ...x, deductions: [...x.deductions, { id: uid('d_'), name: 'Health Insurance', kind: 'section125', mode: 'fixed', amount: 50 }] }))}>
          <Plus /> Insurance
        </button>
        <button className="btn small" onClick={() => set((x) => ({ ...x, deductions: [...x.deductions, { id: uid('d_'), name: 'Other', kind: 'post_tax', mode: 'fixed', amount: 10 }] }))}>
          <Plus /> Other
        </button>
      </div>
    </Section>
  );
}

// ---------------- household ----------------

function HouseholdSection({ s, set }: { s: Settings; set: (f: (s: Settings) => Settings) => void }) {
  const h = s.household;
  const up = (patch: Partial<Settings['household']>) => set((x) => ({ ...x, household: { ...x.household, ...patch } }));
  return (
    <Section title="Household & Car">
      <div className="form-grid two">
        <Field label="Adults (19–50)">
          <NumberInput value={h.adults} onChange={(v) => up({ adults: Math.max(0, Math.round(v ?? 0)) })} />
        </Field>
        <Field label="Children">
          <NumberInput value={h.children} onChange={(v) => up({ children: Math.max(0, Math.round(v ?? 0)) })} />
        </Field>
        <Field label="Adults 51+">
          <NumberInput value={h.seniors} onChange={(v) => up({ seniors: Math.max(0, Math.round(v ?? 0)) })} />
        </Field>
        <Field label="Other Basics per Month" hint="Toiletries, cleaning, pet food">
          <NumberInput value={h.otherEssentialsMonthly} onChange={(v) => up({ otherEssentialsMonthly: v ?? 0 })} prefix="$" />
        </Field>
      </div>
      <Field label="Grocery Comfort Level" hint={`USDA ${FOOD_PLAN_LABEL[h.foodPlan]} plan for your household ≈ ${usd(foodPlanMonthly(h), true)}/month`}>
        <Segmented
          value={h.foodPlan}
          options={(['thrifty', 'low', 'moderate', 'liberal'] as const).map((p) => ({ value: p, label: FOOD_PLAN_LABEL[p] }))}
          onChange={(v) => up({ foodPlan: v })}
        />
      </Field>
      <div className="form-grid two">
        <Field label="Car Fuel Economy">
          <NumberInput value={h.vehicleMpg} allowEmpty onChange={(v) => up({ vehicleMpg: v })} suffix="mpg" />
        </Field>
        <Field label="Miles Driven per Month" hint="Commute + errands">
          <NumberInput value={h.milesPerMonth} allowEmpty onChange={(v) => up({ milesPerMonth: v })} suffix="mi" />
        </Field>
      </div>
    </Section>
  );
}

// ---------------- budget ----------------

function BudgetSection({ s, set }: { s: Settings; set: (f: (s: Settings) => Settings) => void }) {
  const b = s.budget;
  const up = (patch: Partial<Settings['budget']>) => set((x) => ({ ...x, budget: { ...x.budget, ...patch } }));
  return (
    <Section title="Budget Style">
      <Field label={`Savings aim: ${b.savingsTargetPct}% of take-home`} hint="Pebbles suggests up to this, and less when money is tight">
        <input className="range" type="range" min={0} max={50} value={b.savingsTargetPct} onChange={(e) => up({ savingsTargetPct: Number(e.target.value) })} />
      </Field>
      <Field label={`Always save at least: ${b.minSavingsPct}% when possible`}>
        <input className="range" type="range" min={0} max={20} value={b.minSavingsPct} onChange={(e) => up({ minSavingsPct: Number(e.target.value) })} />
      </Field>
      <Field label={`Spending money: about ${b.wantsMaxPct}% of take-home`} hint="Once your bills are in, anything beyond this goes to savings (experts suggest 30%)">
        <input className="range" type="range" min={15} max={60} step={5} value={b.wantsMaxPct} onChange={(e) => up({ wantsMaxPct: Number(e.target.value) })} />
      </Field>
      <Field label={`Always keep for you: at least ${b.personalFloorPct}%`} hint="Your comfort floor. Savings never eat into it">
        <input className="range" type="range" min={0} max={40} value={b.personalFloorPct} onChange={(e) => up({ personalFloorPct: Number(e.target.value) })} />
      </Field>
      <Field label="Setting Aside for Bills">
        <Segmented
          value={b.billsMode}
          options={[
            { value: 'due_dates', label: 'Bills Due Before Next Payday' },
            { value: 'even', label: 'Same Amount Every Check' },
          ]}
          onChange={(v) => up({ billsMode: v })}
        />
      </Field>
      <div className="form-grid two">
        <Field label="Emergency Fund Goal" hint="Months of bills + essentials">
          <NumberInput value={b.emergencyMonths} onChange={(v) => up({ emergencyMonths: Math.max(1, v ?? 3) })} suffix="mo" />
        </Field>
        <Field label="Round Suggestions To">
          <NumberInput value={b.roundTo} onChange={(v) => up({ roundTo: Math.max(1, v ?? 5) })} prefix="$" />
        </Field>
      </div>
    </Section>
  );
}

// ---------------- prices ----------------

function PricesSection({ s, set }: { s: Settings; set: (f: (s: Settings) => Settings) => void }) {
  return (
    <Section title="Prices & Updates">
      <p className="small ink2">
        Pebbles checks grocery inflation and staple prices from the U.S. Bureau of Labor Statistics, and gas prices from the U.S. Energy Information Administration, then adjusts your essentials so you’re always covered.
      </p>
      <Field label="EIA API Key" hint="A key is built in for weekly Colorado gas prices. Paste your own only if you want to use a different one.">
        <TextInput value={s.integrations.eiaApiKey} onChange={(v) => set((x) => ({ ...x, integrations: { ...x.integrations, eiaApiKey: v.trim() } }))} placeholder="Built-in key in use" />
      </Field>
      <Field label="Tax Table Update Address">
        <TextInput value={s.integrations.taxRulesUrl} onChange={(v) => set((x) => ({ ...x, integrations: { ...x.integrations, taxRulesUrl: v.trim() } }))} />
      </Field>
    </Section>
  );
}

// ---------------- general ----------------

function GeneralSection({ s, set }: { s: Settings; set: (f: (s: Settings) => Settings) => void }) {
  return (
    <Section title="Appearance">
      <Field label="Your First Name (for Greetings)">
        <TextInput value={s.name} onChange={(v) => set((x) => ({ ...x, name: v }))} />
      </Field>
      <Field label="Theme">
        <Segmented
          value={s.theme}
          options={[
            { value: 'auto', label: 'Match Device' },
            { value: 'light', label: 'Limestone' },
            { value: 'dark', label: 'Basalt' },
          ]}
          onChange={(v) => set((x) => ({ ...x, theme: v }))}
        />
      </Field>
      <Field label="Background">
        <div className="row wrap" style={{ gap: 10 }}>
          {PALETTES.map((p) => (
            <button
              key={p.id}
              className={`swatch-btn${(s.palette || 'limestone') === p.id ? ' on' : ''}`}
              title={p.name}
              aria-label={`${p.name} background`}
              style={{ background: `linear-gradient(135deg, ${p.light} 50%, ${p.dark} 50%)` }}
              onClick={() => set((x) => ({ ...x, palette: p.id }))}
            />
          ))}
        </div>
        <span className="hint">{PALETTES.find((p) => p.id === (s.palette || 'limestone'))?.name}</span>
      </Field>
      <Field label="Accent">
        <div className="row wrap" style={{ gap: 10 }}>
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              className={`swatch-btn${(s.accent || 'moss') === a.id ? ' on' : ''}`}
              title={a.name}
              aria-label={`${a.name} accent`}
              style={{ background: a.color }}
              onClick={() => set((x) => ({ ...x, accent: a.id }))}
            />
          ))}
        </div>
        <span className="hint">
          {(() => {
            const a = ACCENTS.find((x) => x.id === (s.accent || 'moss'));
            return a ? ('note' in a ? `${a.name}: ${a.note}` : a.name) : '';
          })()}
        </span>
      </Field>
      {platformKind === 'android' && <ToggleRow title="Payday & Bill Reminders" on={s.notifications} onChange={(v) => set((x) => ({ ...x, notifications: v }))} />}
    </Section>
  );
}

// ---------------- data ----------------

function DataSection() {
  const toast = useToast();
  const ask = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Section title="Backup">
      <p className="small ink2">Your computer keeps automatic daily backups. You can also save a copy anywhere you like.</p>
      <div className="row wrap">
        <button
          className="btn small"
          onClick={async () => {
            const text = await exportBackup();
            const blob = new Blob([text], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pebbles-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          }}
        >
          <Download /> Save a Backup
        </button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          <Upload /> Restore
        </button>
        {desktop && (
          <button className="btn small" onClick={() => void desktop!.openDataFolder()}>
            <FolderOpen /> Open Data Folder
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const n = await restoreBackup(await f.text());
              toast(`Restored ${n} records`);
            } catch (err) {
              toast((err as Error).message);
            }
            e.target.value = '';
          }}
        />
      </div>
      <button
        className="btn ghost danger small"
        style={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          if (!(await ask({ title: 'Erase this device?', body: 'Everything Pebbles stores on this device is deleted. Data already synced to your computer stays there.', confirm: 'Erase', danger: true }))) return;
          await store.wipe();
          location.reload();
        }}
      >
        <Trash2 /> Erase This Device
      </button>
    </Section>
  );
}

// ---------------- sync ----------------

function SyncSection() {
  if (platformKind === 'desktop') return <DesktopSync />;
  return <PhoneSync />;
}

export function PhoneSync() {
  const sync = useSync();
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hub = sync.hub;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <Smartphone />
        <h2 className="grow">Sync with Your Computer</h2>
        <span className={`sync-dot ${sync.status}`} />
      </div>
      {platformKind === 'web' && !hub && (
        <p className="small warn" style={{ marginBottom: 10 }}>
          You’re using Pebbles in a browser. Sync works from the Android app and the Windows program.
        </p>
      )}
      {hub ? (
        <div className="col gap-l">
          <div className="card tint" style={{ padding: 14 }}>
            <div className="strong">Paired with {hub.hubName}</div>
            <div className="small muted">
              {hub.host}:{hub.port} · {sync.lastSyncAt ? `last synced ${new Date(sync.lastSyncAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'not synced yet'}
            </div>
            {sync.message && <div className="small warn mt">{sync.message}</div>}
          </div>
          <div className="row wrap">
            <button className="btn primary small" onClick={() => void syncClient.syncNow()}>
              <RefreshCw /> Sync Now
            </button>
            <button
              className="btn small"
              onClick={async () => {
                const ok = await syncClient.rediscover();
                toast(ok ? 'Found your computer' : 'Couldn’t find Pebbles on this Wi-Fi');
              }}
            >
              Find My Computer
            </button>
            <button className="btn ghost danger small" onClick={() => void syncClient.unpair()}>
              <Unlink /> Unpair
            </button>
          </div>
          <p className="tiny muted">Syncs automatically whenever you’re on the same Wi-Fi as your computer. Everything is encrypted between your devices.</p>
        </div>
      ) : (
        <div className="col gap-l">
          <ol className="small ink2" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Open Pebbles on your computer and go to Settings → Sync & Devices.</li>
            <li>Click “Pair a Phone” and type the address and 6-digit code here.</li>
          </ol>
          <div className="form-grid two">
            <Field label="Computer Address">
              <TextInput value={address} onChange={setAddress} placeholder={`192.168.1.20:${DEFAULT_PORT}`} />
            </Field>
            <Field label="6-Digit Code">
              <input className="input num" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
            </Field>
          </div>
          {err && <p className="small bad">{err}</p>}
          <button
            className="btn primary"
            disabled={busy || !address || code.replace(/\D/g, '').length !== 6}
            onClick={async () => {
              setBusy(true);
              setErr('');
              try {
                const link = await syncClient.pair(address, code);
                toast(`Paired with ${link.hubName}`);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Link2 /> {busy ? 'Pairing…' : 'Pair'}
          </button>
        </div>
      )}
    </div>
  );
}

export function DesktopSync() {
  const sync = useSync();
  const toast = useToast();
  const ask = useConfirm();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(Date.now());
  const [fw, setFw] = useState<{ supported: boolean; allowed: boolean } | null>(null);
  const [fixing, setFixing] = useState(false);

  const refresh = async () => {
    setInfo(await desktop!.info());
    setDevices(await desktop!.devices());
    if (desktop!.firewall) setFw(await desktop!.firewall());
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      setNow(Date.now());
      void desktop!.devices().then(setDevices);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!pairing) return;
    // every address, so the phone can try each one
    const addr = `${pairing.addresses.length ? pairing.addresses.join(',') : '127.0.0.1'}:${pairing.port}`;
    void QRCode.toDataURL(`pebbles://pair?addr=${encodeURIComponent(addr)}&code=${pairing.code}`, { margin: 1, width: 180 }).then(setQr);
  }, [pairing]);

  useEffect(() => {
    if (pairing && now > pairing.expiresAt) setPairing(null);
  }, [now, pairing]);

  const deviceCount = useRef(devices.length);
  useEffect(() => {
    if (pairing && devices.length > deviceCount.current) {
      toast(`${devices[devices.length - 1].name} paired`);
      setPairing(null);
    }
    deviceCount.current = devices.length;
  }, [devices, pairing, toast]);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <Laptop />
        <h2 className="grow">Phone Sync</h2>
        <span className={`sync-dot ${sync.status}`} />
      </div>
      <div className="grid two">
        <div className="col">
          <p className="small ink2">This computer is your Pebbles home base. Your phone syncs with it over your home Wi-Fi, so your data never goes to the internet.</p>
          {info && (
            <div className="small">
              <div>
                <span className="muted">Computer name:</span> {info.hubName}
              </div>
              <div>
                <span className="muted">Address:</span> {info.addresses.length ? info.addresses.map((a) => `${a}:${info.port}`).join(', ') : 'No network found'}
              </div>
              <div className="tiny muted">Data: {info.dataPath}</div>
            </div>
          )}
          {fw?.supported && !fw.allowed && (
            <div className="card tint" style={{ padding: 14, borderLeft: '4px solid var(--warn)' }}>
              <div className="strong small">Windows Firewall May Block Your Phone</div>
              <p className="small ink2" style={{ margin: '4px 0 10px' }}>
                Phones reach Pebbles over your home Wi-Fi. Allow it once and Windows will ask for permission.
              </p>
              <button
                className="btn small primary"
                disabled={fixing}
                onClick={async () => {
                  setFixing(true);
                  const r = await desktop!.fixFirewall!();
                  setFw({ supported: true, allowed: r.allowed });
                  setFixing(false);
                  toast(r.allowed ? 'Phones can reach Pebbles now' : 'Windows didn’t add the rule. Try again and choose Yes.');
                }}
              >
                {fixing ? 'Waiting for Windows…' : 'Allow Phones Through Firewall'}
              </button>
            </div>
          )}
          {fw?.supported && fw.allowed && <div className="tiny good">✓ Windows Firewall lets your phone connect</div>}
          {!pairing ? (
            <button
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                setPairing(await desktop!.pairingStart());
              }}
            >
              <Smartphone /> Pair a Phone
            </button>
          ) : (
            <div className="card tint" style={{ padding: 16 }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
                <div className="grow">
                  <div className="small muted">On your phone: Settings → Sync & devices, then enter</div>
                  <div className="small muted mt">Address</div>
                  <div className="strong num" style={{ fontSize: 18 }}>
                    {pairing.addresses[0] ?? '?'}:{pairing.port}
                  </div>
                  {pairing.addresses.length > 1 && <div className="tiny muted">If that doesn’t work, try {pairing.addresses.slice(1).map((a) => `${a}:${pairing.port}`).join(' or ')}. The QR code tries them all.</div>}
                  <div className="small muted mt">Code</div>
                  <div className="num" style={{ fontSize: 34, fontWeight: 700, letterSpacing: '0.12em' }}>
                    {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
                  </div>
                  <div className="tiny muted">Expires in {Math.max(0, Math.ceil((pairing.expiresAt - now) / 60000))} min</div>
                </div>
                {qr && (
                  <div className="center">
                    <img src={qr} alt="Pairing QR code" width={130} height={130} style={{ borderRadius: 10 }} />
                    <div className="tiny muted" style={{ maxWidth: 140 }}>
                      Or point your phone’s camera here
                    </div>
                  </div>
                )}
              </div>
              {pairing.addresses.length > 1 && <p className="tiny muted mt">If that address doesn’t work, try: {pairing.addresses.slice(1).map((a) => `${a}:${pairing.port}`).join(', ')}</p>}
              <button className="btn small mt" onClick={() => void desktop!.pairingStop().then(() => setPairing(null))}>
                Cancel
              </button>
            </div>
          )}
          {info && (
            <>
              <ToggleRow title="Keep Running in the Tray When Closed" hint="So your phone can sync any time this PC is on" on={info.closeToTray} onChange={(v) => void desktop!.setPrefs({ closeToTray: v }).then(refresh)} />
              <ToggleRow title="Start Pebbles with Windows" on={info.startWithWindows} onChange={(v) => void desktop!.setPrefs({ startWithWindows: v }).then(refresh)} />
            </>
          )}
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Paired Phones
          </div>
          {devices.length ? (
            <div className="list">
              {devices.map((d) => (
                <div key={d.id} className="list-item">
                  <Smartphone size={18} />
                  <div className="grow">
                    <div className="strong">{d.name}</div>
                    <div className="tiny muted">
                      Paired {fmtLong(new Date(d.pairedAt).toISOString().slice(0, 10))} · {d.lastSeen ? `last sync ${new Date(d.lastSeen).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'never synced'}
                    </div>
                  </div>
                  <button
                    className="btn ghost danger small"
                    onClick={async () => {
                      if (await ask({ title: `Unpair ${d.name}?`, body: 'It stops syncing until you pair it again.', confirm: 'Unpair', danger: true })) {
                        await desktop!.revoke(d.id);
                        void refresh();
                      }
                    }}
                  >
                    Unpair
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">No phones yet.</p>
          )}
          <p className="tiny muted mt">The first time a phone connects, Windows may ask whether Pebbles can use private networks. Choose Allow.</p>
        </div>
      </div>
    </div>
  );
}
