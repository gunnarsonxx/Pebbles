import { useRef, useState } from 'react';
import { Camera, ImagePlus, Minus, Plus, RefreshCw, ScanBarcode, Trash2 } from 'lucide-react';
import { Sheet, useToast } from '../components';
import { barcodeId, lookupLocal, lookupOnline, type BarcodeInfo } from '../../core/barcodes';
import { cleanItemName, deptFor } from '../../core/groceries';
import { findSame } from '../../core/kitchen';
import { usd } from '../../core/money';
import { http } from '../../platform';
import { store } from '../../data/store';
import { applyKitchenPicks } from '../../data/pantryActions';
import { readBarcodesFromPhoto } from '../barcodeReader';
import type { AppData } from '../../data/useData';
import type { KitchenPick, LeftAmount } from '../../core/kitchen';

const LEFT: { v: LeftAmount; label: string }[] = [
  { v: 'gone', label: 'Gone' },
  { v: 'low', label: 'Low' },
  { v: 'half', label: 'Half' },
  { v: 'full', label: 'Full' },
];
const PILL: Record<LeftAmount, string> = { gone: 'out', low: 'low', half: 'half', full: 'full' };

interface Photo {
  id: number;
  name: string;
  status: 'reading' | 'done' | 'none' | 'error';
  error?: string;
}

interface Found {
  key: string; // the barcode, or 'typed:N' for one you typed in
  code: string | null;
  status: 'looking' | 'found' | 'unknown' | 'offline';
  info: BarcodeInfo | null;
  name: string;
  seen: number; // how many photos it was in (one each)
  left: LeftAmount;
  count: number | null;
  always: boolean;
  inPantry: boolean;
  separate: boolean; // add as its own item even if a pantry item looks the same
}

/** Photograph the barcodes of what's already in your kitchen; Pebbles works out what each one is. */
export function ScanKitchenSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [found, setFound] = useState<Found[]>([]);
  const foundRef = useRef<Found[]>([]);
  const nextId = useRef(1);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const update = (fn: (f: Found[]) => Found[]) => {
    foundRef.current = fn(foundRef.current);
    setFound(foundRef.current);
  };
  const setOne = (key: string, patch: Partial<Found>) => update((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const known = new Set(data.receipts.flatMap((r) => r.items.map((i) => i.name)));

  const look = async (code: string) => {
    const local = lookupLocal(code, store.list('barcodes'), data.receipts);
    if (local) return finish(code, local, 'found');
    const { info, offline } = await lookupOnline(http, code, data.itemRules);
    finish(code, info, info ? 'found' : offline ? 'offline' : 'unknown');
  };
  const finish = (code: string, info: BarcodeInfo | null, status: Found['status']) => {
    const inPantry = !!info && !!findSame(data.pantry, { key: cleanItemName(info.name).key, name: info.name, raw: info.product ?? info.name, desc: info.product ?? undefined });
    update((all) =>
      all.map((f) => {
        if (f.key !== code) return f;
        const units = (info?.pack ?? 1) * f.seen;
        return { ...f, status, info, name: f.name || info?.name || '', count: units > 1 ? units : null, inPantry };
      }),
    );
  };

  const scan = async (files: File[]) => {
    for (const file of files) {
      const id = nextId.current++;
      setPhotos((p) => [...p, { id, name: file.name || `Photo ${id}`, status: 'reading' }]);
      // one photo at a time: the reader is quick, and phones have limited memory for big photos
      queue.current = queue.current.then(async () => {
        try {
          const codes = await readBarcodesFromPhoto(file);
          setPhotos((p) => p.map((x) => (x.id === id ? { ...x, status: codes.length ? 'done' : 'none' } : x)));
          for (const code of codes) {
            const existing = foundRef.current.find((f) => f.code && barcodeId(f.code) === barcodeId(code));
            if (existing) {
              // the same product again: one more of it
              setOne(existing.key, { seen: existing.seen + 1, count: existing.count != null ? existing.count + (existing.info?.pack ?? 1) : existing.seen + 1 });
              continue;
            }
            update((all) => [...all, { key: code, code, status: 'looking', info: null, name: '', seen: 1, left: 'full', count: null, always: false, inPantry: false, separate: false }]);
            await look(code);
          }
        } catch (e) {
          setPhotos((p) => p.map((x) => (x.id === id ? { ...x, status: 'error', error: (e as Error).message || 'Couldn’t read this photo.' } : x)));
        }
      });
    }
  };

  const addTyped = () => update((all) => [...all, { key: `typed:${nextId.current++}`, code: null, status: 'unknown', info: null, name: '', seen: 1, left: 'full', count: null, always: false, inPantry: false, separate: false }]);

  // the pantry item a scan would update, by name (and its full name when it has one)
  const pantryMatch = (f: Found) => {
    const p = f.info ? findSame(data.pantry, { key: cleanItemName(f.name || f.info.name).key, name: f.name || f.info.name, raw: f.info.product ?? f.name, desc: f.info.product ?? undefined }) : undefined;
    return p ? `${p.name}${p.desc ? ` (${p.desc})` : ''}` : 'the same item';
  };
  const ready = found.filter((f) => f.name.trim() && f.status !== 'looking' && ((f.count != null ? f.count > 0 : f.left !== 'gone') || f.always));
  const busy = photos.some((p) => p.status === 'reading') || found.some((f) => f.status === 'looking');
  const unreadable = photos.filter((p) => p.status === 'none' || p.status === 'error');

  const save = async () => {
    const picks: KitchenPick[] = ready.map((f) => {
      const c = cleanItemName(f.name);
      return {
        item: { raw: f.info?.product ?? f.name, desc: f.info?.product ?? undefined, name: f.name.trim(), key: c.key, price: f.info?.price ?? 0, qty: f.seen, dept: f.info?.dept ?? deptFor(f.name, c.key, data.itemRules), pack: f.info?.pack ?? null, upc: f.code },
        separate: f.separate,
        left: f.left,
        count: f.count,
        always: f.always,
        stapleId: null,
      };
    });
    const done = await applyKitchenPicks(picks, data.today);
    // remember what each barcode is (with your name for it), for next time and the other device
    const named = found.filter((f) => f.code && f.name.trim());
    if (named.length)
      await store.putMany(
        'barcodes',
        named.map((f) => {
          const c = cleanItemName(f.name);
          return { id: barcodeId(f.code!), name: f.name.trim(), dept: f.info?.dept ?? deptFor(f.name, c.key, data.itemRules), pack: f.info?.pack ?? null, product: f.info?.product ?? null, at: Date.now() };
        }),
      );
    toast(done);
    onClose();
  };

  const source = (f: Found) =>
    f.status === 'looking'
      ? 'Looking it up…'
      : f.status === 'offline'
        ? 'Couldn’t look it up right now (no internet, or the lookup is busy). Type what it is, or try again.'
        : f.status === 'unknown'
          ? f.code
            ? 'Not in the product databases. Type what it is.'
            : 'Typed in'
          : f.info?.source === 'yours'
            ? 'You named this one before'
            : f.info?.source === 'receipt'
              ? `On your receipts${f.info.price ? ` · ${usd(f.info.price)}` : ''}`
              : `Found online: ${f.info?.product ?? ''}`;

  return (
    <Sheet
      title="Scan Your Kitchen"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ready.length || busy} onClick={() => void save()}>
            {busy ? 'Reading…' : `Add ${ready.length || ''} to Pantry`}
          </button>
        </>
      }
    >
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => (void scan(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
      <input ref={pickRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => (void scan(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          Photograph the barcode on each thing in your kitchen (a few in one photo is fine), then say how much is left. Items from your receipts are recognized right away; the rest are looked up in free product databases.
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn primary" onClick={() => cameraRef.current?.click()}>
            <Camera /> Take a Photo
          </button>
          <button className="btn" onClick={() => pickRef.current?.click()}>
            <ImagePlus /> Choose Photos
          </button>
          <button className="btn ghost" onClick={addTyped}>
            <Plus /> Type One In
          </button>
        </div>
        {photos.length > 0 && (
          <div className="tiny muted">
            {photos.length} photo{photos.length === 1 ? '' : 's'}
            {photos.some((p) => p.status === 'reading') ? ` · reading ${photos.filter((p) => p.status !== 'reading').length + 1} of ${photos.length}…` : ''}
            {found.filter((f) => f.code).length ? ` · ${found.filter((f) => f.code).length} barcode${found.filter((f) => f.code).length === 1 ? '' : 's'} found` : ''}
          </div>
        )}
        {unreadable.length > 0 && (
          <div className="tiny warn">
            {unreadable.map((p) => (
              <div key={p.id}>
                {p.name}: {p.status === 'error' ? p.error : 'no barcode found. Try closer, flatter and in good light, or Type One In.'}
              </div>
            ))}
          </div>
        )}
        {!found.length && !photos.length && (
          <div className="card tint center" style={{ padding: 18 }}>
            <ScanBarcode style={{ width: 30, height: 30, color: 'var(--moss)' }} />
            <div className="small ink2 mt-s">Fill the photo with the barcode, hold steady, good light.</div>
          </div>
        )}
        <datalist id="pebbles-known-items">
          {[...known].slice(0, 300).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div className="list">
          {found.map((f) => (
            <div key={f.key} className="list-item" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <div className="grow" style={{ minWidth: 170 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <button className={`staple-star${f.always ? ' on' : ''}`} aria-pressed={f.always} aria-label="Staple" title="Staple: something you always get" onClick={() => setOne(f.key, { always: !f.always })}>
                    {f.always ? '★' : '☆'}
                  </button>
                  <input
                    className="input"
                    style={{ minHeight: 36, padding: '4px 10px' }}
                    value={f.name}
                    list="pebbles-known-items"
                    placeholder={f.status === 'looking' ? 'Looking it up…' : 'What is it? (e.g. Peanut Butter)'}
                    aria-label="Item name"
                    onChange={(e) => setOne(f.key, { name: e.target.value })}
                  />
                </div>
                <div className={`tiny ${f.status === 'found' ? 'muted' : f.status === 'looking' ? 'muted' : 'warn'}`} style={{ marginLeft: 30, marginTop: 2 }}>
                  {source(f)}
                  {f.inPantry && !f.separate ? (
                    <>
                      {' · '}
                      <span className="good">updates {pantryMatch(f)}</span>
                      <button className="link-btn tiny" style={{ marginLeft: 6 }} onClick={() => setOne(f.key, { separate: true })}>
                        Keep Separate
                      </button>
                    </>
                  ) : f.inPantry ? (
                    <>
                      {' · added as its own item'}
                      <button className="link-btn tiny" style={{ marginLeft: 6 }} onClick={() => setOne(f.key, { separate: false })}>
                        Update {pantryMatch(f)} Instead
                      </button>
                    </>
                  ) : null}
                  {f.status === 'offline' && f.code && (
                    <button className="link-btn tiny" style={{ marginLeft: 6 }} onClick={() => (setOne(f.key, { status: 'looking' }), void look(f.code!))}>
                      <RefreshCw size={11} /> Try Again
                    </button>
                  )}
                </div>
              </div>
              {f.count != null ? (
                <div className="stepper" style={{ border: '1px solid var(--line)', borderRadius: 999 }}>
                  <button className="icon-btn" aria-label="One less" onClick={() => setOne(f.key, { count: Math.max(0, (f.count ?? 0) - 1) })}>
                    <Minus size={15} />
                  </button>
                  <span className="num strong small">{f.count}</span>
                  <button className="icon-btn" aria-label="One more" onClick={() => setOne(f.key, { count: (f.count ?? 0) + 1 })}>
                    <Plus size={15} />
                  </button>
                </div>
              ) : (
                <div className="level-pills" role="group" aria-label="How much is left">
                  {LEFT.map((l) => (
                    <button key={l.v} className={`level-pill ${PILL[l.v]}${f.left === l.v ? ' on' : ''}`} aria-pressed={f.left === l.v} onClick={() => setOne(f.key, { left: l.v })}>
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
              <button className="icon-btn" aria-label="Remove" onClick={() => update((all) => all.filter((x) => x.key !== f.key))}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
