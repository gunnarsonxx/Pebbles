import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Field, NumberInput, Segmented, Sheet, ToggleRow, GemIcon, TextInput } from '../components';
import { allRates, hoursForTimes, newWorkDay, preMidnightShare, resolveDay, shiftHours, shiftSplit, splitTimes } from '../../core/pay';
import { holidayOn } from '../../core/holidays';
import { addDays } from '../../core/dates';
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
  { value: 'holiday', label: 'Holiday Off' },
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

  const sp = shiftSplit(pay);
  const overnight = sp.overnight;
  const start = day.start ?? pay.shiftStart ?? '21:30';
  const end = day.end ?? pay.shiftEnd ?? '06:00';
  const setTimes = (st: string, en: string) => {
    const custom = st !== pay.shiftStart || en !== pay.shiftEnd;
    const h = hoursForTimes(st, en, pay);
    const segs = day.segments.length === 1 ? [{ ...day.segments[0], hours: h }] : day.segments;
    setDay({ ...day, start: custom ? st : null, end: custom ? en : null, segments: segs });
  };
  const own = day.start && day.end ? splitTimes(day.start, day.end, pay) : null;
  const share = own ? (preview.workedHours > 0 ? Math.min(preview.workedHours, own.pre) / preview.workedHours : 1) : preMidnightShare(preview.workedHours, pay);
  const holToday = holidayOn(date, pay.holidays);
  const holNext = overnight ? holidayOn(addDays(date, 1), pay.holidays) : null;
  const autoHoliday = pay.holidays.rule === 'shiftStart' ? holToday : holToday || holNext;
  // holiday pay for the hours of this shift that fall on a paid holiday
  const holShare = preview.workedHours <= 0 ? 0 : pay.holidays.rule === 'shiftStart' ? (holToday ? 1 : 0) : (holToday ? share : 0) + (holNext ? 1 - share : 0);
  const autoPremium = Math.round(preview.straightPay * holShare * Math.max(0, pay.holidayMultiplier - 1) * 100) / 100;
  const dayPay = preview.straightPay + preview.leavePay + preview.holidayPremium + autoPremium;

  const setSeg = (i: number, s: Partial<WorkSegment>) => setDay({ ...day, segments: day.segments.map((x, k) => (k === i ? { ...x, ...s } : x)) });

  const save = async () => {
    const clean = { ...day, segments: day.segments.filter((s) => s.hours > 0), start: day.status === 'worked' ? (day.start ?? null) : null, end: day.status === 'worked' ? (day.end ?? null) : null };
    await setWorkDay(clean);
    onClose();
  };

  return (
    <Sheet
      title={overnight ? `${fmtDay(date)} Night Shift` : fmtDay(date)}
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
              Back to Normal
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary" onClick={save}>
            Save Day
          </button>
        </>
      }
    >
      <div className="col gap-l">
        {!scheduled && <div className="badge">Not a usual workday: hours here are extra</div>}
        <Segmented value={day.status} options={STATUS} onChange={(v) => setDay({ ...newWorkDay(date, v, pay), note: day.note, segments: v === 'worked' ? day.segments.length ? day.segments : newWorkDay(date, 'worked', pay).segments : [] })} />

        {autoHoliday && (
          <div className="badge good" style={{ whiteSpace: 'normal' }}>
            {autoHoliday.name}: {pay.holidays.rule === 'shiftStart' ? 'this whole shift pays' : `hours worked on ${fmtDay(holToday ? date : addDays(date, 1))} pay`} {pay.holidayMultiplier}×
          </div>
        )}

        {day.status === 'worked' && overnight && (
          <div className="form-grid two">
            <Field label="Started">
              <input className="input" type="time" value={start} onChange={(e) => e.target.value && setTimes(e.target.value, end)} />
            </Field>
            <Field label="Ended">
              <input className="input" type="time" value={end} onChange={(e) => e.target.value && setTimes(start, e.target.value)} />
            </Field>
          </div>
        )}

        {day.status === 'worked' && (
          <div className="col">
            {day.segments.map((s, i) => (
              <div key={i} className="card tint" style={{ padding: 12 }}>
                <div className="form-grid two">
                  <Field label="Hours">
                    <NumberInput value={s.hours} onChange={(v) => setSeg(i, { hours: Math.max(0, v ?? 0) })} suffix="h" ariaLabel="Hours" />
                  </Field>
                  <Field label="Pay Rate">
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
                    <Field label="Custom Hourly Rate">
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
              <Plus /> Split the Day Across Another Rate
            </button>
            {!autoHoliday && (
              <ToggleRow
                title="Holiday Pay for This Shift"
                hint={`For a holiday not on your list: paid ${pay.holidayMultiplier}×`}
                on={!!day.workedHoliday}
                onChange={(v) => setDay({ ...day, workedHoliday: v })}
              />
            )}
          </div>
        )}

        {day.status === 'holiday' && <p className="small ink2" style={{ margin: 0 }}>A paid day off for a holiday, at your base rate. If you worked it, choose Worked instead: holiday pay is added on top.</p>}
        {(day.status === 'pto' || day.status === 'sick' || day.status === 'holiday') && (
          <Field label="Paid Hours" hint="Paid at your base rate">
            <NumberInput value={day.paidHours} onChange={(v) => setDay({ ...day, paidHours: Math.max(0, v ?? 0) })} suffix="h" />
          </Field>
        )}

        {day.status === 'missed' && (
          <p className="ink2">
            {overnight
              ? `An unpaid shift. Pebbles takes ${sp.pre} h off ${fmtDay(date)} and ${sp.post} h off ${fmtDay(addDays(date, 1))}, each on the paycheck that day belongs to.`
              : 'An unpaid day. Pebbles subtracts it from your base pay.'}
          </p>
        )}

        <Field label="Note (Optional)">
          <TextInput value={day.note} onChange={(v) => setDay({ ...day, note: v })} placeholder="e.g. covered for Sam, dentist" />
        </Field>

        <div className="card tint row between" style={{ padding: 14 }}>
          <div>
            <div className="small muted">This day pays</div>
            <div className="big-number num">{usd(dayPay)}</div>
            {autoPremium > 0 && <div className="tiny good">Includes {usd(autoPremium)} holiday pay</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">vs a normal day</div>
            <div className={`strong num ${dayPay - normal >= 0 ? 'good' : 'bad'}`}>{signedUsd(dayPay - normal)}</div>
          </div>
        </div>
        {overnight && preview.workedHours > 0 && (
          <p className="small ink2">
            {Math.round(preview.workedHours * share * 100) / 100} h count on {fmtDay(date)} and {Math.round(preview.workedHours * (1 - share) * 100) / 100} h on {fmtDay(addDays(date, 1))}.
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
  return <GemIcon gem={r?.gem ?? 'amethyst'} size={12} title={r?.name ?? 'Custom Rate'} />;
}
