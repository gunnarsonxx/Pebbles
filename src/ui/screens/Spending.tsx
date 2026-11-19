import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Upload, Undo2 } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { CategoryBars, MonthBars } from '../charts';
import { CategoryIcon, Empty, Field, Sheet, ToggleRow, TextInput, useToast } from '../components';
import { ImportSheet } from '../sheets/ImportSheet';
import { summarizeMonth, monthsWithData } from '../../core/analytics';
import { addMonths, fmtDay, fmtMonth, fmtShort, monthKey } from '../../core/dates';
import { CATEGORIES, categoryOf, GROUP_LABEL, type CategoryGroup } from '../../core/categories';
import { usd } from '../../core/money';
import { topMerchants } from '../../core/insights';
import { recategorize, undoImport, updateTransaction } from '../../data/actions';
import { GROUP_COLOR } from '../components';
import type { Transaction } from '../../core/types';

export function SpendingScreen({ data }: { data: AppData }) {
  const months = monthsWithData(data.txns);
  const latest = months[months.length - 1] ?? monthKey(data.today);
  const [month, setMonth] = useState<string>(latest);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sum = useMemo(() => summarizeMonth(data.txns, month), [data.txns, month]);
  const series = useMemo(
    () =>
      Array.from({ length: 6 }, (_, k) => addMonths(month, k - 5)).map((m) => {
        const s = summarizeMonth(data.txns, m);
        return { month: m, income: s.income, spending: s.spending };
      }),
    [data.txns, month],
  );

  const groups: CategoryGroup[] = ['bills', 'essentials', 'personal'];
  const catRows = Object.entries(sum.byCategory)
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => {
      const c = categoryOf(id);
      return { id, label: c.name, value, color: GROUP_COLOR[c.group], icon: <CategoryIcon id={id} size={22} /> };
    });

  const monthTxns = data.txns.filter((t) => monthKey(t.date) === month);
  const filtered = monthTxns.filter((t) => (!catFilter || t.category === catFilter) && (!query || (t.description + ' ' + t.merchant).toLowerCase().includes(query.toLowerCase())));
  const visible = showAll ? filtered : filtered.slice(0, 60);
  const merchants = topMerchants(data.txns, month, 5);

  if (!data.txns.length) {
    return (
      <div>
        <div className="card">
          <Empty icon={<Upload className="big" />} title="Bring in your bank statements">
            Pebbles reads CSV, QFX/OFX and PDF statements, sorts every purchase into a category and works out what you bring in and spend each month.
          </Empty>
          <div className="center">
            <button className="btn primary" onClick={() => setImporting(true)}>
              <Upload /> Import statements
            </button>
          </div>
        </div>
        {importing && <ImportSheet data={data} onClose={() => setImporting(false)} />}
      </div>
    );
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="row">
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
            <ChevronLeft />
          </button>
          <h2 style={{ minWidth: 150, textAlign: 'center' }}>{fmtMonth(month)}</h2>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
            <ChevronRight />
          </button>
        </div>
        <button className="btn primary small" onClick={() => setImporting(true)}>
          <Upload /> Import
        </button>
      </div>

      <div className="grid three">
        <Stat label="Money in" value={usd(sum.income, true)} />
        <Stat label="Money out" value={usd(sum.spending, true)} />
        <Stat
          label={sum.net >= 0 ? 'Kept' : 'Overspent'}
          value={usd(Math.abs(sum.net), true)}
          tone={sum.net >= 0 ? 'good' : 'bad'}
          sub={sum.saved > 0 ? `${usd(sum.saved, true)} moved to savings` : undefined}
        />
      </div>

      <div className="grid two mt">
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Last 6 months
          </div>
          <MonthBars data={series} selected={month} onSelect={setMonth} />
        </div>
        <div className="card">
          <div className="card-head">
            <div className="eyebrow">Where it went</div>
            {catFilter && (
              <button className="chip on" onClick={() => setCatFilter(null)}>
                {categoryOf(catFilter).name} ✕
              </button>
            )}
          </div>
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
            {groups.map((g) => (
              <span key={g} className="chip">
                <span className="swatch" style={{ background: GROUP_COLOR[g], marginTop: 0 }} />
                {GROUP_LABEL[g]} {usd(sum.byGroup[g], true)}
              </span>
            ))}
          </div>
          {catRows.length ? <CategoryBars rows={catRows} onPick={(id) => setCatFilter(id === catFilter ? null : id)} /> : <p className="small muted">No spending this month.</p>}
        </div>
      </div>

      {merchants.length > 0 && (
        <div className="card mt">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Top places this month
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {merchants.map((m) => (
              <span key={m.name} className="chip">
                {m.name} · {usd(m.total, true)} · {m.count}×
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card mt">
        <div className="row between wrap" style={{ marginBottom: 6 }}>
          <div className="eyebrow">Transactions</div>
          <div className="input-wrap" style={{ maxWidth: 260, flex: 1 }}>
            <Search size={16} className="prefix" />
            <input className="input has-prefix" style={{ minHeight: 38, paddingLeft: 36 }} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="list">
          {visible.map((t) => (
            <button key={t.id} className="list-item" onClick={() => setEditing(t)}>
              <CategoryIcon id={t.category} />
              <div className="grow">
                <div className="strong ellipsis">{t.merchant || t.description}</div>
                <div className="tiny muted ellipsis">
                  {fmtShort(t.date)} · {categoryOf(t.category).name}
                  {t.excluded ? ' · not counted' : ''}
                </div>
              </div>
              <div className={`amount ${t.amount > 0 ? 'in' : ''}`} style={t.excluded ? { opacity: 0.5 } : undefined}>
                {t.amount > 0 ? '+' : ''}
                {usd(t.amount)}
              </div>
            </button>
          ))}
          {!filtered.length && <p className="small muted" style={{ padding: 12 }}>No transactions match.</p>}
        </div>
        {filtered.length > visible.length && (
          <button className="btn block mt" onClick={() => setShowAll(true)}>
            Show all {filtered.length}
          </button>
        )}
      </div>

      {data.imports.length > 0 && (
        <div className="card mt">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Imported files
          </div>
          <div className="list">
            {data.imports.slice(0, 12).map((i) => (
              <div key={i.id} className="list-item">
                <div className="grow">
                  <div className="strong ellipsis">{i.fileName}</div>
                  <div className="tiny muted">
                    {data.accounts.find((a) => a.id === i.accountId)?.name ?? 'Account'} · {i.count} transactions
                    {i.from ? ` · ${fmtShort(i.from)} – ${fmtShort(i.to ?? i.from)}` : ''}
                  </div>
                </div>
                <button className="btn ghost small" onClick={() => void undoImport(i.id)}>
                  <Undo2 /> Undo
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {importing && <ImportSheet data={data} onClose={() => setImporting(false)} />}
      {editing && <TxnSheet txn={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'good' | 'bad'; sub?: string }) {
  return (
    <div className="card">
      <div className="eyebrow">{label}</div>
      <div className={`big-number ${tone ?? ''}`} style={{ marginTop: 4 }}>
        {value}
      </div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  );
}

function TxnSheet({ txn, onClose }: { txn: Transaction; onClose: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState(txn.category);
  const [remember, setRemember] = useState(true);
  const [excluded, setExcluded] = useState(txn.excluded);
  const [note, setNote] = useState(txn.note);
  const groups: CategoryGroup[] = ['income', 'bills', 'essentials', 'personal', 'savings', 'transfer'];
  return (
    <Sheet
      title={txn.merchant || 'Transaction'}
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          onClick={async () => {
            if (category !== txn.category) {
              const n = await recategorize({ ...txn, excluded, note }, category, remember);
              if (n > 1) toast(`Updated ${n} ${txn.merchant} transactions`);
            }
            const cur = { ...txn, category, excluded, note };
            await updateTransaction(cur);
            onClose();
          }}
        >
          Save
        </button>
      }
    >
      <div className="col gap-l">
        <div className="card tint" style={{ padding: 14 }}>
          <div className="row between">
            <div className="small muted">{fmtDay(txn.date)}</div>
            <div className={`big-number ${txn.amount > 0 ? 'good' : ''}`}>{usd(txn.amount)}</div>
          </div>
          <div className="small ink2" style={{ wordBreak: 'break-word' }}>
            {txn.description}
          </div>
        </div>
        <Field label="Category">
          <div className="col" style={{ gap: 12 }}>
            {groups.map((g) => (
              <div key={g}>
                <div className="tiny muted strong" style={{ marginBottom: 6 }}>
                  {GROUP_LABEL[g]}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {CATEGORIES.filter((c) => c.group === g).map((c) => (
                    <button key={c.id} className={`chip${category === c.id ? ' on' : ''}`} onClick={() => setCategory(c.id)}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Field>
        {category !== txn.category && (
          <ToggleRow title={`Always use this for “${txn.merchant}”`} hint="Applies to past and future imports" on={remember} onChange={setRemember} />
        )}
        <ToggleRow title="Don’t count this" hint="For moving money between your own accounts" on={excluded} onChange={setExcluded} />
        <Field label="Note">
          <TextInput value={note} onChange={setNote} placeholder="Optional" />
        </Field>
      </div>
    </Sheet>
  );
}
