import { useRef, useState } from 'react';
import { FileText, TriangleAlert } from 'lucide-react';
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
  federal: 'Federal income tax',
  social_security: 'Social Security',
  medicare: 'Medicare',
  state: 'State income tax',
  famli: 'Colorado FAMLI',
  local: 'Local tax',
  pretax: 'Before-tax deduction',
  posttax: 'After-tax deduction',
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

  const read = async (file: File) => {
    setError('');
    setProgress('Reading…');
    try {
      const { lines } = await linesFromFile(file, (p, st) => setProgress(st.includes('recogniz') ? `Reading the stub… ${Math.round(p * 100)}%` : 'Getting the reader ready…'));
      const known = [data.settings.pay.baseRate, ...data.rates.map((r) => r.rate)];
      setStub(parsePaystub(lines, known));
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.');
    } finally {
      setProgress(null);
    }
  };

  // compare with Pebbles' estimate for the same pay period
  const ref = stub?.periodStart ?? stub?.payDate ?? null;
  const period = ref ? periodContaining(data.settings.pay, ref) : null;
  const est = period ? estimatePaycheck(period, data.settings, data.rates, data.workdays, data.rulesFile) : null;
  const baseHours = stub?.hours.find((h) => /reg/i.test(h.label) && h.rate);
  const newRate = baseHours?.rate && Math.abs(baseHours.rate - data.settings.pay.baseRate) > 0.005 ? baseHours.rate : null;
  const setLine = (i: number, patch: Partial<PaystubLine>) => stub && setStub({ ...stub, lines: stub.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const ded = stub ? deductionsFromStub(stub) : [];

  return (
    <Sheet
      title="Upload a pay stub"
      wide
      onClose={onClose}
      footer={
        stub ? (
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
              Use these numbers
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf,image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
          e.target.value = '';
        }}
      />
      {!stub ? (
        <div className="col gap-l">
          <button className="card tint" style={{ border: '1.5px dashed var(--line-2)', cursor: 'pointer', textAlign: 'center', width: '100%' }} onClick={() => fileRef.current?.click()} disabled={!!progress}>
            <FileText style={{ width: 28, height: 28, color: 'var(--moss)' }} />
            <div className="strong" style={{ marginTop: 6 }}>
              {progress ?? 'Choose your pay stub'}
            </div>
            <div className="small muted">PDF from your payroll site works best; a clear photo works too. Read right on your device.</div>
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
            <Field label="Gross pay">
              <NumberInput value={stub.gross} allowEmpty onChange={(v) => setStub({ ...stub, gross: v })} prefix="$" />
            </Field>
            <Field label="Net pay (take-home)">
              <NumberInput value={stub.net} allowEmpty onChange={(v) => setStub({ ...stub, net: v })} prefix="$" />
            </Field>
            <Field label="Pay date">
              <input className="input" type="date" value={stub.payDate ?? ''} onChange={(e) => setStub({ ...stub, payDate: e.target.value || null })} />
            </Field>
            <Field label="Period start">
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
                  <th className="r">This check</th>
                  <th className="r">Pebbles estimated</th>
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
            title={`Copy ${ded.length} deduction${ded.length === 1 ? '' : 's'} into Pebbles`}
            hint={ded.map((d) => `${d.name} ${d.mode === 'percent' ? `${d.amount}%` : usd(d.amount)}`).join(' · ') || 'None found on this stub'}
            on={applyDeductions && ded.length > 0}
            onChange={setApplyDeductions}
          />
          <ToggleRow title="Record this paycheck" hint="Used to fine-tune future estimates" on={recordPaycheck} onChange={setRecordPaycheck} />
          {newRate && <ToggleRow title={`Update your base rate to ${usd(newRate)}`} hint={`Pebbles has ${usd(data.settings.pay.baseRate)}`} on={useRate} onChange={setUseRate} />}
        </div>
      )}
    </Sheet>
  );
}
