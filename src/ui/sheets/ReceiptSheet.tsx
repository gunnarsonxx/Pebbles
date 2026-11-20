import { useRef, useState } from 'react';
import { Camera, Check, ImagePlus, Minus, Plus, Tag, Trash2, TriangleAlert } from 'lucide-react';
import { Field, NumberInput, Sheet, useConfirm, useToast } from '../components';
import { mergeReceipts, parseReceipt, type ParsedReceipt } from '../../core/receipts';
import { cleanItemName, deptFor, describeItem, packOf, plainNameFor } from '../../core/groceries';
import { round2, usd } from '../../core/money';
import { deleteReceipt, saveReceipt } from '../../data/groceryActions';
import { linesFromFile } from '../ocr';
import { KitchenPickSheet } from './KitchenSheets';
import { isRecent, pickableItems } from '../../core/kitchen';
import { fmtShort } from '../../core/dates';
import type { AppData } from '../../data/useData';
import type { Deal, Receipt, ReceiptItem } from '../../core/types';

const DEALS: { v: Deal['kind']; label: string }[] = [
  { v: 'sale', label: 'Sale' },
  { v: 'coupon', label: 'Coupon' },
  { v: 'bogo', label: 'Buy One Get One' },
  { v: 'free', label: 'Free' },
];

const STORES = [
  'King Soopers',
  'City Market',
  'Walmart',
  'Safeway',
  'Sprouts',
  'Costco',
  'Target',
  'Aldi',
  'Natural Grocers',
  'Whole Foods',
  "Sam's Club",
  'Circle K',
  '7-Eleven',
  "Loaf 'N Jug",
  'Maverik',
  'Murphy USA',
  'Conoco',
  'Shell',
  'Walgreens',
  'CVS',
];

/** A read receipt, cleaned up for saving: plain names, normal capitals, deals counted as savings. */
function forSaving(r: ParsedReceipt & { id?: string }, source: Receipt['source']) {
  const { warnings: _w, itemsTotal: _t, ...rest } = r;
  const items = r.items.map(({ lowConfidence: _l, ...i }) => {
    const plain = plainNameFor(i.name);
    if (plain) return { ...i, name: plain.name, key: plain.key };
    // typed in all caps, like a receipt: give it normal capitals
    return /[A-Z]/.test(i.name) && i.name === i.name.toUpperCase() ? { ...i, name: cleanItemName(i.name).name } : i;
  });
  const deals = round2(r.items.reduce((s2, i) => s2 + (i.deal?.saved ?? 0), 0) + (r.discount ?? 0));
  return {
    ...rest,
    savings: deals || rest.savings,
    store: rest.store.trim() || 'Store',
    items,
    source,
  };
}

/** One file in a batch upload. */
interface BatchItem {
  name: string; // file name(s)
  status: 'waiting' | 'reading' | 'done' | 'error';
  parsed: ParsedReceipt | null;
  source: Receipt['source'];
  error?: string;
  include: boolean;
  duplicate?: boolean;
}

const continues = (prev: ParsedReceipt | null, next: ParsedReceipt) =>
  // the second screenshot of a long receipt: the first said items were missing, this one has no date or total of its own
  !!prev && prev.warnings.some((w) => /lists \d+ items/.test(w)) && next.total == null && next.warnings.some((w) => /No date/.test(w));

/** Scan or edit a grocery receipt. Anything Pebbles wasn't sure about is highlighted to check. */
export function ReceiptSheet({ data, existing, onClose }: { data: AppData; existing?: Receipt; onClose: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const appendRef = useRef(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState<Receipt['source']>(existing?.source ?? 'photo');
  const [r, setR] = useState<(ParsedReceipt & { id?: string }) | null>(
    existing
      ? {
          ...existing,
          warnings: [],
          itemsTotal: round2(existing.items.reduce((s, i) => s + i.price, 0)),
        }
      : null,
  );

  const read = async (file: File, append = false) => {
    setError('');
    setProgress('Reading…');
    try {
      const { lines, source: src } = await linesFromFile(file, (p, status) => setProgress(status.includes('recogniz') ? `Reading the receipt… ${Math.round(p * 100)}%` : 'Getting the reader ready…'));
      setSource(src);
      const parsed = parseReceipt(lines, data.itemRules, data.today);
      setR(append && r ? { ...mergeReceipts(r, parsed), id: r.id } : parsed);
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.');
    } finally {
      setProgress(null);
    }
  };

  // many receipts at once: read them one by one, then review the list and save them together
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const readBatch = async (files: File[]) => {
    setError('');
    let list: BatchItem[] = files.map((f) => ({
      name: f.name,
      status: 'waiting',
      parsed: null,
      source: 'photo',
      include: true,
    }));
    setBatch(list);
    for (let k = 0; k < files.length; k++) {
      list = list.map((b, j) => (j === k ? { ...b, status: 'reading' } : b));
      setBatch(list);
      try {
        const { lines, source: src } = await linesFromFile(files[k], (p, status) =>
          setProgress(status.includes('recogniz') ? `Reading ${k + 1} of ${files.length}… ${Math.round(p * 100)}%` : `Getting the reader ready…`),
        );
        const parsed = parseReceipt(lines, data.itemRules, data.today);
        // the rest of the receipt before it: join them
        const prevIdx = list
          .slice(0, k)
          .map((b, j) => (b.status === 'done' && b.include ? j : -1))
          .filter((j) => j >= 0)
          .pop();
        if (prevIdx != null && continues(list[prevIdx].parsed, parsed)) {
          list = list.map((b, j) =>
            j === prevIdx
              ? {
                  ...b,
                  name: `${b.name} + ${files[k].name}`,
                  parsed: mergeReceipts(b.parsed!, parsed),
                }
              : j === k
                ? {
                    ...b,
                    status: 'done',
                    include: false,
                    parsed: null,
                    error: 'joined',
                  }
                : b,
          );
        } else {
          const dup = data.receipts.some((x) => x.store === parsed.store && x.date === parsed.date && parsed.total != null && x.total != null && Math.abs(x.total - parsed.total) < 0.01);
          list = list.map((b, j) =>
            j === k
              ? {
                  ...b,
                  status: 'done',
                  parsed,
                  source: src,
                  include: !dup && parsed.items.length > 0,
                  duplicate: dup,
                }
              : b,
          );
        }
      } catch (e) {
        list = list.map((b, j) =>
          j === k
            ? {
                ...b,
                status: 'error',
                error: (e as Error).message || 'Couldn’t read this file.',
                include: false,
              }
            : b,
        );
      }
      setBatch(list);
    }
    setProgress(null);
  };

  // after saving: pick what from it is still in your kitchen (nothing goes in the pantry on its own)
  const [kitchen, setKitchen] = useState<Pick<Receipt, 'items' | 'date' | 'store'> | null>(null);
  if (kitchen) return <KitchenPickSheet data={data} receipt={kitchen} onClose={onClose} />;

  if (batch && editing == null) {
    const ready = batch.filter((b) => b.include && b.parsed);
    const reading = batch.some((b) => b.status === 'waiting' || b.status === 'reading');
    const shown = batch.map((b, i) => ({ b, i })).filter(({ b }) => b.error !== 'joined');
    return (
      <Sheet
        title={`Add ${batch.length} Receipts`}
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
                const saved: ReturnType<typeof forSaving>[] = [];
                for (const b of ready) {
                  const rec = forSaving(b.parsed!, b.source);
                  await saveReceipt(rec, false);
                  saved.push(rec);
                }
                setSaving(false);
                const items = saved.reduce((n, x) => n + x.items.length, 0);
                toast(`Saved ${saved.length} receipt${saved.length === 1 ? '' : 's'} · ${items} items`);
                // only fresh trips can still be in the kitchen; a backlog is prices only (each can be added later)
                const fresh = saved.filter((x) => isRecent(x.date, data.today) && pickableItems(x).length);
                if (fresh.length) {
                  const latest = fresh
                    .map((x) => x.date)
                    .sort()
                    .pop()!;
                  setKitchen({
                    items: fresh.flatMap((x) => x.items),
                    date: latest,
                    store: fresh
                      .map((x) => x.store)
                      .filter((v, k, a) => a.indexOf(v) === k)
                      .join(', '),
                  });
                } else onClose();
              }}
            >
              {reading ? (progress ?? 'Reading…') : saving ? 'Saving…' : `Save ${ready.length} Receipt${ready.length === 1 ? '' : 's'}`}
            </button>
          </>
        }
      >
        <div className="col gap-l">
          <p className="small ink2" style={{ margin: 0 }}>
            {reading ? `${progress ?? 'Reading…'} You can look over the ones that are done.` : 'Tap one to check it. Two screenshots of the same long receipt are joined on their own.'}
          </p>
          <div className="list">
            {shown.map(({ b, i }) => {
              const r2 = b.parsed;
              const total = r2 ? (r2.total ?? round2(r2.itemsTotal + (r2.tax ?? 0))) : null;
              return (
                <div
                  key={i}
                  className="list-item"
                  style={{
                    alignItems: 'flex-start',
                    gap: 10,
                    opacity: b.include ? 1 : 0.6,
                  }}
                >
                  <button
                    className={`check-btn${b.include ? ' on' : ''}`}
                    aria-label={b.include ? 'Leave this one out' : 'Include this one'}
                    disabled={!r2}
                    onClick={() => setBatch(batch.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))}
                  >
                    {b.include && <Check size={16} />}
                  </button>
                  <button
                    className="grow"
                    style={{
                      textAlign: 'left',
                      background: 'none',
                      border: 0,
                      padding: 0,
                      color: 'inherit',
                      font: 'inherit',
                      cursor: r2 ? 'pointer' : 'default',
                      minWidth: 0,
                    }}
                    disabled={!r2}
                    onClick={() => {
                      if (!r2) return;
                      setR(r2);
                      setSource(b.source);
                      setEditing(i);
                    }}
                  >
                    {r2 ? (
                      <>
                        <div className="strong small">
                          {r2.store} · {fmtShort(r2.date)}
                        </div>
                        <div className="tiny muted">
                          {r2.items.length} item
                          {r2.items.length === 1 ? '' : 's'}
                          {total != null ? ` · ${usd(total)}` : ''}
                          {r2.savings ? ` · saved ${usd(r2.savings)}` : ''}
                        </div>
                        {b.duplicate && <div className="tiny warn">Looks like one you already saved. Left out.</div>}
                        {r2.warnings.slice(0, 2).map((w) => (
                          <div key={w} className="tiny warn">
                            {w}
                          </div>
                        ))}
                        <div className="tiny muted ellipsis">{b.name}</div>
                      </>
                    ) : (
                      <>
                        <div className="strong small ellipsis">{b.name}</div>
                        <div className={`tiny ${b.status === 'error' ? 'bad' : 'muted'}`}>{b.status === 'error' ? b.error : b.status === 'reading' ? (progress ?? 'Reading…') : 'Waiting…'}</div>
                      </>
                    )}
                  </button>
                  {r2 && <span className="tiny muted">Check ›</span>}
                </div>
              );
            })}
          </div>
        </div>
      </Sheet>
    );
  }

  const setItem = (i: number, patch: Partial<ReceiptItem>) =>
    r &&
    setR({
      ...r,
      items: r.items.map((x, k) => (k === i ? { ...x, ...patch } : x)),
    });
  const itemsTotal = r ? round2(r.items.reduce((s, i) => s + i.price, 0)) : 0;
  const reference = r ? (r.subtotal ?? (r.total != null && r.tax != null ? round2(r.total - r.tax) : null)) : null;
  const mismatch = reference != null && Math.abs(reference - itemsTotal) > 0.05;
  const dealsTotal = r ? round2(r.items.reduce((s2, i) => s2 + (i.deal?.saved ?? 0), 0) + (r.discount ?? 0)) : 0;

  return (
    <Sheet
      title={existing ? 'Receipt' : batch ? 'Check This Receipt' : 'Add a Receipt'}
      wide
      onClose={
        batch && editing != null
          ? () => {
              // back to the list without these changes
              setR(null);
              setEditing(null);
            }
          : onClose
      }
      footer={
        r ? (
          <>
            {batch && editing != null ? (
              <button
                className="btn primary"
                style={{ flex: 1 }}
                onClick={() => {
                  setBatch(batch.map((b, j) => (j === editing ? { ...b, parsed: { ...r, warnings: r.warnings.filter((w) => !/No date/.test(w)) }, include: r.items.length > 0 } : b)));
                  setR(null);
                  setEditing(null);
                }}
              >
                Done, Back to the List
              </button>
            ) : (
              <>
                {existing ? (
                  <button
                    className="btn danger"
                    onClick={async () => {
                      if (
                        await ask({
                          title: `Delete this ${existing.store} receipt?`,
                          body: 'Its prices come out of your grocery numbers. Anything you already added to your pantry from it stays.',
                          confirm: 'Delete',
                          danger: true,
                        })
                      ) {
                        await deleteReceipt(existing.id);
                        toast('Receipt deleted');
                        onClose();
                      }
                    }}
                  >
                    <Trash2 /> Delete
                  </button>
                ) : (
                  <button className="btn" onClick={onClose}>
                    Cancel
                  </button>
                )}
                <button
                  className="btn primary"
                  disabled={!r.items.length}
                  onClick={async () => {
                    // plain names for everyday things, however they were typed or read ("KS CM VIT D" → Milk)
                    const rec = { ...forSaving(r, source), id: existing?.id };
                    const items = rec.items;
                    await saveReceipt(rec, false);
                    toast(`Saved ${r.items.length} items from ${r.store}${r.fuel ? ` · gas ${'$' + r.fuel.perGallon.toFixed(3)}/gal logged` : ''}`);
                    // a new grocery receipt: ask what's still in the kitchen
                    if (!existing && pickableItems({ items }).length) setKitchen({ items, date: r.date, store: r.store });
                    else onClose();
                  }}
                >
                  Save Receipt
                </button>
              </>
            )}
          </>
        ) : undefined
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.pdf,.txt"
        multiple={!existing}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 1 && !appendRef.current && !r) void readBatch(files);
          else if (files[0]) void read(files[0], appendRef.current);
          appendRef.current = false;
          e.target.value = '';
        }}
      />
      {!r && (
        <div className="col gap-l">
          <button
            className="card tint"
            style={{
              border: '1.5px dashed var(--line-2)',
              cursor: 'pointer',
              textAlign: 'center',
              width: '100%',
            }}
            onClick={() => fileRef.current?.click()}
            disabled={!!progress}
          >
            <Camera style={{ width: 28, height: 28, color: 'var(--moss)' }} />
            <div className="strong" style={{ marginTop: 6 }}>
              {progress ?? 'Take a photo or choose receipts'}
            </div>
            <div className="small muted">Photos, screenshots or PDFs, one or a whole stack at once. For King Soopers orders, the PDF invoice from the app reads best. Read right on your device.</div>
          </button>
          {error && <p className="small bad">{error}</p>}
          <p className="small ink2">For the best read: lay the receipt flat, fill the frame, and use good light. Long receipts can be photographed in two parts and saved separately.</p>
          <button
            className="btn ghost small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() =>
              setR({
                store: 'King Soopers',
                date: data.today,
                items: [],
                subtotal: null,
                tax: null,
                total: null,
                savings: null,
                warnings: [],
                itemsTotal: 0,
              })
            }
          >
            Or Type It in by Hand
          </button>
        </div>
      )}
      {r && (
        <div className="col gap-l">
          {[
            ...r.warnings.filter((w) => !w.includes('add up')),
            ...(mismatch ? [`Items add up to ${usd(itemsTotal)} but the receipt says ${usd(reference as number)}. Check the highlighted lines.`] : []),
          ].map((w) => (
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
          <div className="receipt-items">
            {r.items.map((it, i) => {
              const flag = it.lowConfidence || (mismatch && /\d/.test(it.name));
              const unit = it.qty > 1 ? round2(it.price / it.qty) : null;
              return (
                <div key={i} className={`receipt-item${flag ? ' flag' : ''}`}>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      className="input grow"
                      value={it.name}
                      aria-label="Name in your pantry"
                      placeholder="Short name (Milk, Coffee…)"
                      onChange={(e) => {
                        const c = cleanItemName(e.target.value);
                        setItem(i, {
                          name: e.target.value,
                          key: c.key || it.key,
                          dept: deptFor(e.target.value, c.key, data.itemRules),
                          pack: it.pack ?? packOf(e.target.value),
                        });
                      }}
                    />
                    <button className="icon-btn" aria-label="Remove item" onClick={() => setR({ ...r, items: r.items.filter((_, k) => k !== i) })}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="desc-box">
                    <input
                      className="input"
                      value={it.desc ?? describeItem(it)}
                      aria-label="Description"
                      placeholder="Full name from the receipt"
                      onChange={(e) => setItem(i, { desc: e.target.value })}
                    />
                    <span className="desc-price num">{usd(it.price)}</span>
                  </div>
                  {flag && it.raw && <div className="tiny warn">Check this line: “{it.raw}”</div>}
                  <div className="receipt-item-nums">
                    <div className="col" style={{ gap: 2 }}>
                      <span className="tiny muted">Qty</span>
                      <div className="stepper">
                        <button className="icon-btn" aria-label="One less" onClick={() => setItem(i, { qty: Math.max(1, it.qty - 1) })}>
                          <Minus size={15} />
                        </button>
                        <span className="num strong">{it.qty}</span>
                        <button className="icon-btn" aria-label="One more" onClick={() => setItem(i, { qty: it.qty + 1 })}>
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="col" style={{ gap: 2, width: 78 }}>
                      <span className="tiny muted">In Pack</span>
                      <NumberInput
                        value={it.pack ?? null}
                        allowEmpty
                        onChange={(v) =>
                          setItem(i, {
                            pack: v && v > 1 ? Math.round(v) : null,
                          })
                        }
                        placeholder="1"
                        ariaLabel="How many in one pack"
                      />
                    </div>
                    <div className="col grow" style={{ gap: 2, minWidth: 110 }}>
                      <span className="tiny muted">Price{unit != null ? ` · ${usd(unit)} each` : ''}</span>
                      <NumberInput value={it.price} onChange={(v) => setItem(i, { price: v ?? 0, lowConfidence: false })} prefix="$" money ariaLabel="Price" />
                    </div>
                  </div>
                  {(it.pack ?? 1) * it.qty > 1 && <div className="tiny muted">Adds {(it.pack ?? 1) * it.qty} to your pantry</div>}
                </div>
              );
            })}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button
              className="btn small"
              onClick={() =>
                setR({
                  ...r,
                  items: [
                    ...r.items,
                    {
                      raw: '',
                      name: '',
                      key: '',
                      price: 0,
                      qty: 1,
                      dept: 'other',
                      lowConfidence: true,
                    },
                  ],
                })
              }
            >
              <Plus /> Add an Item
            </button>
            <button
              className="btn small"
              disabled={!!progress}
              onClick={() => {
                appendRef.current = true;
                fileRef.current?.click();
              }}
            >
              <ImagePlus /> {progress ?? 'Add Another Screenshot'}
            </button>
          </div>

          <div className="card tint" style={{ padding: '10px 12px' }}>
            <div className="row between">
              <div className="eyebrow row gap-s">
                <Tag size={14} /> Coupons & Deals
              </div>
              <span className="small strong good">{dealsTotal > 0 ? `Saved ${usd(dealsTotal)}` : ''}</span>
            </div>
            {r.items.some((x) => x.deal) ? (
              <div className="list mt-s">
                {r.items.map((it, i) =>
                  it.deal ? (
                    <div key={i} className="list-item" style={{ flexWrap: 'wrap', gap: 6 }}>
                      <div className="grow" style={{ minWidth: 140 }}>
                        <div className="strong small">{it.name || 'Item'}</div>
                        <div className="tiny muted">
                          Paid {usd(it.price)}
                          {it.regular ? ` · usually ${usd(it.regular)}${it.qty > 1 ? ' each' : ''}` : ''}
                        </div>
                      </div>
                      <select
                        className="input"
                        style={{
                          minHeight: 34,
                          padding: '4px 8px',
                          width: 'auto',
                          fontSize: 13,
                        }}
                        value={it.deal.kind}
                        aria-label="Kind of deal"
                        onChange={(e) =>
                          setItem(i, {
                            deal: {
                              ...it.deal!,
                              kind: e.target.value as Deal['kind'],
                            },
                          })
                        }
                      >
                        {DEALS.map((d) => (
                          <option key={d.v} value={d.v}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      <span className="tiny muted">Saved</span>
                      <div style={{ width: 110 }} title="Saved">
                        <NumberInput value={it.deal.saved} onChange={(v) => setItem(i, { deal: { ...it.deal!, saved: v ?? 0 } })} prefix="$" money ariaLabel="Saved" />
                      </div>
                      <button className="icon-btn" aria-label="Remove deal" onClick={() => setItem(i, { deal: null })}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            ) : (
              <p className="tiny muted" style={{ margin: '4px 0 0' }}>
                No deals found. Add a coupon, sale or buy-one-get-one below.
              </p>
            )}
            {r.items.some((x) => !x.deal) && (
              <select
                className="input mt-s"
                style={{ minHeight: 34, padding: '4px 8px', fontSize: 13 }}
                value=""
                aria-label="Add a deal to an item"
                onChange={(e) => {
                  const i = Number(e.target.value);
                  if (!Number.isNaN(i)) setItem(i, { deal: { kind: 'coupon', saved: 0 } });
                }}
              >
                <option value="">+ Add a coupon or deal to…</option>
                {r.items.map((x, i) =>
                  x.deal ? null : (
                    <option key={i} value={i}>
                      {x.name || 'Item'}
                    </option>
                  ),
                )}
              </select>
            )}
          </div>

          <div className="form-grid two">
            <Field label="Subtotal">
              <NumberInput value={r.subtotal} allowEmpty onChange={(v) => setR({ ...r, subtotal: v })} prefix="$" money />
            </Field>
            <Field label="Tax" hint={r.tax == null && r.total != null ? 'Not on this part. Add the next screenshot and Pebbles works it out from the total.' : undefined}>
              <NumberInput value={r.tax} allowEmpty onChange={(v) => setR({ ...r, tax: v })} prefix="$" money />
            </Field>
            {(r.fees != null || r.discount != null) && (
              <>
                <Field label="Fees & Tip" hint="Delivery, service and tip">
                  <NumberInput value={r.fees ?? null} allowEmpty onChange={(v) => setR({ ...r, fees: v })} prefix="$" money />
                </Field>
                <Field label="Order Coupons" hint="Off the whole order">
                  <NumberInput value={r.discount ?? null} allowEmpty onChange={(v) => setR({ ...r, discount: v })} prefix="$" money />
                </Field>
              </>
            )}
            <Field label="Total">
              <NumberInput value={r.total} allowEmpty onChange={(v) => setR({ ...r, total: v })} prefix="$" money />
            </Field>
          </div>
          <p className="small muted">
            {r.items.length} items · {usd(itemsTotal)}
            {r.tax != null ? ` + ${usd(r.tax)} tax` : ''}
          </p>
          {existing && pickableItems(r).length > 0 && (
            <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setKitchen({ items: r.items, date: r.date, store: r.store })}>
              Add What’s Left to My Pantry
            </button>
          )}
          {!existing && (
            <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current?.click()}>
              <Camera /> Read a Different File
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
