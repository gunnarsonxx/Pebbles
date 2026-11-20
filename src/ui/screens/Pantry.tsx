import { useMemo, useState } from 'react';
import { Camera, Check, ListPlus, Minus, Plus, ShoppingCart, Trash2, Sparkles } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { Empty, Field, NumberInput, Segmented, Sheet, TextInput, ToggleRow, useConfirm, useToast } from '../components';
import { ReceiptSheet } from '../sheets/ReceiptSheet';
import { PastItemsSheet, StapleGotSheet, StaplePicker, StapleSheet } from '../sheets/KitchenSheets';
import { stapleStatus } from '../../core/kitchen';
import { DEPT_LABEL, NON_GROCERY_DEPTS } from '../../core/groceries';
import { buildList, estimateTrip, LEVEL_LABEL, LEVELS, makePriceOf, newPantryItem, nextLevel, parseQuickAdd, stockOf, type ListLine } from '../../core/pantry';
import { num, round2, usd } from '../../core/money';
import { addToList, boughtLine, clearBought, deletePantryItem, removeShopItem, savePantryItem, savePantryItems } from '../../data/pantryActions';
import type { GroceryDept, PantryItem, Staple } from '../../core/types';

function useList(data: AppData) {
  return useMemo(() => {
    const priceOf = makePriceOf(data.groceries, [...data.prices.values()]);
    const lines = buildList(data.pantry, data.shoplist, data.receipts, data.today, priceOf, data.staples);
    const taxRate = data.groceries?.taxRate ?? 0.0407;
    const trip = estimateTrip(lines.filter((l) => l.why !== 'due'), taxRate);
    return { lines, trip, taxRate };
  }, [data]);
}

// ---------------- shopping list ----------------

export function ShoppingListView({ data, openPantry, openTrips }: { data: AppData; openPantry: () => void; openTrips: () => void }) {
  const toast = useToast();
  const { lines, trip } = useList(data);
  const [adding, setAdding] = useState('');
  const [scanning, setScanning] = useState(false);
  const need = lines.filter((l) => l.why !== 'due');
  const maybe = lines.filter((l) => l.why === 'due');
  const bought = data.shoplist.filter((s) => s.done);
  const monthly = data.essentials.groceriesMonthly;

  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    const p = data.pantry.find((x) => x.name.toLowerCase() === name.toLowerCase());
    await addToList(name, p?.id ?? null, p?.key ?? '');
    setAdding('');
  };

  const [gotStaple, setGotStaple] = useState<ListLine | null>(null);
  const tick = async (l: ListLine) => {
    if (l.staple) return setGotStaple(l);
    const undo = await boughtLine(l);
    toast(`Got ${l.name}`, { label: 'Undo', run: undo });
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow">Next Trip</div>
            <div className="hero-number" style={{ fontSize: 40 }}>
              {need.length ? `≈ ${usd(trip.total)}` : usd(0)}
            </div>
            <div className="small muted">
              {need.length
                ? `${need.length} item${need.length === 1 ? '' : 's'} with tax${trip.priced < trip.items ? ` · ${trip.items - trip.priced} without a price yet (guessed)` : ''}`
                : 'Nothing on the list. You’re stocked up.'}
            </div>
          </div>
          <button className="btn small" onClick={() => setScanning(true)}>
            <Camera /> Receipt
          </button>
        </div>
        <div className="divider" />
        <div className="row between small">
          <span className="ink2">Groceries in your budget</span>
          <span className="strong num">{usd(monthly, true)}/month</span>
        </div>
        <div className="tiny muted">{data.essentials.groceriesReason}. It comes out of your money each payday, along with gas.</div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <div className="grow">
            <TextInput value={adding} onChange={setAdding} placeholder="Add to the list…" onEnter={() => void add()} />
          </div>
          <button className="btn primary" onClick={() => void add()} disabled={!adding.trim()} aria-label="Add to list">
            <Plus />
          </button>
        </div>
        {need.length > 0 ? (
          <div className="list mt">
            {need.map((l) => (
              <ListRow key={l.id} line={l} onTick={() => void tick(l)} onRemove={l.shop ? () => void removeShopItem(l.shop!.id) : undefined} />
            ))}
          </div>
        ) : (
          !data.pantry.length && (
            <Empty icon={<ShoppingCart className="big" />} title="Your list fills itself">
              Add what you keep at home on the Pantry tab. When something runs low or out, it shows up here with a price.
            </Empty>
          )
        )}
        {!data.pantry.length && (
          <div className="center mt">
            <button className="btn" onClick={openPantry}>
              <ListPlus /> Set Up Your Pantry
            </button>
          </div>
        )}
      </div>

      {maybe.length > 0 && (
        <div className="card">
          <div className="eyebrow">Maybe Running Low</div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            You usually rebuy these about now.
          </div>
          <div className="list">
            {maybe.map((l) => (
              <div key={l.id} className="list-item">
                <div className="grow">
                  <div className="strong small">{l.name}</div>
                  <div className="tiny muted">{l.price != null ? `${usd(l.price)} · ${l.priceFrom}` : 'No price yet'}</div>
                </div>
                <button className="btn small" onClick={() => void addToList(l.name, l.pantry?.id ?? null, l.key)}>
                  <Plus /> Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {bought.length > 0 && (
        <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => void clearBought()}>
          <Trash2 /> Clear {bought.length} bought item{bought.length === 1 ? '' : 's'}
        </button>
      )}

      {!data.receipts.length && (
        <button className="card action-card" onClick={openTrips}>
          <span className="list-icon" style={{ background: 'var(--moss-soft)', color: 'var(--moss-strong)' }}>
            <Camera />
          </span>
          <div className="grow">
            <div className="strong">Upload Your First Grocery Receipt</div>
            <div className="small muted">Pebbles learns your prices and what you really spend on groceries each month.</div>
          </div>
        </button>
      )}
      {scanning && <ReceiptSheet data={data} onClose={() => setScanning(false)} />}
      {gotStaple?.staple && <StapleGotSheet data={data} staple={gotStaple.staple.staple} options={gotStaple.staple.options} onClose={() => setGotStaple(null)} />}
    </div>
  );
}

function ListRow({ line, onTick, onRemove }: { line: ListLine; onTick: () => void; onRemove?: () => void }) {
  return (
    <div className="list-item">
      <button className="check-btn" onClick={onTick} aria-label={`Got ${line.name}`}>
        <Check size={16} />
      </button>
      <div className="grow">
        <div className="strong small">
          {line.name}
          {line.qty > 1 ? ` ×${line.qty}` : ''}
        </div>
        {line.staple && line.staple.options.length > 0 && (
          <div className="tiny ink2">Any of: {line.staple.options.slice(0, 4).join(', ')}{line.staple.options.length > 4 ? '…' : ''}, or something new</div>
        )}
        <div className="tiny muted">
          {line.always ? '★ Staple · ' : ''}
          {line.why === 'out' ? <span className="bad">Out</span> : line.why === 'low' ? <span className="warn">Low</span> : 'Added'}
          {line.price != null ? ` · ${usd(line.price)} ${line.priceFrom ? `· ${line.priceFrom}` : ''}` : ''}
        </div>
      </div>
      {onRemove && (
        <button className="icon-btn" onClick={onRemove} aria-label={`Remove ${line.name}`}>
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

// ---------------- pantry ----------------

export function PantryView({ data }: { data: AppData }) {
  const toast = useToast();
  const [bulk, setBulk] = useState(false);
  const [fromReceipts, setFromReceipts] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [filter, setFilter] = useState<'all' | 'low'>('all');
  const items = data.pantry.filter((p) => filter === 'all' || stockOf(p) !== 'ok');
  // staples sit on their own at the top; everything else by aisle
  const always = items.filter((p) => p.always).sort((a, b) => a.name.localeCompare(b.name));
  const others = items.filter((p) => !p.always);
  const groups = new Map<GroceryDept, PantryItem[]>();
  for (const p of others) groups.set(p.dept, [...(groups.get(p.dept) ?? []), p]);
  const lowCount = data.pantry.filter((p) => stockOf(p) !== 'ok').length;
  const [stapleEdit, setStapleEdit] = useState<Staple | 'new' | null>(null);
  const staples = stapleStatus(data.staples, data.pantry);
  const [newStapleName, setNewStapleName] = useState('');
  const suggest = (data.groceries?.usual ?? []).filter((u) => !data.pantry.some((p) => p.always && (p.key === u.key || p.name.toLowerCase() === u.name.toLowerCase())));
  const addStaple = async (name: string, key?: string) => {
    const clean = name.trim();
    if (!clean) return;
    const existing = data.pantry.find((p) => (key && p.key === key) || p.name.toLowerCase() === clean.toLowerCase());
    await savePantryItem(existing ? { ...existing, always: true } : { ...newPantryItem(clean, key ? { key } : {}, data.itemRules), always: true });
    setNewStapleName('');
    toast(`${existing?.name ?? clean} is a staple`);
  };

  const row = (p: PantryItem) => {
    const st = stockOf(p);
    return (
      <div key={p.id} className="list-item pantry-row">
        <button className="grow pantry-name" onClick={() => setEditing(p)}>
          <div className="strong small">{p.name}</div>
          <div className={`tiny ${st === 'out' ? 'bad' : st === 'low' ? 'warn' : 'muted'}`}>
            {p.mode === 'level' ? LEVEL_LABEL[p.level] : `${num(p.qty)} ${p.unit}`}
            {p.stapleId ? ` · swaps with ${data.staples.find((x) => x.id === p.stapleId)?.name ?? 'similar'}` : st !== 'ok' ? ' · on your list' : ''}
          </div>
        </button>
        {p.mode === 'level' ? (
          <div className="level-pills" role="group" aria-label={`${p.name} level`}>
            {LEVELS.map((l) => (
              <button key={l} className={`level-pill ${l}${p.level === l ? ' on' : ''}`} onClick={() => void savePantryItem({ ...p, level: l })} aria-pressed={p.level === l}>
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        ) : (
          <div className="stepper">
            <button className="icon-btn" onClick={() => step(p, -1)} aria-label={`Use some ${p.name}`}>
              <Minus size={16} />
            </button>
            <span className="num strong small">{num(p.qty)}</span>
            <button className="icon-btn" onClick={() => step(p, 1)} aria-label={`Add ${p.name}`}>
              <Plus size={16} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const step = (p: PantryItem, dir: 1 | -1) => {
    if (p.mode === 'level') return void savePantryItem({ ...p, level: nextLevel(p.level, dir === 1 ? -1 : 1) });
    const by = p.mode === 'count' ? 1 : p.unit === 'lb' || p.unit === 'gal' ? 0.25 : p.unit === 'oz' ? 2 : 1;
    void savePantryItem({ ...p, qty: Math.max(0, round2(p.qty + dir * by)) });
  };

  if (!data.pantry.length) {
    return (
      <div className="card">
        <Empty icon={<ListPlus className="big" />} title="What do you keep at home?">
          Type a quick list. Count things like eggs, weigh things like rice, and just mark things like milk Full, Half, Low or Out.
        </Empty>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => setBulk(true)}>
            <ListPlus /> Add What You Have
          </button>
          {data.receipts.length > 0 && (
            <button className="btn" onClick={() => setFromReceipts(true)}>
              <Sparkles /> From My Receipts
            </button>
          )}
        </div>
        {bulk && <BulkAdd data={data} onClose={() => setBulk(false)} />}
        {fromReceipts && <PastItemsSheet data={data} onClose={() => setFromReceipts(false)} />}
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <div style={{ minWidth: 200, flex: 1, maxWidth: 320 }}>
          <Segmented
            value={filter}
            options={[
              { value: 'all', label: `All (${data.pantry.length})` },
              { value: 'low', label: `Low & Out (${lowCount})` },
            ]}
            onChange={setFilter}
          />
        </div>
        <div className="row gap-s">
          {data.receipts.length > 0 && (
            <button className="btn small" onClick={() => setFromReceipts(true)}>
              <Sparkles /> From Receipts
            </button>
          )}
          <button className="btn primary small" onClick={() => setBulk(true)}>
            <Plus /> Add
          </button>
        </div>
      </div>
      <div className="card" style={{ padding: '10px 14px' }}>
        <div className="eyebrow" style={{ margin: '4px 0' }}>
          Staples
        </div>
        <div className="tiny muted">What you always get. They go on your list as soon as they run low.</div>
        {always.length > 0 && <div className="list mt-s">{always.map(row)}</div>}
        {staples.length > 0 && (
          <div className="list">
            {staples.map(({ staple, items, stock }) => (
              <button key={staple.id} className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => setStapleEdit(staple)}>
                <div className="grow">
                  <div className="strong small">{staple.name}</div>
                  <div className="tiny muted ellipsis">Any of: {items.length ? items.map((p) => `${p.name} (${p.mode === 'level' ? LEVEL_LABEL[p.level] : `${num(p.qty)} ${p.unit}`})`).join(' · ') : 'nothing yet'}</div>
                </div>
                <span className={`tiny strong ${stock === 'out' ? 'bad' : stock === 'low' ? 'warn' : 'good'}`}>{stock === 'out' ? 'Out' : stock === 'low' ? 'Low' : 'Stocked'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="row mt-s" style={{ gap: 6 }}>
          <div className="grow">
            <TextInput value={newStapleName} onChange={setNewStapleName} placeholder="Add a staple: milk, bread, coffee…" onEnter={() => void addStaple(newStapleName)} />
          </div>
          <button className="btn primary small" disabled={!newStapleName.trim()} onClick={() => void addStaple(newStapleName)} aria-label="Add staple">
            <Plus />
          </button>
        </div>
        {suggest.length > 0 && (
          <div className="mt-s">
            <div className="tiny muted">You get these most trips:</div>
            <div className="row wrap mt-s" style={{ gap: 6 }}>
              {suggest.slice(0, 10).map((u) => (
                <button key={u.key} className="chip" onClick={() => void addStaple(u.name, u.key)}>
                  ☆ {u.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <button className="btn ghost small mt-s" onClick={() => setStapleEdit('new')}>
          <Plus /> Swap Group
        </button>
        <span className="tiny muted"> For things where any one will do, like air fryer food.</span>
      </div>
      {others.length > 0 && <div className="eyebrow" style={{ margin: '4px 2px 0' }}>Everything Else</div>}
      {[...groups.entries()]
        .sort((a, b) => DEPT_LABEL[a[0]].localeCompare(DEPT_LABEL[b[0]]))
        .map(([dept, list]) => (
          <div key={dept} className="card" style={{ padding: '10px 14px' }}>
            <div className="eyebrow" style={{ margin: '4px 0' }}>
              {DEPT_LABEL[dept]}
            </div>
            <div className="list">{list.map(row)}</div>
          </div>
        ))}
      <p className="tiny muted">Receipts ask what’s still in your kitchen before anything goes here. Tap an item to change how it’s tracked or make it a staple.</p>
      {bulk && <BulkAdd data={data} onClose={() => setBulk(false)} />}
      {fromReceipts && <PastItemsSheet data={data} onClose={() => setFromReceipts(false)} />}
      {editing && <PantryEditor data={data} item={editing} onClose={() => setEditing(null)} />}
      {stapleEdit && <StapleSheet data={data} staple={stapleEdit === 'new' ? null : stapleEdit} onClose={() => setStapleEdit(null)} />}
    </div>
  );
}

function BulkAdd({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const parsed = parseQuickAdd(text, data.itemRules);
  return (
    <Sheet
      title="Add to Your Pantry"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!parsed.length}
            onClick={async () => {
              await savePantryItems(parsed);
              toast(`Added ${parsed.length} item${parsed.length === 1 ? '' : 's'}`);
              onClose();
            }}
          >
            Add {parsed.length || ''}
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <p className="small ink2" style={{ margin: 0 }}>
          One per line. Add a number to count it, a number and unit to measure it, or nothing to just track Full / Half / Low / Out.
        </p>
        <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'eggs 12\nrice 5 lb\nsoup 4 cans\nmilk\ncoffee low\npeanut butter'} style={{ minHeight: 170, padding: 12, lineHeight: 1.5 }} />
        {parsed.length > 0 && (
          <div className="list">
            {parsed.map((p) => (
              <div key={p.id} className="list-item small">
                <div className="grow strong">{p.name}</div>
                <div className="muted">{p.mode === 'level' ? LEVEL_LABEL[p.level] : `${num(p.qty)} ${p.unit}`}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function PantryEditor({ data, item, onClose }: { data: AppData; item: PantryItem; onClose: () => void }) {
  const ask = useConfirm();
  const [p, setP] = useState(item);
  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              if (await ask({ title: `Remove ${item.name}?`, body: 'It comes off your pantry and your list.', confirm: 'Remove', danger: true })) {
                await deletePantryItem(item.id);
                onClose();
              }
            }}
          >
            <Trash2 /> Remove
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await savePantryItem(p);
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <Field label="Name">
          <TextInput value={p.name} onChange={(v) => setP({ ...p, name: v })} />
        </Field>
        <Field label="Keep Track By">
          <Segmented
            value={p.mode}
            options={[
              { value: 'count', label: 'Count' },
              { value: 'amount', label: 'Amount' },
              { value: 'level', label: 'Level' },
            ]}
            onChange={(v) => setP({ ...p, mode: v, unit: v === 'amount' ? (p.unit === 'ct' ? 'lb' : p.unit) : v === 'count' ? 'ct' : p.unit })}
          />
        </Field>
        {p.mode === 'level' ? (
          <Field label="How Much Is Left">
            <Segmented value={p.level} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} onChange={(v) => setP({ ...p, level: v })} />
          </Field>
        ) : (
          <>
            <div className="form-grid two">
              <Field label="On Hand">
                <NumberInput value={p.qty} onChange={(v) => setP({ ...p, qty: Math.max(0, v ?? 0) })} />
              </Field>
              <Field label="Unit">
                <select className="input" value={p.unit} onChange={(e) => setP({ ...p, unit: e.target.value })}>
                  {(p.mode === 'count' ? ['ct', 'can', 'bag', 'box', 'bottle', 'jar', 'pack', 'roll', 'loaf', 'pouch', 'bar'] : ['lb', 'oz', 'gal', 'qt', 'L', 'g', 'kg', 'cup']).map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="form-grid two">
              <Field label="One Purchase Adds" hint="A dozen eggs = 12">
                <NumberInput value={p.perBuy} onChange={(v) => setP({ ...p, perBuy: Math.max(0, v ?? 1) })} />
              </Field>
              <Field label="On the List At" hint="When you’re down to this">
                <NumberInput value={p.lowAt} onChange={(v) => setP({ ...p, lowAt: Math.max(0, v ?? 0) })} />
              </Field>
            </div>
          </>
        )}
        <ToggleRow title="Staple" hint="Something you always get. It stays at the top and goes on your list as soon as it runs low." on={!!p.always} onChange={(v) => setP({ ...p, always: v })} />
        <Field label="Swaps With" hint="Optional: any one of a group will do (like air fryer food)">
          <StaplePicker data={data} value={p.stapleId ?? null} onChange={(id) => setP({ ...p, stapleId: id })} />
        </Field>
        <Field label="Aisle">
          <select className="input" value={p.dept} onChange={(e) => setP({ ...p, dept: e.target.value as GroceryDept })}>
            {Object.entries(DEPT_LABEL)
              .filter(([k]) => !NON_GROCERY_DEPTS.includes(k as GroceryDept))
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </Field>
      </div>
    </Sheet>
  );
}
