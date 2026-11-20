import { useMemo, useState } from 'react';
import { Check, Minus, Plus, Trash2 } from 'lucide-react';
import { Field, Sheet, TextInput, useConfirm, useToast } from '../components';
import { STAPLE_PRESETS, defaultPicks, findSame, isRecent, newStaple, pickableItems, stapleFor, type KitchenPick, type LeftAmount } from '../../core/kitchen';
import { cleanItemName, describeItem } from '../../core/groceries';
import { fmtShort } from '../../core/dates';
import { usd } from '../../core/money';
import { applyKitchenPicks, deleteStaple, gotForStaple, saveStaple } from '../../data/pantryActions';
import type { AppData } from '../../data/useData';
import type { Receipt, Staple } from '../../core/types';

const LEFT: { v: LeftAmount; label: string }[] = [
  { v: 'gone', label: 'Gone' },
  { v: 'low', label: 'Low' },
  { v: 'half', label: 'Half' },
  { v: 'full', label: 'Full' },
];
const PILL: Record<LeftAmount, string> = {
  gone: 'out',
  low: 'low',
  half: 'half',
  full: 'full',
};

/** Pick a staple for an item: yours, a ready-made idea, or a new one you name. */
export function StaplePicker({ data, value, onChange, label = 'Swaps with' }: { data: AppData; value: string | null; onChange: (id: string | null, created?: Staple) => void; label?: string }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const presets = STAPLE_PRESETS.filter((p) => !data.staples.some((s) => s.name.toLowerCase() === p.name.toLowerCase()));
  const create = async (st: Staple) => {
    await saveStaple(st);
    onChange(st.id, st);
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <select
        className="input"
        style={{ minHeight: 34, padding: '4px 8px', fontSize: 13 }}
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new') return setNaming(true);
          if (v.startsWith('preset:')) {
            const p = STAPLE_PRESETS[Number(v.slice(7))];
            return void create(newStaple(p.name, p.keywords));
          }
          onChange(v || null);
        }}
      >
        <option value="">Doesn’t swap with anything</option>
        {data.staples.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        {presets.length > 0 && (
          <optgroup label="Swaps with similar things">
            {presets.map((p) => (
              <option key={p.name} value={`preset:${STAPLE_PRESETS.indexOf(p)}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value="__new">New Swap Group…</option>
      </select>
      {naming && (
        <div className="row" style={{ gap: 6 }}>
          <div className="grow">
            <TextInput value={name} onChange={setName} placeholder="e.g. Quick Lunches" autoFocus onEnter={() => name.trim() && void create(newStaple(name)).then(() => setNaming(false))} />
          </div>
          <button
            className="btn small primary"
            disabled={!name.trim()}
            onClick={async () => {
              await create(newStaple(name));
              setNaming(false);
              setName('');
            }}
          >
            Create
          </button>
        </div>
      )}
    </div>
  );
}

/** After a receipt: what from it is still in your kitchen, and how much. Nothing goes in unless you say so. */
export function KitchenPickSheet({ data, receipt, onClose }: { data: AppData; receipt: Pick<Receipt, 'items' | 'date' | 'store'>; onClose: () => void }) {
  const toast = useToast();
  const usualKeys = new Set((data.groceries?.usual ?? []).map((u) => u.key));
  const [picks, setPicks] = useState<KitchenPick[]>(() => defaultPicks(receipt, data.today, data.pantry, data.staples, usualKeys));
  const recent = isRecent(receipt.date, data.today);
  const kept = picks.filter((p) => (p.count != null ? p.count > 0 : p.left !== 'gone') || p.always).length;
  // the swap-group picker only shows where it could matter
  const groupable = (name: string) =>
    data.staples.length > 0 ||
    !!stapleFor(
      name,
      STAPLE_PRESETS.map((x) => newStaple(x.name, x.keywords)),
    );
  const set = (i: number, patch: Partial<KitchenPick>) => setPicks(picks.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const all = (left: LeftAmount) =>
    setPicks(
      picks.map((p) => ({
        ...p,
        left,
        count: p.count == null ? null : left === 'gone' ? 0 : (p.item.pack ?? 1) * Math.max(1, p.item.qty || 1),
      })),
    );

  return (
    <Sheet
      title="What’s Still in Your Kitchen?"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Skip, Prices Only
          </button>
          <button
            className="btn primary"
            disabled={!kept}
            onClick={async () => {
              toast(await applyKitchenPicks(picks, receipt.date));
              onClose();
            }}
          >
            Update Pantry{kept ? ` (${kept})` : ''}
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          {recent
            ? 'Everything starts as Full (things in packs start with how many you bought). Change anything you’ve already used.'
            : `This receipt is from ${fmtShort(receipt.date)}. Its prices are saved. Pick only what’s still in your kitchen and about how much is left.`}{' '}
          Tap ★ on the things you always get (milk, bread, coffee) to make them staples: they stay at the top of your pantry and go on your list as soon as they run low.
        </p>
        <div className="row gap-s">
          <button className="btn ghost small" onClick={() => all('full')}>
            All Full
          </button>
          <button className="btn ghost small" onClick={() => all('gone')}>
            None
          </button>
        </div>
        {!picks.length && <p className="small muted">No grocery items on this receipt.</p>}
        <div className="list">
          {picks.map((p, i) => (
            <div
              key={`${p.item.key}${i}`}
              className="list-item"
              style={{
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                opacity: p.left === 'gone' ? 0.7 : 1,
              }}
            >
              <div className="grow" style={{ minWidth: 140 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <button
                    className={`staple-star${p.always ? ' on' : ''}`}
                    aria-pressed={p.always}
                    aria-label={`${p.item.name} is a staple`}
                    title="Staple: something you always get"
                    onClick={() => set(i, { always: !p.always })}
                  >
                    {p.always ? '★' : '☆'}
                  </button>
                  <input
                    className="input pick-name"
                    value={p.item.name}
                    aria-label="Name in your pantry"
                    onChange={(e) => set(i, { item: { ...p.item, name: e.target.value, key: cleanItemName(e.target.value).key || p.item.key } })}
                  />
                </div>
                <div className="tiny muted pick-desc">
                  {describeItem(p.item)}
                  {p.item.price > 0 ? ` · ${usd(p.item.price)}` : ''}
                </div>
                {(p.count != null ? p.count > 0 : p.left !== 'gone') && groupable(p.item.name) && (
                  <div style={{ marginTop: 6, maxWidth: 260 }}>
                    <StaplePicker
                      data={data}
                      value={p.stapleId}
                      onChange={(id, created) =>
                        // a new staple also takes the other items on this receipt that fit it
                        setPicks(picks.map((x, k) => (k === i ? { ...x, stapleId: id } : created && !x.stapleId && stapleFor(x.item.name, [created]) ? { ...x, stapleId: created.id } : x)))
                      }
                    />
                  </div>
                )}
              </div>
              {p.count != null ? (
                <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
                  <div
                    className="stepper"
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 999,
                    }}
                  >
                    <button className="icon-btn" aria-label={`One less ${p.item.name}`} onClick={() => set(i, { count: Math.max(0, (p.count ?? 0) - 1) })}>
                      <Minus size={15} />
                    </button>
                    <span className="num strong small">{p.count}</span>
                    <button className="icon-btn" aria-label={`One more ${p.item.name}`} onClick={() => set(i, { count: (p.count ?? 0) + 1 })}>
                      <Plus size={15} />
                    </button>
                  </div>
                  <span className="tiny muted">
                    {p.count === 0 ? 'None left' : 'Left'} of {(p.item.pack ?? 1) * Math.max(1, p.item.qty || 1)}
                    {' bought'}
                    {p.count === 0 && (
                      <button
                        className="link-btn tiny"
                        style={{ marginLeft: 6 }}
                        onClick={() =>
                          set(i, {
                            count: (p.item.pack ?? 1) * Math.max(1, p.item.qty || 1),
                          })
                        }
                      >
                        All
                      </button>
                    )}
                  </span>
                </div>
              ) : (
                <div className="level-pills" role="group" aria-label={`${p.item.name}: how much is left`}>
                  {LEFT.map((l) => (
                    <button key={l.v} className={`level-pill ${PILL[l.v]}${p.left === l.v ? ' on' : ''}`} aria-pressed={p.left === l.v} onClick={() => set(i, { left: l.v })}>
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/** Make or edit a swap group: similar things where any one will do (pizza rolls, popcorn chicken…). */
export function StapleSheet({ data, staple, onClose }: { data: AppData; staple: Staple | null; onClose: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [s, setS] = useState<Staple>(staple ?? newStaple(''));
  const [words, setWords] = useState((staple?.keywords ?? []).join(', '));
  const members = data.pantry.filter((p) => p.stapleId === s.id);
  const presets = STAPLE_PRESETS.filter((p) => !data.staples.some((x) => x.name.toLowerCase() === p.name.toLowerCase()));
  return (
    <Sheet
      title={staple ? staple.name : 'New Swap Group'}
      onClose={onClose}
      footer={
        <>
          {staple && (
            <button
              className="btn danger"
              onClick={async () => {
                if (
                  await ask({
                    title: `Remove “${staple.name}”?`,
                    body: 'Its items stay in your pantry; they just go back to being on their own.',
                    confirm: 'Remove',
                    danger: true,
                  })
                ) {
                  await deleteStaple(staple.id);
                  onClose();
                }
              }}
            >
              <Trash2 /> Remove
            </button>
          )}
          <button
            className="btn primary"
            disabled={!s.name.trim()}
            onClick={async () => {
              const n = await saveStaple({
                ...s,
                name: s.name.trim(),
                keywords: words
                  .split(',')
                  .map((w) => w.trim().toLowerCase())
                  .filter(Boolean),
              });
              toast(n ? `Saved · ${n} pantry item${n === 1 ? '' : 's'} joined it` : 'Saved');
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="col gap-l">
        {!staple && presets.length > 0 && (
          <div>
            <div className="small ink2" style={{ marginBottom: 6 }}>
              Start from an idea:
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {presets.map((p) => (
                <button
                  key={p.name}
                  className={`chip${s.name === p.name ? ' on' : ''}`}
                  onClick={() => {
                    setS({ ...s, name: p.name });
                    setWords(p.keywords.join(', '));
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Name">
          <TextInput value={s.name} onChange={(v) => setS({ ...s, name: v })} placeholder="Air Fryer Frozen Food" />
        </Field>
        <Field label="Counts If the Name Has" hint="Comma separated. Pizza rolls, popcorn chicken, nuggets…">
          <textarea className="input" rows={3} value={words} onChange={(e) => setWords(e.target.value)} style={{ minHeight: 70, padding: 10 }} />
        </Field>
        {(s.examples.length > 0 || members.length > 0) && (
          <Field label="You’ve Bought for It">
            <div className="row wrap" style={{ gap: 6 }}>
              {[...new Set([...s.examples, ...members.map((m) => m.name)])].map((e) => (
                <span key={e} className="chip">
                  {e}
                </span>
              ))}
            </div>
          </Field>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          When everything in the group runs out, your list says “{s.name || 'Air Fryer Frozen Food'}” with what you got before, so you can grab whatever looks good.
        </p>
      </div>
    </Sheet>
  );
}

/** Ticked a staple on the list: what did you get this time? */
export function StapleGotSheet({ data, staple, options, onClose }: { data: AppData; staple: Staple; options: string[]; onClose: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const opts = useMemo(() => [...new Set(options)], [options]);
  void data;
  const done = async () => {
    const names = [...picked, ...(other.trim() ? [other.trim()] : [])];
    for (const n of names) await gotForStaple(staple, n);
    toast(`Got ${names.join(', ')}`);
    onClose();
  };
  return (
    <Sheet
      title={`What ${staple.name} Did You Get?`}
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!picked.length && !other.trim()} onClick={() => void done()}>
          <Check /> Done
        </button>
      }
    >
      <div className="col gap-l">
        {opts.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            {opts.map((o) => (
              <button key={o} className={`chip${picked.includes(o) ? ' on' : ''}`} onClick={() => setPicked(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])}>
                {o}
              </button>
            ))}
          </div>
        )}
        <Field label="Something New">
          <div className="row" style={{ gap: 6 }}>
            <div className="grow">
              <TextInput value={other} onChange={setOther} placeholder="e.g. Egg rolls" onEnter={() => void done()} />
            </div>
            {other.trim() && (
              <button className="btn small" onClick={() => (setPicked([...picked, other.trim()]), setOther(''))} aria-label="Add another">
                <Plus />
              </button>
            )}
          </div>
        </Field>
      </div>
    </Sheet>
  );
}

/** One picker row: the plain name (editable), the store's full name and price, staple star, and how much is left. */
export function PickRow({
  pick,
  sub,
  inPantry,
  onChange,
}: {
  pick: KitchenPick;
  sub?: string;
  inPantry?: string | null;
  onChange: (patch: Partial<KitchenPick>) => void;
}) {
  const bought = (pick.item.pack ?? 1) * Math.max(1, pick.item.qty || 1);
  const each = pick.item.price > 0 ? pick.item.price / Math.max(1, pick.item.qty || 1) : null;
  return (
    <div className="list-item" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <div className="grow" style={{ minWidth: 170 }}>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <button className={`staple-star${pick.always ? ' on' : ''}`} aria-pressed={pick.always} aria-label={`${pick.item.name} is a staple`} title="Staple: something you always get" onClick={() => onChange({ always: !pick.always })}>
            {pick.always ? '★' : '☆'}
          </button>
          <input
            className="input pick-name"
            value={pick.item.name}
            aria-label="Name in your pantry"
            onChange={(e) => {
              const name = e.target.value;
              onChange({ item: { ...pick.item, name, key: cleanItemName(name).key || pick.item.key } });
            }}
          />
        </div>
        <div className="tiny muted pick-desc" title={describeItem(pick.item)}>
          {describeItem(pick.item)}
          {each != null ? ` · ${usd(each)}${pick.item.qty > 1 ? ` each, ${pick.item.qty} bought` : ''}` : pick.item.deal ? ' · free' : ''}
        </div>
        {(sub || inPantry) && (
          <div className="tiny muted" style={{ marginLeft: 30 }}>
            {sub}
            {sub && inPantry ? ' · ' : ''}
            {inPantry ? <span className="good">in your pantry: {inPantry}</span> : null}
          </div>
        )}
      </div>
      {pick.count != null ? (
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <div className="stepper" style={{ border: '1px solid var(--line)', borderRadius: 999 }}>
            <button className="icon-btn" aria-label={`One less ${pick.item.name}`} onClick={() => onChange({ count: Math.max(0, (pick.count ?? 0) - 1) })}>
              <Minus size={15} />
            </button>
            <span className="num strong small">{pick.count}</span>
            <button className="icon-btn" aria-label={`One more ${pick.item.name}`} onClick={() => onChange({ count: (pick.count ?? 0) + 1 })}>
              <Plus size={15} />
            </button>
          </div>
          <span className="tiny muted">left of {bought} bought</span>
        </div>
      ) : (
        <div className="level-pills" role="group" aria-label={`${pick.item.name}: how much is left`}>
          {LEFT.map((l) => (
            <button key={l.v} className={`level-pill ${PILL[l.v]}${pick.left === l.v ? ' on' : ''}`} aria-pressed={pick.left === l.v} onClick={() => onChange({ left: l.v })}>
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Fill the pantry from your receipts, however old: things that keep (rice, coffee, sugar) or haven't been
 * opened yet. Pick a receipt (or see them all, newest first); nothing is added unless you say how much is left.
 */
export function PastItemsSheet({ data, onClose, receiptId }: { data: AppData; onClose: () => void; receiptId?: string }) {
  const toast = useToast();
  const usualKeys = useMemo(() => new Set((data.groceries?.usual ?? []).map((u) => u.key)), [data.groceries]);
  const receipts = useMemo(() => [...data.receipts].filter((r) => pickableItems(r).length).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt), [data.receipts]);
  const [which, setWhich] = useState<string>(receiptId ?? 'all');
  const [picks, setPicks] = useState<Map<string, KitchenPick>>(new Map());
  const [q, setQ] = useState('');
  const shown = receipts.filter((r) => which === 'all' || r.id === which);
  const keyOf = (r: Receipt, i: number) => `${r.id}:${i}`;
  const pickFor = (r: Receipt, i: number, item: Receipt['items'][number]): KitchenPick => {
    const units = (item.pack ?? 1) * Math.max(1, item.qty || 1);
    return picks.get(keyOf(r, i)) ?? { item, left: 'gone', count: units > 1 ? 0 : null, always: false, stapleId: null, date: r.date };
  };
  const chosen = [...picks.values()].filter((p) => (p.count != null ? p.count > 0 : p.left !== 'gone') || p.always);
  const inPantry = (item: Receipt['items'][number]) => {
    const p = findSame(data.pantry, item);
    return p ? (p.mode === 'level' ? p.level : `${p.qty} ${p.unit}`) : null;
  };
  const filter = (item: Receipt['items'][number]) => !q.trim() || `${item.name} ${describeItem(item)}`.toLowerCase().includes(q.trim().toLowerCase());

  return (
    <Sheet
      title="Add From Your Receipts"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!chosen.length}
            onClick={async () => {
              toast(await applyKitchenPicks(chosen, data.today));
              onClose();
            }}
          >
            Add {chosen.length || ''} to Pantry
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          Set how much is left of anything you still have, and ★ the ones you always get. Under each name is the store’s full name and price, so you can tell similar things apart; rename any
          of them. Anything you leave at Gone stays off.
        </p>
        <select className="input" value={which} onChange={(e) => setWhich(e.target.value)} aria-label="Which receipt">
          <option value="all">All receipts, newest first ({receipts.length})</option>
          {receipts.map((r) => (
            <option key={r.id} value={r.id}>
              {r.store} · {fmtShort(r.date)} · {pickableItems(r).length} items{r.total != null ? ` · ${usd(r.total)}` : ''}
            </option>
          ))}
        </select>
        {receipts.reduce((n, r) => n + r.items.length, 0) > 12 && <TextInput value={q} onChange={setQ} placeholder="Find an item…" ariaLabel="Find an item" />}
        {chosen.length > 0 && (
          <div className="card tint" style={{ padding: '8px 10px' }}>
            <div className="tiny strong">Will add (from any receipt, even ones not shown right now)</div>
            <div className="row wrap mt-s" style={{ gap: 6 }}>
              {[...picks.entries()]
                .filter(([, p]) => (p.count != null ? p.count > 0 : p.left !== 'gone') || p.always)
                .map(([k, p]) => (
                  <span key={k} className="chip">
                    {p.item.name} · {p.count != null ? `${p.count}` : p.left === 'gone' ? 'staple' : p.left}
                    <button
                      className="link-btn"
                      style={{ marginLeft: 6 }}
                      aria-label={`Don’t add ${p.item.name}`}
                      onClick={() => {
                        const n = new Map(picks);
                        n.delete(k);
                        setPicks(n);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
            </div>
          </div>
        )}
        {!receipts.length && <p className="small muted">No grocery receipts yet.</p>}
        {shown.map((r) => {
          const items = pickableItems(r)
            .map((item, i) => ({ item, i }))
            .filter(({ item }) => filter(item));
          if (!items.length) return null;
          return (
            <div key={r.id}>
              <div className="eyebrow">
                {r.store} · {fmtShort(r.date)}
              </div>
              <div className="list">
                {items.map(({ item, i }) => (
                  <PickRow
                    key={keyOf(r, i)}
                    pick={pickFor(r, i, item)}
                    sub={usualKeys.has(item.key) ? 'you get this most trips' : undefined}
                    inPantry={inPantry(item)}
                    onChange={(patch) => setPicks(new Map(picks).set(keyOf(r, i), { ...pickFor(r, i, item), ...patch }))}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
