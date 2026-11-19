import { Field, NumberInput, Segmented } from './components';
import { shiftHours, shiftSplit } from '../core/pay';
import { dowName } from '../core/dates';
import { num, usd } from '../core/money';
import type { PaySettings } from '../core/types';

/** Day shifts or overnight shifts, which nights/days you start, and how hours split across midnight. */
export function ShiftSchedule({ pay, onChange }: { pay: PaySettings; onChange: (p: PaySettings) => void }) {
  const overnight = !!pay.shiftStart;
  // keep the "normal shift hours" in step with the times you enter
  const update = (p: PaySettings) => onChange(p.shiftStart ? { ...p, hoursPerDay: shiftHours({ ...p, hoursPerDay: p.hoursPerDay }) } : p);
  const sp = shiftSplit(pay);
  const perCheck = pay.workDays.length * 2 * (overnight ? shiftHours(pay) : pay.hoursPerDay);
  return (
    <div className="col gap-l">
      <Field label="Your shifts">
        <Segmented
          value={overnight ? 'night' : 'day'}
          options={[
            { value: 'day', label: 'Day shifts' },
            { value: 'night', label: 'Overnight shifts' },
          ]}
          onChange={(v) => update(v === 'night' ? { ...pay, shiftStart: pay.shiftStart ?? '21:30', shiftEnd: pay.shiftEnd ?? '06:00' } : { ...pay, shiftStart: null, shiftEnd: null, hoursPerDay: 8 })}
        />
      </Field>
      {overnight ? (
        <>
          <div className="form-grid two">
            <Field label="Shift starts">
              <input className="input" type="time" value={pay.shiftStart ?? '21:30'} onChange={(e) => e.target.value && update({ ...pay, shiftStart: e.target.value })} />
            </Field>
            <Field label="Shift ends (next morning)">
              <input className="input" type="time" value={pay.shiftEnd ?? '06:00'} onChange={(e) => e.target.value && update({ ...pay, shiftEnd: e.target.value })} />
            </Field>
          </div>
          <Field label="Unpaid break">
            <NumberInput value={pay.breakMinutes} onChange={(v) => update({ ...pay, breakMinutes: Math.max(0, Math.round(v ?? 0)) })} suffix="min" />
          </Field>
          <Field label="Break is usually">
              <Segmented
                value={pay.breakAfterMidnight ? 'after' : 'before'}
                options={[
                  { value: 'before', label: 'Before midnight' },
                  { value: 'after', label: 'After midnight' },
                ]}
                onChange={(v) => update({ ...pay, breakAfterMidnight: v === 'after' })}
              />
          </Field>
          <p className="small ink2">
            Each shift pays {num(sp.pre + sp.post)} h: <strong>{num(sp.pre)} h</strong> on the night it starts and <strong>{num(sp.post)} h</strong> the next day. Pebbles counts them on those days, the way
            payroll does, so a Saturday-night shift is split between pay periods.
          </p>
        </>
      ) : (
        <Field label="Hours in a normal day">
          <NumberInput value={pay.hoursPerDay} onChange={(v) => update({ ...pay, hoursPerDay: v ?? 8 })} suffix="h" />
        </Field>
      )}
      <Field
        label={overnight ? 'Nights your shift starts' : 'Days you normally work'}
        hint={`${num(perCheck)} hours per paycheck = ${usd(perCheck * pay.baseRate)} base pay`}
      >
        <div className="row wrap" style={{ gap: 6 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <button
              key={d}
              className={`chip${pay.workDays.includes(d) ? ' on' : ''}`}
              onClick={() => update({ ...pay, workDays: pay.workDays.includes(d) ? pay.workDays.filter((y) => y !== d) : [...pay.workDays, d].sort() })}
            >
              {dowName(d)}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
