import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Plus, RotateCcw, Sprout, Info } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { DayEditor } from '../sheets/DayEditor';
import { ReceiveSheet } from '../sheets/ReceiveSheet';
import { PaystubSheet } from '../sheets/PaystubSheet';
import { Field, GemIcon, NumberInput, Sheet, TextInput, useToast } from '../components';
import { periodByIndex, allRates } from '../../core/pay';
import { estimatePaycheck } from '../../core/paycheck';
import { rangeDays, fmtShort, fmtDay, dowName, dayOfWeek, diffDays, parts } from '../../core/dates';
import { signedUsd, usd, uid, num } from '../../core/money';
import { GEMS } from '../../core/categories';
import { BASE_RATE_ID } from '../../core/defaults';
import { archiveRate, clearWorkDay, saveRate } from '../../data/actions';
import { store } from '../../data/store';
import type { PayRate } from '../../core/types';

export function PaycheckScreen({ data }: { data: AppData }) {
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [rateEdit, setRateEdit] = useState<PayRate | null>(null);
  const [stubOpen, setStubOpen] = useState(false);
  const { settings } = data;
  const period = periodByIndex(settings.pay, data.upcoming.period.index + offset);
  const est = useMemo(
    () => (offset === 0 ? data.upcoming : estimatePaycheck(period, settings, data.rates, data.workdays, data.rulesFile, data.calibration)),
    [offset, data, period, settings],
  );
  const days = rangeDays(period.start, period.end);
  const record = data.paychecks.get(period.start);
  const rates = allRates(settings.pay.baseRate, data.rates);
  const g = est.gross;
  const w = est.withholding;
  const edits = days.filter((d) => data.workdays.has(d));

  const label = offset === 0 ? 'Next paycheck' : offset < 0 ? (offset === -1 ? 'Previous paycheck' : `${-offset} paychecks ago`) : offset === 1 ? 'The one after' : `${offset} paychecks ahead`;

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
            <div className="row between wrap">
              <div>
                <div className="eyebrow">Estimated take-home</div>
                <div className="hero-number">{usd(est.net)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="small muted">Gross</div>
                <div className="strong num">{usd(g.gross)}</div>
                <div className="small muted">
                  {num(g.workedHours)} h worked{g.leaveHours ? ` · ${num(g.leaveHours)} h paid leave` : ''}
                </div>
              </div>
            </div>
            {record?.received && (
              <div className="badge good mt">
                Received {usd(record.actualNet ?? 0)} ({signedUsd((record.actualNet ?? 0) - record.estimatedNet)} vs estimate)
              </div>
            )}
            <div className="row wrap mt">
              <button className="btn" onClick={() => setStubOpen(true)}>
                <FileText /> Upload pay stub
              </button>
              {diffDays(period.payday, data.today) <= 1 && (
                <button className="btn primary" onClick={() => setReceiving(true)}>
                  <Sprout /> {record?.received ? 'Edit payday split' : 'I got paid'}
                </button>
              )}
              {edits.length > 0 && (
                <button
                  className="btn"
                  onClick={async () => {
                    for (const d of edits) await clearWorkDay(d);
                    toast('Back to a normal two weeks');
                  }}
                >
                  <RotateCcw /> Reset to normal
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="eyebrow">{settings.pay.shiftStart ? 'Your shifts · tap the night a shift starts' : 'Your two weeks · tap a day to change it'}</div>
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
                  <button key={d.date} className={cls} onClick={() => setEditing(d.date)} aria-label={`${fmtDay(d.date)}: ${d.status}`}>
                    <span className="d">{parts(d.date).d}</span>
                    <span className="h">
                      {d.status === 'missed' ? 'off' : d.status === 'off' ? '–' : `${num(hrs)}h`}
                    </span>
                    {settings.pay.shiftStart && (
                      <span className="tiny muted" title="Hours counted on this calendar day">
                        {num((d as unknown as { countedHours?: number }).countedHours ?? 0)}h day
                      </span>
                    )}
                    <span className="tiny muted">
                      {d.status === 'pto' ? 'PTO' : d.status === 'sick' ? 'sick' : d.status === 'holiday' ? 'holiday' : d.status === 'worked' && d.segments.some((s) => s.rateId !== BASE_RATE_ID) ? '' : ''}
                    </span>
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
                <span className="swatch" style={{ background: 'var(--bad-soft)', border: '1px solid var(--line)', marginTop: 0 }} /> missed
              </span>
              <span className="row gap-s">
                <span className="swatch" style={{ background: 'var(--moss-soft)', border: '1px solid var(--line)', marginTop: 0 }} /> paid leave
              </span>
              <span className="row gap-s">
                <GemIcon gem="amethyst" size={12} /> different rate
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="eyebrow">Pay rates</div>
              <button className="btn small" onClick={() => setRateEdit({ id: uid('rate_'), name: '', rate: settings.pay.baseRate + 2, gem: 'amethyst' })}>
                <Plus /> Add rate
              </button>
            </div>
            <div className="list">
              {rates.map((r) => (
                <button key={r.id} className="list-item" onClick={() => (r.isBase ? toast('Change your base rate in Settings → Pay') : setRateEdit(r))}>
                  <GemIcon gem={r.gem} size={22} />
                  <div className="grow strong">{r.name}</div>
                  <div className="amount">{usd(r.rate)}/hr</div>
                </button>
              ))}
            </div>
            <p className="tiny muted mt">Pick a rate when you edit a day. Split days can mix rates.</p>
          </div>
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            How we got there
          </div>
          <Line label={`Base pay`} detail={`${num(g.scheduledHours)} h × ${usd(settings.pay.baseRate)}`} value={usd(g.basePay)} strong />
          {g.adjustments.map((a, i) => (
            <Line key={i} label={a.label} detail={a.detail} value={signedUsd(a.amount)} tone={a.amount >= 0 ? 'good' : 'bad'} indent />
          ))}
          <div className="divider" />
          <Line label="Gross pay" value={usd(g.gross)} strong />
          {w.preTax.map((d) => (
            <Line key={d.id} label={d.name} detail="before tax" value={signedUsd(-d.amount)} indent />
          ))}
          {w.taxes.map((t) => (
            <Line key={t.key} label={t.label} detail={t.detail} value={signedUsd(-t.amount)} indent />
          ))}
          {w.postTax.map((d) => (
            <Line key={d.id} label={d.name} detail="after tax" value={signedUsd(-d.amount)} indent />
          ))}
          {data.calibration !== 0 && <Line label="Matched to your real paychecks" detail="learned from recent deposits" value={signedUsd(data.calibration)} indent />}
          <div className="divider" />
          <Line label="Take-home" value={usd(est.net)} strong big />
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

      {editing && <DayEditor date={editing} data={data} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveSheet data={data} estimate={est} onClose={() => setReceiving(false)} />}
      {rateEdit && <RateSheet rate={rateEdit} onClose={() => setRateEdit(null)} />}
      {stubOpen && <PaystubSheet data={data} onClose={() => setStubOpen(false)} />}
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
  const list = [...data.paychecks.values()].filter((p) => p.received).sort((a, b) => b.payday.localeCompare(a.payday)).slice(0, 8);
  if (!list.length) return null;
  return (
    <div className="card mt">
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Recent paychecks
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
                <td className="r num">{p.actualNet != null ? usd(p.actualNet) : '–'}</td>
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
      title={exists ? 'Edit pay rate' : 'New pay rate'}
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
        <Field label="Hourly rate">
          <NumberInput value={r.rate} onChange={(v) => setR({ ...r, rate: v ?? 0 })} prefix="$" suffix="/hr" />
        </Field>
        <Field label="Gem marker">
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
