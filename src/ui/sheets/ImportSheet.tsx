import { useRef, useState } from 'react';
import { FileText, Upload, X, ArrowLeftRight } from 'lucide-react';
import { Field, Segmented, Sheet, TextInput, useToast, CategoryIcon } from '../components';
import { applyCsvMapping, detectFormat, parseCsv, parseOfx, parsePdfLines, type CsvMapping, type ParsedTxn, type ParseResult } from '../../core/statements';
import { categorize, categoryOf } from '../../core/categories';
import { fmtShort } from '../../core/dates';
import { usd } from '../../core/money';
import { ensureAccount, importTransactions } from '../../data/actions';
import type { AppData } from '../../data/useData';
import type { Account } from '../../core/types';

interface Loaded {
  name: string;
  result: ParseResult;
  txns: ParsedTxn[];
}

export function ImportSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Loaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountId, setAccountId] = useState<string>(data.accounts[0]?.id ?? 'new');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Account['type']>('checking');

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError('');
    const out: Loaded[] = [];
    for (const f of Array.from(list)) {
      try {
        let result: ParseResult;
        if (f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf') {
          const { pdfToLines } = await import('../pdfText');
          result = parsePdfLines(await pdfToLines(f));
        } else {
          const text = await f.text();
          const fmt = detectFormat(f.name, text);
          result = fmt === 'ofx' ? parseOfx(text) : parseCsv(text);
        }
        out.push({ name: f.name, result, txns: result.transactions });
        if (result.accountHint && !newName) setNewName(result.accountHint);
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setFiles((cur) => [...cur, ...out]);
    if (!data.accounts.length) setAccountId('new');
    setBusy(false);
  };

  const remap = (i: number, m: CsvMapping) => {
    setFiles((cur) =>
      cur.map((f, k) => {
        if (k !== i || !f.result.csv) return f;
        const { txns } = applyCsvMapping(f.result.csv.rows, m);
        return { ...f, txns, result: { ...f.result, csv: { ...f.result.csv, mapping: m } } };
      }),
    );
  };

  const flip = (i: number) => {
    setFiles((cur) =>
      cur.map((f, k) => {
        if (k !== i) return f;
        if (f.result.csv) {
          const m = { ...f.result.csv.mapping, flip: !f.result.csv.mapping.flip };
          const { txns } = applyCsvMapping(f.result.csv.rows, m);
          return { ...f, txns, result: { ...f.result, csv: { ...f.result.csv, mapping: m } } };
        }
        return { ...f, txns: f.txns.map((t) => ({ ...t, amount: -t.amount })) };
      }),
    );
  };

  const removeRow = (fi: number, ti: number) => setFiles((cur) => cur.map((f, k) => (k === fi ? { ...f, txns: f.txns.filter((_, j) => j !== ti) } : f)));

  const total = files.reduce((s, f) => s + f.txns.length, 0);

  const doImport = async () => {
    setBusy(true);
    try {
      const acct = accountId === 'new' ? await ensureAccount(newName.trim() || 'Checking', newType) : data.accounts.find((a) => a.id === accountId)!;
      let added = 0;
      let dupes = 0;
      for (const f of files) {
        const r = await importTransactions(acct.id, f.txns, f.name);
        added += r.added;
        dupes += r.duplicates;
      }
      toast(`Added ${added} transaction${added === 1 ? '' : 's'}${dupes ? ` · ${dupes} already imported` : ''}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Import statements"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!total || busy || (accountId === 'new' && !newName.trim())} onClick={doImport}>
            Import {total || ''} transaction{total === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".csv,.ofx,.qfx,.qbo,.pdf,.txt,text/csv,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = '';
          }}
        />
        <button className="card tint" style={{ border: '1.5px dashed var(--line-2)', cursor: 'pointer', textAlign: 'center', width: '100%' }} onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload style={{ width: 28, height: 28, color: 'var(--moss)' }} />
          <div className="strong" style={{ marginTop: 6 }}>
            {busy ? 'Reading…' : files.length ? 'Add more files' : 'Choose bank statement files'}
          </div>
          <div className="small muted">CSV, QFX/OFX or PDF · download them from your bank’s website or app</div>
        </button>
        {error && <p className="bad small">{error}</p>}

        {files.length > 0 && (
          <div className="form-grid two">
            <Field label="Which account is this?">
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="new">+ New account…</option>
              </select>
            </Field>
            {accountId === 'new' && (
              <Field label="Account name">
                <TextInput value={newName} onChange={setNewName} placeholder="e.g. Ent Checking, Visa card" />
              </Field>
            )}
            {accountId === 'new' && (
              <Field label="Type">
                <Segmented
                  value={newType}
                  options={[
                    { value: 'checking', label: 'Checking' },
                    { value: 'savings', label: 'Savings' },
                    { value: 'credit', label: 'Credit card' },
                  ]}
                  onChange={setNewType}
                />
              </Field>
            )}
          </div>
        )}

        {files.map((f, fi) => {
          const dates = f.txns.map((t) => t.date).sort();
          const inSum = f.txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
          const outSum = -f.txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
          return (
            <div key={fi} className="card flat">
              <div className="row between wrap">
                <div className="row">
                  <FileText size={18} />
                  <div>
                    <div className="strong">{f.name}</div>
                    <div className="tiny muted">
                      {f.result.format.toUpperCase()} · {f.txns.length} transactions
                      {dates.length ? ` · ${fmtShort(dates[0])} – ${fmtShort(dates[dates.length - 1])}` : ''} · in {usd(inSum, true)} · out {usd(outSum, true)}
                    </div>
                  </div>
                </div>
                <div className="row">
                  <button className="btn small" onClick={() => flip(fi)} title="Swap money in and money out">
                    <ArrowLeftRight /> Flip signs
                  </button>
                  <button className="icon-btn" aria-label="Remove file" onClick={() => setFiles(files.filter((_, k) => k !== fi))}>
                    <X />
                  </button>
                </div>
              </div>
              {f.result.warnings.map((w) => (
                <p key={w} className="small warn mt">
                  {w}
                </p>
              ))}
              {f.result.csv && <MappingEditor headers={f.result.csv.headers} mapping={f.result.csv.mapping} onChange={(m) => remap(fi, m)} />}
              <div className="scroll-x mt" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th className="r">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {f.txns.slice(0, 200).map((t, ti) => {
                      const cat = categorize(t.description, t.amount, data.rules);
                      return (
                        <tr key={ti}>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>
                            {fmtShort(t.date)}
                          </td>
                          <td>{t.description}</td>
                          <td>
                            <span className="row gap-s" style={{ whiteSpace: 'nowrap' }}>
                              <CategoryIcon id={cat} size={22} />
                              {categoryOf(cat).name}
                            </span>
                          </td>
                          <td className={`r num ${t.amount > 0 ? 'good' : ''}`}>{usd(t.amount)}</td>
                          <td>
                            <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Skip this row" onClick={() => removeRow(fi, ti)}>
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {f.txns.length > 200 && <p className="tiny muted mt">…and {f.txns.length - 200} more</p>}
              </div>
            </div>
          );
        })}
        {!files.length && (
          <div className="small ink2">
            <p>
              <strong>Tip:</strong> CSV or QFX downloads are the most accurate. Look for “Download transactions” or “Export” in your bank’s website. PDFs work too; just check the preview.
            </p>
            <p className="mt">Your statements never leave your devices. They sync only to your own computer over your home Wi-Fi.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function MappingEditor({ headers, mapping, onChange }: { headers: string[]; mapping: CsvMapping; onChange: (m: CsvMapping) => void }) {
  const [open, setOpen] = useState(mapping.date < 0);
  const opt = (v: number | null, key: keyof CsvMapping, allowNone = false) => (
    <select className="input" value={v ?? -1} onChange={(e) => onChange({ ...mapping, [key]: Number(e.target.value) < 0 ? (allowNone ? null : -1) : Number(e.target.value) })}>
      {allowNone && <option value={-1}>—</option>}
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {h}
        </option>
      ))}
    </select>
  );
  if (!open)
    return (
      <button className="btn ghost small mt" onClick={() => setOpen(true)}>
        Columns look wrong?
      </button>
    );
  return (
    <div className="form-grid two mt">
      <Field label="Date column">{opt(mapping.date, 'date')}</Field>
      <Field label="Description column">{opt(mapping.description, 'description')}</Field>
      <Field label="Amount column">{opt(mapping.amount, 'amount', true)}</Field>
      <Field label="Or: money out / money in">
        <div className="row">
          {opt(mapping.debit, 'debit', true)}
          {opt(mapping.credit, 'credit', true)}
        </div>
      </Field>
    </div>
  );
}
