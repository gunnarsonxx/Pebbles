import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Plus, RotateCcw, Sprout, Info, Moon, Clock, Sparkles } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { DayEditor } from '../sheets/DayEditor';
import { ReceiveSheet } from '../sheets/ReceiveSheet';
import { PaystubSheet } from '../sheets/PaystubSheet';
import { Field, GemIcon, NumberInput, Segmented, Sheet, TextInput, useConfirm, useToast } from '../components';
import { ShiftSchedule } from '../ShiftSchedule';
import { HolidaySettings } from './Settings';
import type { GoTo } from '../App';
import type { PaySettings, WorkDay } from '../../core/types';
import { saveSettings, setWorkDay } from '../../data/actions';
import { shiftSplit } from '../../core/pay';
import { fmtTime } from '../../core/dates';
import { periodByIndex, periodContaining, allRates } from '../../core/pay';
import { estimatePaycheck } from '../../core/paycheck';
import { rangeDays, fmtShort, fmtDay, dowName, dayOfWeek, diffDays, parts } from '../../core/dates';
import { signedUsd, usd, uid, num } from '../../core/money';
import { GEMS } from '../../core/categories';
import { BASE_RATE_ID } from '../../core/defaults';
import { archiveRate, clearWorkDay, saveRate } from '../../data/actions';
import { store } from '../../data/store';
import type { PayRate } from '../../core/types';

type PayView = 'paycheck' | 'shifts';

/** The Pay tab: what your checks will be (Paycheck), and the days you work (Shifts). Both use the same schedule. */
export function PaycheckScreen({ data, go, view, setView }: { data: AppData; go: GoTo; view?: string; setView: (v: PayView) => void }) {
  const v: PayView = view === 'shifts' ? 'shifts' : 'paycheck';
  const nowIdx = periodContaining(data.settings.pay, data.today).index;
  // null = follow the calendar: Paycheck shows the next check, Shifts the two weeks you're working now
  const [payIdx, setPayIdx] = useState<number | null>(null);
  const [shiftIdx, setShiftIdx] = useState<number | null>(null);
  return (
    <div>
      <div className="subnav">
        <Segmented
          value={v}
          options={[
            { value: 'paycheck', label: 'Paycheck' },
            { value: 'shifts', label: 'Shifts' },
          ]}
          onChange={setView}
        />
      </div>
      {v === 'paycheck' ? (
        <PaycheckView
          data={data}
          go={go}
          idx={payIdx ?? data.upcoming.period.index}
          setIdx={(i) => setPayIdx(i === data.upcoming.period.index ? null : i)}
          openShifts={(i) => {
            setShiftIdx(i === nowIdx ? null : i);
            setView('shifts');
          }}
        />
      ) : (
        <ShiftsView
          data={data}
          idx={shiftIdx ?? nowIdx}
          nowIdx={nowIdx}
          setIdx={(i) => setShiftIdx(i === nowIdx ? null : i)}
          openPaycheck={(i) => {
            setPayIdx(i === data.upcoming.period.index ? null : i);
            setView('paycheck');
          }}
        />
      )}
    </div>
  );
}

function PaycheckView({ data, idx, setIdx, openShifts }: { data: AppData; go: GoTo; idx: number; setIdx: (i: number) => void; openShifts: (i: number) => void }) {
  const toast = useToast();
  const offset = idx - data.upcoming.period.index;
  const setOffset = (o: number) => setIdx(data.upcoming.period.index + o);
  const [receiving, setReceiving] = useState(false);
  const [rateEdit, setRateEdit] = useState<PayRate | null>(null);
  const [stubOpen, setStubOpen] = useState(false);
  const { settings } = data;
  const period = periodByIndex(settings.pay, data.upcoming.period.index + offset);
  const est = useMemo(() => (offset === 0 ? data.upcoming : estimatePaycheck(period, settings, data.rates, data.workdays, data.rulesFile, data.calibration)), [offset, data, period, settings]);
  const days = rangeDays(period.start, period.end);
  const record = data.paychecks.get(period.start);
  const rates = allRates(settings.pay.baseRate, data.rates);
  const g = est.gross;
  const w = est.withholding;
  const edits = days.filter((d) => data.workdays.has(d));

  const overnight = shiftSplit(settings.pay).overnight;

  const label = offset === 0 ? 'Next Paycheck' : offset < 0 ? (offset === -1 ? 'Previous Paycheck' : `${-offset} Paychecks Ago`) : offset === 1 ? 'The One After' : `${offset} Paychecks Ahead`;

  return (
    <div>
      <div className="row between" style={{ margin: '0 0 12px' }}>
        <button className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label="Previous period">
          <ChevronLeft />
        </button>
        <div className="center">
          <div className="eyebrow">{label}</div>
          <div className="strong">
            {fmtShort(period.start)} – {fmtShort(period.end)} · paid {fmtDay(period.payday)}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setOffset(offset + 1)} aria-label="Next period">
          <ChevronRight />
        </button>
      </div>

      <div className="grid two-wide">
        <div className="col" style={{ gap: 14 }}>
          <div className="card">
            <div className="row between" style={{ alignItems: 'flex-end' }}>
              <div>
                <div className="eyebrow">
                  {record?.received && record.actualNet != null ? 'Take-Home' : 'Estimated Take-Home'}
                  {record?.depositPending && (
                    <span className="badge warn" style={{ marginLeft: 8, padding: '1px 6px', fontSize: 10, verticalAlign: 'middle' }}>
                      Pending
                    </span>
                  )}
                </div>
                <div className="hero-number">{usd(record?.received && record.actualNet != null ? record.actualNet : est.net)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="small muted">Gross</div>
                <div className="strong num">{usd(g.gross)}</div>
              </div>
            </div>
            <div className="small muted mt-s">
              {num(g.workedHours)} h worked{g.leaveHours ? ` · ${num(g.leaveHours)} h paid leave` : ''}
              {g.otHours ? ` · ${num(g.otHours)} h overtime` : ''}
            </div>
            {record?.received && record.actualNet != null && Math.abs(record.actualNet - record.estimatedNet) >= 0.01 && (
              <div className={`diff-chip ${record.actualNet >= record.estimatedNet ? 'up' : 'down'}`}>
                {record.actualNet >= record.estimatedNet ? '▲' : '▼'} {usd(Math.abs(record.actualNet - record.estimatedNet))} vs. the {usd(record.estimatedNet)} estimate
              </div>
            )}
          </div>

          {diffDays(period.payday, data.today) <= 1 && (
            <button className="card action-card" onClick={() => setReceiving(true)}>
              <span className="list-icon" style={{ background: 'var(--moss)', color: 'var(--on-moss)' }}>
                <Sprout />
              </span>
              <div className="grow">
                <div className="strong">{record?.received ? 'Edit this payday' : diffDays(period.payday, data.today) > 0 ? 'Payday is tomorrow' : 'Got paid?'}</div>
                <div className="small muted">{record?.received ? 'Change the amount or how it was split' : 'Enter what landed and Pebbles splits it up'}</div>
              </div>
              <ChevronRight size={18} className="muted" />
            </button>
          )}

          <button className="card action-card" onClick={() => openShifts(period.index)}>
            <span className="list-icon" style={{ background: 'var(--income)', color: '#fff' }}>
              {overnight ? <Moon /> : <CalendarDays />}
            </span>
            <div className="grow">
              <div className="strong">
                {g.days.filter((d) => d.status === 'worked').length} shift{g.days.filter((d) => d.status === 'worked').length === 1 ? '' : 's'} · {num(g.workedHours)} h
              </div>
              <div className="small muted">
                {fmtShort(period.start)} – {fmtShort(period.end)}
                {edits.length ? ` · ${edits.length} day${edits.length === 1 ? '' : 's'} changed` : ' · your normal schedule'}. Change them in Shifts.
              </div>
            </div>
            <ChevronRight size={18} className="muted" />
          </button>

          <div className="card">
            <div className="card-head">
              <div className="eyebrow">Pay Rates</div>
              <button className="btn small" onClick={() => setRateEdit({ id: uid('rate_'), name: '', rate: settings.pay.baseRate + 2, gem: 'amethyst' })}>
                <Plus /> Add Rate
              </button>
            </div>
            <div className="list">
              {rates.map((r) => (
                <button key={r.id} className="list-item" onClick={() => (r.isBase ? toast('Change your base rate in Settings → Pay & schedule') : setRateEdit(r))}>
                  <GemIcon gem={r.gem} size={22} />
                  <div className="grow strong">{r.name}</div>
                  <div className="amount">{usd(r.rate)}/hr</div>
                </button>
              ))}
            </div>
            <p className="tiny muted mt">Pick a rate when you edit a day. Split days can mix rates.</p>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Pay Stubs</div>
                <div className="small muted">
                  {data.paystubs[0]
                    ? `Last: ${data.paystubs[0].payDate ? fmtDay(data.paystubs[0].payDate) : 'no date'}${data.paystubs[0].net != null ? ` · ${usd(data.paystubs[0].net)} take-home` : ''}`
                    : 'Pebbles learns your real taxes and deductions from them'}
                </div>
              </div>
              <button className="btn small" onClick={() => setStubOpen(true)}>
                <FileText /> Upload
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            How We Got There
          </div>
          <Line label={`Base Pay`} detail={`${num(g.scheduledHours)} h × ${usd(settings.pay.baseRate)}`} value={usd(g.basePay)} strong />
          {g.adjustments.map((a, i) => (
            <Line key={i} label={a.label} detail={a.detail} value={signedUsd(a.amount)} tone={a.amount >= 0 ? 'good' : 'bad'} indent />
          ))}
          <div className="divider" />
          <Line label="Gross Pay" value={usd(g.gross)} strong />
          {w.preTax.map((d) => (
            <Line key={d.id} label={d.name} detail="before tax" value={signedUsd(-d.amount)} indent />
          ))}
          {w.taxes.map((t) => (
            <Line key={t.key} label={t.label} detail={t.detail} value={signedUsd(-t.amount)} indent />
          ))}
          {w.postTax.map((d) => (
            <Line key={d.id} label={d.name} detail="after tax" value={signedUsd(-d.amount)} indent />
          ))}
          {data.calibration !== 0 && <Line label="Matched to Your Real Paychecks" detail="learned from recent deposits" value={signedUsd(data.calibration)} indent />}
          <div className="divider" />
          <Line label="Take-Home" value={usd(est.net)} strong big />
          <div className="divider" />
          <div className="row small muted" style={{ alignItems: 'flex-start' }}>
            <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              {est.rulesYearUsed} tax tables ({est.rulesStatus}) · version {data.rulesFile.version}. Federal uses the IRS Pub 15-T method; Colorado uses DR 1098.
              {w.warnings.map((x) => (
                <div key={x} className="warn">
                  {x}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {data.paychecks.size > 0 && <History data={data} />}

      {receiving && <ReceiveSheet data={data} estimate={est} onClose={() => setReceiving(false)} />}
      {rateEdit && <RateSheet rate={rateEdit} onClose={() => setRateEdit(null)} />}
      {stubOpen && <PaystubSheet data={data} onClose={() => setStubOpen(false)} />}
    </div>
  );
}

/** The days you work, two weeks at a time. Changes here flow into every paycheck estimate. */
function ShiftsView({ data, idx, nowIdx, setIdx, openPaycheck }: { data: AppData; idx: number; nowIdx: number; setIdx: (i: number) => void; openPaycheck: (i: number) => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [shiftsOpen, setShiftsOpen] = useState(false);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { settings } = data;
  const period = periodByIndex(settings.pay, idx);
  const est = useMemo(() => estimatePaycheck(period, settings, data.rates, data.workdays, data.rulesFile, data.calibration), [period, settings, data]);
  const g = est.gross;
  const days = rangeDays(period.start, period.end);
  const edits = days.filter((d) => data.workdays.has(d));
  const record = data.paychecks.get(period.start);
  const overnight = shiftSplit(settings.pay).overnight;
  const resetPeriod = async () => {
    const ok = await ask({
      title: 'Reset these two weeks?',
      body: `This clears the ${edits.length} day${edits.length === 1 ? '' : 's'} you changed (missed shifts, different rates, extra hours) and goes back to your normal schedule.`,
      confirm: 'Reset',
      danger: true,
    });
    if (!ok) return;
    const saved: WorkDay[] = edits.map((d) => data.workdays.get(d)!).filter(Boolean);
    for (const d of edits) await clearWorkDay(d);
    toast('Back to your normal schedule', {
      label: 'Undo',
      run: async () => {
        for (const w of saved) await setWorkDay(w);
      },
    });
  };
  const off = idx - nowIdx;
  const label = off === 0 ? 'This Pay Period' : off === -1 ? 'Last Pay Period' : off < 0 ? `${-off} Pay Periods Ago` : off === 1 ? 'Next Pay Period' : `${off} Pay Periods Ahead`;
  const paid = record?.received && record.actualNet != null;

  return (
    <div>
      <div className="row between" style={{ margin: '0 0 12px' }}>
        <button className="icon-btn" onClick={() => setIdx(idx - 1)} aria-label="Previous pay period">
          <ChevronLeft />
        </button>
        <div className="center">
          <div className="eyebrow">{label}</div>
          <div className="strong">
            {fmtShort(period.start)} – {fmtShort(period.end)}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setIdx(idx + 1)} aria-label="Next pay period">
          <ChevronRight />
        </button>
      </div>
      <div className="col" style={{ gap: 14, maxWidth: 720, margin: '0 auto' }}>
        <div className="card">
          <div className="card-head">
            <div className="eyebrow">{overnight ? 'Your Shifts' : 'Your Two Weeks'}</div>
            <div className="row gap-s">
              {edits.length > 0 && (
                <button className="btn ghost small" onClick={() => void resetPeriod()}>
                  <RotateCcw /> Reset
                </button>
              )}
              <button className="btn small" onClick={() => setShiftsOpen(true)} aria-label="Shift times">
                {overnight ? <Moon /> : <Clock />} {overnight ? `${fmtTime(settings.pay.shiftStart!)}–${fmtTime(settings.pay.shiftEnd!)}` : `${num(settings.pay.hoursPerDay)} h days`}
              </button>
            </div>
          </div>
          {!settings.pay.holidays.confirmed && (
            <button className="tip-row" onClick={() => setHolidaysOpen(true)}>
              <Sparkles size={16} /> Does your job pay extra on holidays? Pick which ones so Pebbles can add it.
            </button>
          )}
          {!overnight && (
            <button className="tip-row" onClick={() => setShiftsOpen(true)}>
              <Moon size={16} /> Work overnight shifts? Set your shift times so hours split across midnight correctly.
            </button>
          )}
          <div className="small muted" style={{ marginBottom: 8 }}>
            {overnight ? 'Each night shows the shift that starts that night. Tap one to change it.' : 'Tap a day to change it.'}
          </div>
          <div className="cal" style={{ marginBottom: 6 }}>
            {days.slice(0, 7).map((d) => (
              <div key={d} className="cal-dow">
                {dowName(dayOfWeek(d))}
              </div>
            ))}
          </div>
          <div className="cal">
            {g.days.map((d) => {
              const cls = [
                'day',
                d.status === 'off' ? 'off' : '',
                d.status === 'missed' ? 'missed' : '',
                d.status === 'pto' || d.status === 'sick' || d.status === 'holiday' ? 'leave' : '',
                d.edited ? 'edited' : '',
                d.date === data.today ? 'today' : '',
              ].join(' ');
              const hrs = d.workedHours || d.paidLeaveHours;
              return (
                <button key={d.date} className={cls} onClick={() => setEditing(d.date)} aria-label={`${fmtDay(d.date)}: ${d.status}${d.holiday ? `, ${d.holiday.name}` : ''}`}>
                  <span className="d">{parts(d.date).d}</span>
                  <span className="h">{d.status === 'missed' ? 'off' : d.status === 'off' ? '–' : `${num(hrs)}h`}</span>
                  {(d.status === 'pto' || d.status === 'sick' || d.status === 'holiday') && <span className="tiny muted">{d.status === 'pto' ? 'PTO' : d.status === 'sick' ? 'Sick' : 'Off'}</span>}
                  {d.holiday && <span className="holiday-dot" title={d.holiday.name} />}
                  <span className="gems">
                    {d.segments
                      .filter((s) => s.rateId !== BASE_RATE_ID)
                      .map((s, i) => {
                        const r = data.rates.find((x) => x.id === s.rateId);
                        return <GemIcon key={i} gem={r?.gem ?? 'amethyst'} size={11} title={`${s.rateName} $${s.rate.toFixed(2)}`} />;
                      })}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="row wrap small muted mt" style={{ gap: 14 }}>
            <span className="row gap-s">
              <span className="swatch" style={{ background: 'var(--bad-soft)', border: '1px solid var(--line)', marginTop: 0 }} /> Missed
            </span>
            <span className="row gap-s">
              <span className="swatch" style={{ background: 'var(--moss-soft)', border: '1px solid var(--line)', marginTop: 0 }} /> Paid leave
            </span>
            {g.days.some((d) => d.holiday) && (
              <span className="row gap-s">
                <span className="holiday-dot static" /> Paid Holiday
              </span>
            )}
            <span className="row gap-s">
              <GemIcon gem="amethyst" size={12} /> Different rate
            </span>
          </div>
        </div>

        <button className="card action-card" onClick={() => openPaycheck(idx)}>
          <span className="list-icon" style={{ background: 'var(--moss)', color: 'var(--on-moss)' }}>
            <Sprout />
          </span>
          <div className="grow">
            <div className="strong">
              {paid ? `Paid ${usd(record!.actualNet!)}` : `About ${usd(est.net)} take-home`} on {fmtDay(period.payday)}
              {record?.depositPending && (
                <span className="badge warn" style={{ marginLeft: 8, padding: '1px 6px', fontSize: 10, verticalAlign: 'middle' }}>
                  Pending
                </span>
              )}
            </div>
            <div className="small muted">
              {num(g.workedHours)} h worked{g.otHours ? ` · ${num(g.otHours)} h overtime` : ''} · {usd(g.gross)} gross. See the paycheck.
            </div>
          </div>
          <ChevronRight size={18} className="muted" />
        </button>
      </div>
      {editing && <DayEditor date={editing} data={data} onClose={() => setEditing(null)} />}
      {shiftsOpen && <ShiftsSheet pay={settings.pay} onClose={() => setShiftsOpen(false)} />}
      {holidaysOpen && <HolidaysSheet pay={settings.pay} onClose={() => setHolidaysOpen(false)} />}
    </div>
  );
}

function Line({ label, detail, value, strong, indent, tone, big }: { label: string; detail?: string; value: string; strong?: boolean; indent?: boolean; tone?: 'good' | 'bad'; big?: boolean }) {
  return (
    <div className="row" style={{ padding: '6px 0', paddingLeft: indent ? 10 : 0, alignItems: 'flex-start' }}>
      <div className="grow">
        <div className={strong ? 'strong' : ''} style={big ? { fontSize: 17 } : undefined}>
          {label}
        </div>
        {detail && <div className="tiny muted">{detail}</div>}
      </div>
      <div className={`num ${strong ? 'strong' : ''} ${tone ?? ''}`} style={big ? { fontSize: 17 } : undefined}>
        {value}
      </div>
    </div>
  );
}

function History({ data }: { data: AppData }) {
  const list = [...data.paychecks.values()]
    .filter((p) => p.received)
    .sort((a, b) => b.payday.localeCompare(a.payday))
    .slice(0, 8);
  if (!list.length) return null;
  return (
    <div className="card mt">
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Recent Paychecks
      </div>
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Payday</th>
              <th className="r">Estimated</th>
              <th className="r">Actual</th>
              <th className="r">Saved</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{fmtDay(p.payday)}</td>
                <td className="r num">{usd(p.estimatedNet)}</td>
                <td className="r num">
                  {p.actualNet != null ? usd(p.actualNet) : '–'}
                  {p.depositPending && <div className="tiny warn">pending</div>}
                </td>
                <td className="r num">{p.split ? usd(p.split.savings, true) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateSheet({ rate, onClose }: { rate: PayRate; onClose: () => void }) {
  const [r, setR] = useState(rate);
  const exists = !!store.get('rates', rate.id);
  return (
    <Sheet
      title={exists ? 'Edit Pay Rate' : 'New Pay Rate'}
      onClose={onClose}
      footer={
        <>
          {exists && (
            <button
              className="btn danger"
              onClick={async () => {
                await archiveRate(r);
                onClose();
              }}
            >
              Remove
            </button>
          )}
          <button
            className="btn primary"
            disabled={!r.name.trim() || !(r.rate > 0)}
            onClick={async () => {
              await saveRate({ ...r, name: r.name.trim() });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <Field label="Name" hint="e.g. Lead shift, Training, Weekend, Forklift">
          <TextInput value={r.name} onChange={(v) => setR({ ...r, name: v })} autoFocus />
        </Field>
        <Field label="Hourly Rate">
          <NumberInput value={r.rate} onChange={(v) => setR({ ...r, rate: v ?? 0 })} prefix="$" suffix="/hr" />
        </Field>
        <Field label="Gem Marker">
          <div className="row wrap">
            {GEMS.map((gm) => (
              <button key={gm.id} className={`chip${r.gem === gm.id ? ' on' : ''}`} onClick={() => setR({ ...r, gem: gm.id })}>
                <GemIcon gem={gm.id} size={14} /> {gm.name}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Sheet>
  );
}

function ShiftsSheet({ pay, onClose }: { pay: PaySettings; onClose: () => void }) {
  const [p, setP] = useState(pay);
  return (
    <Sheet
      title="Your Shifts"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await saveSettings((s) => ({ ...s, pay: p }));
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <ShiftSchedule pay={p} onChange={setP} />
    </Sheet>
  );
}

function HolidaysSheet({ pay, onClose }: { pay: PaySettings; onClose: () => void }) {
  return (
    <Sheet
      title="Holiday Pay"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            onClick={async () => {
              await saveSettings((s) => ({ ...s, pay: { ...s.pay, holidays: { ...s.pay.holidays, ids: [], confirmed: true } } }));
              onClose();
            }}
          >
            My Job Doesn’t Pay Holidays
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await saveSettings((s) => ({ ...s, pay: { ...s.pay, holidays: { ...s.pay.holidays, confirmed: true } } }));
              onClose();
            }}
          >
            Done
          </button>
        </>
      }
    >
      <HolidaySettings p={pay} set={(f) => void saveSettings(f)} />
    </Sheet>
  );
}
