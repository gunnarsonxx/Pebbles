import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Field, NumberInput, Segmented, Sheet, ToggleRow, GemIcon, TextInput } from '../components';
import { allRates, newWorkDay, preMidnightShare, resolveDay, shiftHours } from '../../core/pay';
import { fmtDay, dayOfWeek } from '../../core/dates';
import { BASE_RATE_ID } from '../../core/defaults';
import { usd, signedUsd } from '../../core/money';
import { clearWorkDay, setWorkDay } from '../../data/actions';
import type { AppData } from '../../data/useData';
import type { DayStatus, WorkDay, WorkSegment } from '../../core/types';

const STATUS: { value: DayStatus; label: string }[] = [
  { value: 'worked', label: 'Worked' },
  { value: 'missed', label: 'Missed' },
  { value: 'pto', label: 'PTO' },
  { value: 'sick', label: 'Sick' },
  { value: 'holiday', label: 'Holiday' },
];

export function DayEditor({ date, data, onClose }: { date: string; data: AppData; onClose: () => void }) {
  const { settings } = data;
  const pay = settings.pay;
  const existing = data.workdays.get(date);
  const scheduled = pay.workDays.includes(dayOfWeek(date));
  const [day, setDay] = useState<WorkDay>(() => existing ?? newWorkDay(date, scheduled ? 'worked' : 'worked', pay));
  const rates = allRates(pay.baseRate, data.rates);

  const preview = useMemo(() => resolveDay(date, pay, rates, day), [date, pay, rates, day]);
  const normal = scheduled ? shiftHours(pay) * pay.baseRate : 0;
  const dayPay = preview.straightPay + preview.leavePay + preview.holidayPremium;

  const setSeg = (i: number, s: Partial<WorkSegment>) => setDay({ ...day, segments: day.segments.map((x, k) => (k === i ? { ...x, ...s } : x)) });

  const save = async () => {
    const clean = { ...day, segments: day.segments.filter((s) => s.hours > 0) };
    await setWorkDay(clean);
    onClose();
  };

  return (
    <Sheet
      title={pay.shiftStart ? `${fmtDay(date)} night shift` : fmtDay(date)}
      onClose={onClose}
      footer={
        <>
          {existing ? (
            <button
              className="btn"
              onClick={async () => {
                await clearWorkDay(date);
                onClose();
              }}
            >
              Back to normal
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save}>
            Save day
          </button>
        </>
      }
    >
      <div className="col gap-l">
        {!scheduled && <div className="badge">Not a usual workday: hours here are extra</div>}
        <Segmented value={day.status} options={STATUS} onChange={(v) => setDay({ ...newWorkDay(date, v, pay), note: day.note, segments: v === 'worked' ? day.segments.length ? day.segments : newWorkDay(date, 'worked', pay).segments : [] })} />

        {day.status === 'worked' && (
          <div className="col">
            {day.segments.map((s, i) => (
              <div key={i} className="card tint" style={{ padding: 12 }}>
                <div className="form-grid two">
                  <Field label="Hours">
                    <NumberInput value={s.hours} onChange={(v) => setSeg(i, { hours: Math.max(0, v ?? 0) })} suffix="h" ariaLabel="Hours" />
                  </Field>
                  <Field label="Pay rate">
                    <select
                      className="input"
                      value={s.rateId ?? 'custom'}
                      onChange={(e) => setSeg(i, e.target.value === 'custom' ? { rateId: null, rate: s.rate ?? pay.baseRate } : { rateId: e.target.value, rate: null })}
                    >
                      {rates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · ${r.rate.toFixed(2)}
                        </option>
                      ))}
                      <option value="custom">Custom rate…</option>
                    </select>
                  </Field>
                </div>
                {s.rateId == null && (
                  <div className="mt">
                    <Field label="Custom hourly rate">
                      <NumberInput value={s.rate} onChange={(v) => setSeg(i, { rate: v ?? 0 })} prefix="$" suffix="/hr" ariaLabel="Custom rate" />
                    </Field>
                  </div>
                )}
                {day.segments.length > 1 && (
                  <button className="btn ghost small mt" onClick={() => setDay({ ...day, segments: day.segments.filter((_, k) => k !== i) })}>
                    <Trash2 /> Remove
                  </button>
                )}
              </div>
            ))}
            <button className="btn small" onClick={() => setDay({ ...day, segments: [...day.segments, { hours: 4, rateId: BASE_RATE_ID, rate: null }] })}>
              <Plus /> Split the day across another rate
            </button>
            <ToggleRow
              title="Worked a holiday"
              hint={`Paid × ${pay.holidayMultiplier} (change in Settings)`}
              on={!!day.workedHoliday}
              onChange={(v) => setDay({ ...day, workedHoliday: v })}
            />
          </div>
        )}

        {(day.status === 'pto' || day.status === 'sick' || day.status === 'holiday') && (
          <Field label="Paid hours" hint="Paid at your base rate">
            <NumberInput value={day.paidHours} onChange={(v) => setDay({ ...day, paidHours: Math.max(0, v ?? 0) })} suffix="h" />
          </Field>
        )}

        {day.status === 'missed' && <p className="ink2">An unpaid day. Pebbles subtracts it from your base pay.</p>}

        <Field label="Note (optional)">
          <TextInput value={day.note} onChange={(v) => setDay({ ...day, note: v })} placeholder="e.g. covered for Sam, dentist" />
        </Field>

        <div className="card tint row between" style={{ padding: 14 }}>
          <div>
            <div className="small muted">This day pays</div>
            <div className="big-number num">{usd(dayPay)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">vs a normal day</div>
            <div className={`strong num ${dayPay - normal >= 0 ? 'good' : 'bad'}`}>{signedUsd(dayPay - normal)}</div>
          </div>
        </div>
        {pay.shiftStart && preview.workedHours > 0 && (
          <p className="small ink2">
            {Math.round(preview.workedHours * preMidnightShare(preview.workedHours, pay) * 100) / 100} h count on {fmtDay(date)}, {Math.round(preview.workedHours * (1 - preMidnightShare(preview.workedHours, pay)) * 100) / 100} h on the next day. Leaving early trims the morning part.
          </p>
        )}
        <p className="tiny muted">Overtime is figured for the whole week on the paycheck screen.</p>
      </div>
    </Sheet>
  );
}

export function RateGem({ rateId, data }: { rateId: string | null; data: AppData }) {
  const r = rateId ? data.rates.find((x) => x.id === rateId) : null;
  if (!rateId || rateId === BASE_RATE_ID) return null;
  return <GemIcon gem={r?.gem ?? 'amethyst'} size={12} title={r?.name ?? 'Custom rate'} />;
}
