import { useRef, useState } from 'react';
import { Check, FileText, TriangleAlert } from 'lucide-react';
import { Field, NumberInput, Sheet, ToggleRow, useToast } from '../components';
import { parsePaystub, deductionsFromStub, type ParsedPaystub } from '../../core/paystub';
import { estimatePaycheck } from '../../core/paycheck';
import { periodContaining } from '../../core/pay';
import { signedUsd, usd } from '../../core/money';
import { fmtDay } from '../../core/dates';
import { applyPaystub } from '../../data/groceryActions';
import { linesFromFile } from '../ocr';
import type { AppData } from '../../data/useData';
import type { PaystubLine } from '../../core/types';

const KIND_LABEL: Record<PaystubLine['kind'], string> = {
  federal: 'Federal Income Tax',
  social_security: 'Social Security',
  medicare: 'Medicare',
  state: 'State Income Tax',
  famli: 'Colorado FAMLI',
  local: 'Local Tax',
  pretax: 'Before-Tax Deduction',
  posttax: 'After-Tax Deduction',
  other: 'Other',
};

/** Upload a pay stub (PDF or photo) to make Pebbles' paycheck math match your employer's exactly. */
export function PaystubSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [stub, setStub] = useState<ParsedPaystub | null>(null);
  const [applyDeductions, setApplyDeductions] = useState(true);
  const [recordPaycheck, setRecordPaycheck] = useState(true);
  const [useRate, setUseRate] = useState(true);

  const known = [data.settings.pay.baseRate, ...data.rates.map((r) => r.rate)];
  const parse = async (file: File, label = 'the stub') => {
    const { lines } = await linesFromFile(
      file,
      (p, st) => setProgress(st.includes('second') ? 'Taking a second look…' : st.includes('recogniz') ? `Reading ${label}… ${Math.round(p * 100)}%` : 'Getting the reader ready…'),
      (first) => {
        const t = parsePaystub(first, known);
        return t.gross == null || t.net == null;
      },
      'table',
    );
    return parsePaystub(lines, known);
  };
  const read = async (file: File) => {
    setError('');
    setProgress('Reading…');
    try {
      setStub(await parse(file));
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.');
    } finally {
      setProgress(null);
    }
  };

  // several stubs at once: read them one by one, then save them all together
  const [batch, setBatch] = useState<{ name: string; stub: ParsedPaystub | null; error?: string; include: boolean; duplicate?: boolean }[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const readBatch = async (files: File[]) => {
    setError('');
    let list = files.map((f) => ({ name: f.name, stub: null as ParsedPaystub | null, include: false, error: undefined as string | undefined, duplicate: false }));
    setBatch(list);
    for (let k = 0; k < files.length; k++) {
      try {
        const st = await parse(files[k], `stub ${k + 1} of ${files.length}`);
        const dup = data.paystubs.some((x) => x.payDate && x.payDate === st.payDate && x.net === st.net);
        list = list.map((b, j) => (j === k ? { ...b, stub: st, include: !dup && st.net != null, duplicate: dup } : b));
      } catch (e) {
        list = list.map((b, j) => (j === k ? { ...b, error: (e as Error).message || 'Couldn’t read this file.' } : b));
      }
      setBatch(list);
    }
    setProgress(null);
  };

  // compare with Pebbles' estimate for the same pay period
  const ref = stub?.periodStart ?? stub?.payDate ?? null;
  const period = ref ? periodContaining(data.settings.pay, ref) : null;
  const est = period ? estimatePaycheck(period, data.settings, data.rates, data.workdays, data.rulesFile) : null;
  const baseHours = stub?.hours.find((h) => /reg/i.test(h.label) && h.rate);
  const newRate = baseHours?.rate && Math.abs(baseHours.rate - data.settings.pay.baseRate) > 0.005 ? baseHours.rate : null;
  const setLine = (i: number, patch: Partial<PaystubLine>) => stub && setStub({ ...stub, lines: stub.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const ded = stub ? deductionsFromStub(stub) : [];

  if (batch && editing == null) {
    const reading = batch.some((b) => !b.stub && !b.error);
    const ready = batch.filter((b) => b.include && b.stub && b.stub.net != null);
    return (
      <Sheet
        title={`${batch.length} Pay Stubs`}
        wide
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={reading || !ready.length || saving}
              onClick={async () => {
                setSaving(true);
                // oldest first; your deductions and rate come only from the newest one
                const sorted = [...ready].sort((a, b) => (a.stub!.payDate ?? '').localeCompare(b.stub!.payDate ?? ''));
                const notes: string[] = [];
                for (const [i, b] of sorted.entries()) {
                  const newest = i === sorted.length - 1;
                  const { warnings: _w, ...st } = b.stub!;
                  const rate = st.hours.find((h) => /reg/i.test(h.label) && h.rate)?.rate ?? null;
                  const done = await applyPaystub(st, { applyDeductions: newest, recordPaycheck: true, updateBaseRate: newest && rate && Math.abs(rate - data.settings.pay.baseRate) > 0.005 ? rate : null });
                  if (newest) notes.push(...done.filter((d) => !/Recorded/.test(d)));
                }
                setSaving(false);
                toast(`Saved ${sorted.length} pay stub${sorted.length === 1 ? '' : 's'}${notes.length ? ` · ${notes[0]}` : ''}`);
                onClose();
              }}
            >
              {reading ? (progress ?? 'Reading…') : saving ? 'Saving…' : `Save ${ready.length} Stub${ready.length === 1 ? '' : 's'}`}
            </button>
          </>
        }
      >
        <div className="col gap-l">
          <p className="small ink2" style={{ margin: 0 }}>
            Each one records its paycheck. Your deductions and pay rate are taken from the newest stub only, so older ones can’t undo a raise. Tap one to check it.
          </p>
          <div className="list">
            {batch.map((b, i) => (
              <div key={i} className="list-item" style={{ alignItems: 'flex-start', gap: 10, opacity: b.include ? 1 : 0.6 }}>
                <button className={`check-btn${b.include ? ' on' : ''}`} disabled={!b.stub} aria-label={b.include ? 'Leave this one out' : 'Include this one'} onClick={() => setBatch(batch.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))}>
                  {b.include && <Check size={16} />}
                </button>
                <button
                  className="grow"
                  style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: b.stub ? 'pointer' : 'default', minWidth: 0 }}
                  disabled={!b.stub}
                  onClick={() => {
                    setStub(b.stub);
                    setEditing(i);
                  }}
                >
                  {b.stub ? (
                    <>
                      <div className="strong small">Paid {b.stub.payDate ? fmtDay(b.stub.payDate) : '(date not found)'}</div>
                      <div className="tiny muted">
                        {b.stub.gross != null ? `${usd(b.stub.gross)} gross` : 'gross not found'} · {b.stub.net != null ? `${usd(b.stub.net)} take-home` : 'take-home not found'}
                      </div>
                      {b.duplicate && <div className="tiny warn">Already saved. Left out.</div>}
                      {b.stub.warnings.slice(0, 2).map((w) => (
                        <div key={w} className="tiny warn">
                          {w}
                        </div>
                      ))}
                      <div className="tiny muted ellipsis">{b.name}</div>
                    </>
                  ) : (
                    <>
                      <div className="strong small ellipsis">{b.name}</div>
                      <div className={`tiny ${b.error ? 'bad' : 'muted'}`}>{b.error ?? progress ?? 'Waiting…'}</div>
                    </>
                  )}
                </button>
                {b.stub && <span className="tiny muted">Check ›</span>}
              </div>
            ))}
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title="Upload a Pay Stub"
      wide
      onClose={onClose}
      footer={
        stub && batch && editing != null ? (
          <button
            className="btn primary"
            style={{ flex: 1 }}
            onClick={() => {
              setBatch(batch.map((b, j) => (j === editing ? { ...b, stub, include: stub.net != null } : b)));
              setStub(null);
              setEditing(null);
            }}
          >
            Done, Back to the List
          </button>
        ) : stub ? (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={stub.net == null}
              onClick={async () => {
                const { warnings: _w, ...s } = stub;
                const done = await applyPaystub(s, { applyDeductions, recordPaycheck, updateBaseRate: useRate ? newRate : null });
                toast(done.length ? done[0] : 'Pay stub saved');
                onClose();
              }}
            >
              Use These Numbers
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf,image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 1) void readBatch(files);
          else if (files[0]) void read(files[0]);
          e.target.value = '';
        }}
      />
      {!stub ? (
        <div className="col gap-l">
          <button className="card tint" style={{ border: '1.5px dashed var(--line-2)', cursor: 'pointer', textAlign: 'center', width: '100%' }} onClick={() => fileRef.current?.click()} disabled={!!progress}>
            <FileText style={{ width: 28, height: 28, color: 'var(--moss)' }} />
            <div className="strong" style={{ marginTop: 6 }}>
              {progress ?? 'Choose your pay stubs'}
            </div>
            <div className="small muted">One or several at once. PDFs from your payroll site work best; clear photos work too. Read right on your device.</div>
          </button>
          {error && <p className="small bad">{error}</p>}
          <p className="small ink2">Pebbles copies your retirement and insurance deductions, checks your rate, records this paycheck, and fine-tunes every future estimate to match.</p>
        </div>
      ) : (
        <div className="col gap-l">
          {stub.warnings.map((w) => (
            <div key={w} className="row small warn" style={{ alignItems: 'flex-start' }}>
              <TriangleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {w}
            </div>
          ))}
          <div className="form-grid two">
            <Field label="Gross Pay">
              <NumberInput value={stub.gross} allowEmpty onChange={(v) => setStub({ ...stub, gross: v })} prefix="$" />
            </Field>
            <Field label="Net Pay (Take-Home)">
              <NumberInput value={stub.net} allowEmpty onChange={(v) => setStub({ ...stub, net: v })} prefix="$" />
            </Field>
            <Field label="Pay Date">
              <input className="input" type="date" value={stub.payDate ?? ''} onChange={(e) => setStub({ ...stub, payDate: e.target.value || null })} />
            </Field>
            <Field label="Period Start">
              <input className="input" type="date" value={stub.periodStart ?? ''} onChange={(e) => setStub({ ...stub, periodStart: e.target.value || null })} />
            </Field>
          </div>
          {stub.hours.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>
                Hours
              </div>
              {stub.hours.map((h, i) => (
                <div key={i} className="row between small" style={{ padding: '4px 0' }}>
                  <span>{h.label}</span>
                  <span className="num">
                    {h.hours ? `${h.hours} h` : ''} {h.rate ? `× ${usd(h.rate)}` : ''} = {usd(h.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="r">This Check</th>
                  <th className="r">Pebbles Estimated</th>
                </tr>
              </thead>
              <tbody>
                {stub.lines.map((l, i) => {
                  const mine = est?.withholding.taxes.find((t) => t.key === l.kind)?.amount;
                  return (
                    <tr key={i} style={l.lowConfidence ? { background: 'var(--warn-soft)' } : undefined}>
                      <td>
                        {l.label}
                        <div className="tiny muted">{KIND_LABEL[l.kind]}</div>
                      </td>
                      <td className="r" style={{ width: 130 }}>
                        <NumberInput value={l.current} onChange={(v) => setLine(i, { current: v ?? 0, lowConfidence: false })} prefix="$" ariaLabel={l.label} />
                      </td>
                      <td className="r num">{mine != null ? usd(mine) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {est && stub.net != null && (
            <p className="small ink2">
              For the {fmtDay(est.period.payday)} paycheck, Pebbles estimated {usd(est.net)}; your stub says {usd(stub.net)} ({signedUsd(stub.net - est.net)}).
            </p>
          )}
          <ToggleRow
            title={`Copy ${ded.length} Deduction${ded.length === 1 ? '' : 's'} Into Pebbles`}
            hint={ded.map((d) => `${d.name} ${d.mode === 'percent' ? `${d.amount}%` : usd(d.amount)}`).join(' · ') || 'None found on this stub'}
            on={applyDeductions && ded.length > 0}
            onChange={setApplyDeductions}
          />
          <ToggleRow title="Record This Paycheck" hint="Used to fine-tune future estimates" on={recordPaycheck} onChange={setRecordPaycheck} />
          {newRate && <ToggleRow title={`Update Your Base Rate to ${usd(newRate)}`} hint={`Pebbles has ${usd(data.settings.pay.baseRate)}`} on={useRate} onChange={setUseRate} />}
        </div>
      )}
    </Sheet>
  );
}
