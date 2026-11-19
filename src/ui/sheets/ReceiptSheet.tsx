import { useRef, useState } from 'react';
import { Camera, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Field, NumberInput, Sheet, useToast } from '../components';
import { parseReceipt, type ParsedReceipt } from '../../core/receipts';
import { cleanItemName, deptFor, DEPT_LABEL } from '../../core/groceries';
import { round2, usd } from '../../core/money';
import { rememberItem, saveReceipt } from '../../data/groceryActions';
import { linesFromFile } from '../ocr';
import type { AppData } from '../../data/useData';
import type { GroceryDept, Receipt, ReceiptItem } from '../../core/types';

const STORES = ['King Soopers', 'Walmart', 'Safeway', 'Sprouts', 'Costco', 'Target', 'Aldi', 'Natural Grocers', 'Whole Foods', "Sam's Club", 'Circle K', '7-Eleven', "Loaf 'N Jug", 'Maverik', 'Murphy USA', 'Conoco', 'Shell', 'Walgreens', 'CVS'];

/** Scan or edit a grocery receipt. Anything Pebbles wasn't sure about is highlighted to check. */
export function ReceiptSheet({ data, existing, onClose }: { data: AppData; existing?: Receipt; onClose: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState<Receipt['source']>(existing?.source ?? 'photo');
  const [r, setR] = useState<(ParsedReceipt & { id?: string }) | null>(
    existing ? { ...existing, warnings: [], itemsTotal: round2(existing.items.reduce((s, i) => s + i.price, 0)) } : null,
  );

  const read = async (file: File) => {
    setError('');
    setProgress('Reading…');
    try {
      const { lines, source: src } = await linesFromFile(file, (p, status) =>
        setProgress(status.includes('recogniz') ? `Reading the receipt… ${Math.round(p * 100)}%` : 'Getting the reader ready…'),
      );
      setSource(src);
      setR(parseReceipt(lines, data.itemRules, data.today));
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.');
    } finally {
      setProgress(null);
    }
  };

  const setItem = (i: number, patch: Partial<ReceiptItem>) => r && setR({ ...r, items: r.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const itemsTotal = r ? round2(r.items.reduce((s, i) => s + i.price, 0)) : 0;
  const reference = r ? (r.subtotal ?? (r.total != null && r.tax != null ? round2(r.total - r.tax) : null)) : null;
  const mismatch = reference != null && Math.abs(reference - itemsTotal) > 0.05;

  return (
    <Sheet
      title={existing ? 'Receipt' : 'Add a receipt'}
      wide
      onClose={onClose}
      footer={
        r ? (
          <>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!r.items.length}
              onClick={async () => {
                const { warnings: _w, itemsTotal: _t, ...rest } = r;
                const res = await saveReceipt({ ...rest, store: rest.store.trim() || 'Store', items: r.items.map(({ lowConfidence: _l, ...i }) => i), source, id: existing?.id });
                toast(`Saved ${r.items.length} items from ${r.store}${res.restocked ? ` · restocked ${res.restocked} pantry item${res.restocked === 1 ? '' : 's'}` : ''}${r.fuel ? ` · gas ${'$' + r.fuel.perGallon.toFixed(3)}/gal logged` : ''}`);
                onClose();
              }}
            >
              Save receipt
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.pdf,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
          e.target.value = '';
        }}
      />
      {!r && (
        <div className="col gap-l">
          <button className="card tint" style={{ border: '1.5px dashed var(--line-2)', cursor: 'pointer', textAlign: 'center', width: '100%' }} onClick={() => fileRef.current?.click()} disabled={!!progress}>
            <Camera style={{ width: 28, height: 28, color: 'var(--moss)' }} />
            <div className="strong" style={{ marginTop: 6 }}>
              {progress ?? 'Take a photo or choose a receipt'}
            </div>
            <div className="small muted">Photo, PDF, or a digital receipt. Read right on your device.</div>
          </button>
          {error && <p className="small bad">{error}</p>}
          <p className="small ink2">For the best read: lay the receipt flat, fill the frame, and use good light. Long receipts can be photographed in two parts and saved separately.</p>
          <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setR({ store: 'King Soopers', date: data.today, items: [], subtotal: null, tax: null, total: null, savings: null, warnings: [], itemsTotal: 0 })}>
            Or type it in by hand
          </button>
        </div>
      )}
      {r && (
        <div className="col gap-l">
          {[...r.warnings.filter((w) => !w.includes('add up')), ...(mismatch ? [`Items add up to ${usd(itemsTotal)} but the receipt says ${usd(reference as number)}. Check the highlighted lines.`] : [])].map((w) => (
            <div key={w} className="row small warn" style={{ alignItems: 'flex-start' }}>
              <TriangleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {w}
            </div>
          ))}
          <div className="form-grid two">
            <Field label="Store">
              <input className="input" list="pebbles-stores" value={r.store} onChange={(e) => setR({ ...r, store: e.target.value })} placeholder="Store name" />
              <datalist id="pebbles-stores">
                {STORES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Date">
              <input className="input" type="date" value={r.date} onChange={(e) => setR({ ...r, date: e.target.value })} />
            </Field>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Aisle</th>
                  <th className="r">Price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.items.map((it, i) => {
                  const flag = it.lowConfidence || (mismatch && /\d/.test(it.name));
                  return (
                    <tr key={i} style={flag ? { background: 'var(--warn-soft)' } : undefined}>
                      <td style={{ minWidth: 150 }}>
                        <input
                          className="input"
                          style={{ minHeight: 34, padding: '4px 8px' }}
                          value={it.name}
                          onChange={(e) => {
                            const c = cleanItemName(e.target.value);
                            setItem(i, { name: e.target.value, key: c.key || it.key, dept: deptFor(e.target.value, c.key, data.itemRules) });
                          }}
                        />
                        {flag && <div className="tiny warn">Check this line: “{it.raw}”</div>}
                      </td>
                      <td>
                        <select
                          className="input"
                          style={{ minHeight: 34, padding: '4px 8px' }}
                          value={it.dept}
                          onChange={(e) => {
                            const dept = e.target.value as GroceryDept;
                            setItem(i, { dept });
                            void rememberItem(it, dept);
                          }}
                        >
                          {Object.entries(DEPT_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="r" style={{ width: 110 }}>
                        <NumberInput value={it.price} onChange={(v) => setItem(i, { price: v ?? 0, lowConfidence: false })} prefix="$" ariaLabel="Price" />
                      </td>
                      <td>
                        <button className="icon-btn" aria-label="Remove item" onClick={() => setR({ ...r, items: r.items.filter((_, k) => k !== i) })}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            className="btn small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setR({ ...r, items: [...r.items, { raw: '', name: '', key: '', price: 0, qty: 1, dept: 'other', lowConfidence: true }] })}
          >
            <Plus /> Add an item
          </button>
          <div className="form-grid two">
            <Field label="Subtotal">
              <NumberInput value={r.subtotal} allowEmpty onChange={(v) => setR({ ...r, subtotal: v })} prefix="$" />
            </Field>
            <Field label="Tax">
              <NumberInput value={r.tax} allowEmpty onChange={(v) => setR({ ...r, tax: v })} prefix="$" />
            </Field>
            <Field label="Total">
              <NumberInput value={r.total} allowEmpty onChange={(v) => setR({ ...r, total: v })} prefix="$" />
            </Field>
            <Field label="Store savings">
              <NumberInput value={r.savings} allowEmpty onChange={(v) => setR({ ...r, savings: v })} prefix="$" />
            </Field>
          </div>
          <p className="small muted">
            {r.items.length} items · {usd(itemsTotal)}
            {r.tax != null ? ` + ${usd(r.tax)} tax` : ''}
          </p>
          {!existing && (
            <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current?.click()}>
              <Camera /> Read a different file
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
