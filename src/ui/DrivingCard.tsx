import { useState } from 'react';
import { Car, Gauge, Plus, Trash2 } from 'lucide-react';
import { Field, NumberInput, Sheet, ToggleRow, useConfirm, useToast } from './components';
import { fillupMpg, monthlyFuelCost, trustworthy } from '../core/driving';
import { fmtShort, today, addDays } from '../core/dates';
import { uid, usd } from '../core/money';
import { store } from '../data/store';
import { updateTransaction } from '../data/actions';
import type { AppData } from '../data/useData';
import type { DriveEntry } from '../core/types';

const mi = (n: number) => `${Math.round(n).toLocaleString()} mi`;

/** Your car: odometer readings → how much you drive, your real mpg, and what gas costs a month. */
export function DrivingCard({ data }: { data: AppData }) {
  const [logging, setLogging] = useState(false);
  const [history, setHistory] = useState(false);
  const s = data.driving;
  // what you last paid: a fill-up you logged, a gas receipt or price you entered, else the Colorado average
  const price = data.drives.find((d) => d.perGallon)?.perGallon ?? data.gasPrices.find((g) => g.source !== 'google')?.perGallon ?? data.market?.gas?.price ?? null;
  const used = Boolean(trustworthy(s));
  const mpg = s?.mpg ?? data.settings.household.vehicleMpg;
  const cost = s && s.milesPerMonth && mpg && price ? monthlyFuelCost(s.milesPerMonth, mpg, price) : null;
  const max = Math.max(1, ...(s?.byWeekday.map((d) => d.miles) ?? [1]));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="eyebrow row gap-s">
            <Car size={14} /> Your Driving
          </div>
          <div className="small muted">Log the odometer when you get in the car; add gallons when you fill up.</div>
        </div>
        <button className="btn primary small" onClick={() => setLogging(true)}>
          <Gauge /> Log
        </button>
      </div>

      {!s || s.readings < 2 ? (
        <p className="small ink2" style={{ margin: 0 }}>
          {s ? `Last reading: ${mi(s.lastOdometer ?? 0)} on ${fmtShort(s.lastDate!)}. ` : ''}
          After a few readings Pebbles shows how far you drive, your real mpg, and what gas costs you a month. After two weeks it replaces the guess in your budget.
        </p>
      ) : (
        <>
          <div className="grid three">
            <div>
              <div className="small muted">Gas a month</div>
              <div className="big-number">{cost != null ? usd(cost, true) : '—'}</div>
              <div className="tiny muted">{price ? `at ${usd(price)}/gal` : 'needs a gas price'}</div>
            </div>
            <div>
              <div className="small muted">You drive</div>
              <div className="big-number">{mi(s.milesPerMonth)}</div>
              <div className="tiny muted">a month · {s.milesPerDay.toFixed(1)} a day</div>
            </div>
            <div>
              <div className="small muted">Mileage</div>
              <div className="big-number">{mpg ? `${mpg} mpg` : '—'}</div>
              <div className="tiny muted">
                {s.mpgFrom === 'fillups' ? `from ${s.fillups} fill-up${s.fillups === 1 ? '' : 's'}` : s.mpgFrom === 'dash' ? 'from your dash' : 'from Settings until you log a fill-up'}
              </div>
            </div>
          </div>
          {(s.work || s.off) && (
            <div className="row wrap small ink2 mt-s" style={{ gap: 14 }}>
              {s.work && <span>Work days: about {mi(s.work.perDay)}</span>}
              {s.off && <span>Days off: about {mi(s.off.perDay)}</span>}
            </div>
          )}
          <div className="drive-week mt-s" aria-label="Average miles by day of the week">
            {s.byWeekday.map((d) => (
              <div key={d.day} className="drive-day">
                <div className="drive-bar" style={{ height: `${Math.max(3, (d.miles / max) * 46)}px` }} title={`${d.day}: ${Math.round(d.miles)} mi`} />
                <span className="tiny muted">{d.day[0]}</span>
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>
            {used
              ? 'Your budget’s gas money now comes from this log.'
              : `Your budget switches to this log after two weeks and three readings (${s.days} day${s.days === 1 ? '' : 's'}, ${s.readings} readings so far).`}
          </p>
        </>
      )}
      {data.drives.length > 0 && (
        <button className="link-btn small mt-s" onClick={() => setHistory(!history)}>
          {history ? 'Hide Readings' : `Show ${data.drives.length} Reading${data.drives.length === 1 ? '' : 's'}`}
        </button>
      )}
      {history && <DriveHistory data={data} />}
      {logging && <DriveSheet data={data} onClose={() => setLogging(false)} />}
    </div>
  );
}

function DriveHistory({ data }: { data: AppData }) {
  const ask = useConfirm();
  const list = data.drives.slice(0, 30);
  return (
    <div className="list mt-s">
      {list.map((e, i) => {
        const prev = list[i + 1];
        return (
          <div key={e.id} className="list-item small">
            <div className="grow">
              <div className="strong">{mi(e.odometer)}</div>
              <div className="tiny muted">
                {fmtShort(e.date)}
                {prev ? ` · +${mi(e.odometer - prev.odometer)}` : ''}
                {e.gallons ? ` · filled ${e.gallons} gal${e.perGallon ? ` at ${usd(e.perGallon)}` : ''}` : ''}
                {e.dashMpg ? ` · dash ${e.dashMpg} mpg` : ''}
              </div>
            </div>
            <button
              className="icon-btn"
              aria-label="Delete reading"
              onClick={async () => {
                if (await ask({ title: 'Delete this reading?', confirm: 'Delete', danger: true })) await store.remove('drives', e.id);
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DriveSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast();
  const last = data.drives[0] ?? null;
  // a gas receipt from today fills in the fill-up; gas stations rarely give one, so today's (or yesterday's) gas charge
  // from your bank fills in the total instead
  const todaysFuel = data.receipts.find((r) => r.date === data.today && r.fuel)?.fuel ?? null;
  // recent gas-station charges that aren't a logged fill-up yet: only suggestions, since a stop can be snacks, not gas
  const linked = new Set(data.drives.map((d) => d.txnId).filter(Boolean));
  const gasCharges = data.txns.filter((t) => t.amount < 0 && t.category === 'gas' && t.date >= addDays(data.today, -3) && !linked.has(t.id)).slice(0, 3);
  const [usedTxn, setUsedTxn] = useState<string | null>(null);
  const [odo, setOdo] = useState<number | null>(null);
  const [dash, setDash] = useState<number | null>(null);
  const [filled, setFilled] = useState(!!todaysFuel);
  const [gallons, setGallons] = useState<number | null>(todaysFuel?.gallons ?? null);
  const [ppg, setPpg] = useState<number | null>(todaysFuel?.perGallon ?? data.drives.find((d) => d.perGallon)?.perGallon ?? data.gasPrices.find((g) => g.source !== 'google')?.perGallon ?? null);
  // the pump shows the total and the price a gallon: gallons follow from those
  const [total, setTotal] = useState<number | null>(todaysFuel?.gallons && todaysFuel?.perGallon ? Math.round(todaysFuel.gallons * todaysFuel.perGallon * 100) / 100 : null);
  const gal = gallons ?? (total && ppg ? Math.round((total / ppg) * 1000) / 1000 : null);
  const [full, setFull] = useState(true);
  const since = odo != null && last ? odo - last.odometer : null;
  const bad = odo != null && last != null && odo < last.odometer;
  const preview = filled && gal && since && since > 0 && full && last?.gallons ? fillupMpg([last, { id: 'x', date: data.today, at: Date.now(), odometer: odo!, gallons: gal, full }]) : null;

  return (
    <Sheet
      title="Log Your Car"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!odo || bad}
          onClick={async () => {
            const e: DriveEntry = {
              id: uid('drv_'),
              date: today(),
              at: Date.now(),
              odometer: odo!,
              dashMpg: dash,
              gallons: filled ? gal : null,
              perGallon: filled ? (ppg ?? (total && gallons ? Math.round((total / gallons) * 1000) / 1000 : null)) : null,
              full: filled ? full : undefined,
              txnId: filled ? usedTxn : null,
            };
            await store.put('drives', e);
            toast(since != null && since > 0 ? `Logged · ${mi(since)} since last time` : 'Logged');
            onClose();
          }}
        >
          <Plus /> Save
        </button>
      }
    >
      <div className="col gap-l">
        <Field label="Odometer" hint={last ? `Last time: ${mi(last.odometer)} on ${fmtShort(last.date)}` : 'The total miles on your dash'}>
          <NumberInput value={odo} onChange={setOdo} allowEmpty suffix="mi" autoFocus ariaLabel="Odometer" />
        </Field>
        {since != null && since >= 0 && <div className="small ink2">{mi(since)} since your last reading.</div>}
        {bad && <div className="small bad">That’s lower than your last reading ({mi(last!.odometer)}). Check the number.</div>}
        <Field label="Average MPG on Your Dash (Optional)" hint="If your car shows one">
          <NumberInput value={dash} onChange={setDash} allowEmpty suffix="mpg" ariaLabel="Dash mpg" />
        </Field>
        {gasCharges.length > 0 && (
          <div className="coverage-math">
            <div className="small strong">Gas station charges from your bank</div>
            <div className="tiny muted" style={{ marginBottom: 4 }}>
              Was one of these a fill-up? Stops for snacks or drinks aren’t gas: mark those and they stop counting as gas.
            </div>
            {gasCharges.map((t) => (
              <div key={t.id} className="row between small" style={{ padding: '4px 0', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  {t.merchant || t.description} · {fmtShort(t.date)} · <strong>{usd(-t.amount)}</strong>
                  {-t.amount < 15 && <span className="tiny muted"> · small, maybe snacks</span>}
                </span>
                <span className="row gap-s">
                  <button
                    className={`btn small${usedTxn === t.id ? ' primary' : ''}`}
                    onClick={() => {
                      setUsedTxn(t.id);
                      setFilled(true);
                      setTotal(-t.amount);
                      setGallons(null);
                    }}
                  >
                    {usedTxn === t.id ? 'This Fill-Up' : 'Use as This Fill-Up'}
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={async () => {
                      await updateTransaction({ ...t, category: 'shopping', note: t.note || 'Gas station, not gas' });
                      if (usedTxn === t.id) setUsedTxn(null);
                      toast(`${usd(-t.amount)} at ${t.merchant || 'the gas station'} no longer counts as gas`);
                    }}
                  >
                    Not Gas
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <ToggleRow title="I Filled Up" hint="Two fill-ups in a row give your exact mpg" on={filled} onChange={setFilled} />
        {filled && (
          <>
            <div className="small ink2">From the pump: any two of these and Pebbles works out the third.</div>
            <div className="form-grid two">
              <Field label="Total Paid" hint={usedTxn ? 'From your bank; change it to just the gas if you bought other things too' : undefined}>
                <NumberInput value={total} onChange={setTotal} allowEmpty prefix="$" money ariaLabel="Total paid" />
              </Field>
              <Field label="Price per Gallon">
                <NumberInput value={ppg} onChange={setPpg} allowEmpty prefix="$" ariaLabel="Price per gallon" />
              </Field>
              <Field label="Gallons" hint={gallons == null && gal ? `About ${gal} gal` : undefined}>
                <NumberInput value={gallons} onChange={setGallons} allowEmpty ariaLabel="Gallons" />
              </Field>
            </div>
            <ToggleRow title="Filled to Full" hint="Turn off if you only put in some" on={full} onChange={setFull} />
            {todaysFuel && <div className="tiny muted">Filled in from today’s gas receipt.</div>}
            {preview && <div className="small good">That works out to {preview.mpg} mpg since your last fill-up.</div>}
          </>
        )}
      </div>
    </Sheet>
  );
}
