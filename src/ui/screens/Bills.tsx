import { useMemo, useState } from 'react';
import { COMMUNITY } from '../../core/edition';
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, Search, Users, X } from 'lucide-react';
import type { AppData } from '../../data/useData';
import { CategoryIcon, Field, NumberInput, Segmented, Sheet, TextInput, ToggleRow, useToast } from '../components';
import { billDueDates, monthlyBillsTotal, monthlyEquivalent, roommateTransfer, yourAmount } from '../../core/budget';
import { detectRecurring, type RecurringCandidate } from '../../core/analytics';
import { CATEGORIES, categoryOf } from '../../core/categories';
import { addDays, addMonths, dayOfWeek, dowName, fmtDay, fmtMonth, makeDate, daysInMonth } from '../../core/dates';
import { usd } from '../../core/money';
import { billsCalendar } from '../../core/ics';
import { periodByIndex } from '../../core/pay';
import { deleteBill, dismissInsight, newBill, saveBill } from '../../data/actions';
import { looksVariable, ym } from '../../core/billPrompt';
import { openTextFile } from '../../platform/files';
import { store } from '../../data/store';
import type { Bill, BillFrequency, ISODate, Transaction } from '../../core/types';

/** Budget → Bills: a month calendar of what's due, your bills, and ones found in your statements. */
export function BillsView({ data }: { data: AppData }) {
  const toast = useToast();
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [editing, setEditing] = useState<Bill | null>(null);
  const [thorough, setThorough] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const dismissed = useMemo(() => new Set([...data.dismissed].filter((d) => d.startsWith('bill:')).map((d) => d.slice(5))), [data.dismissed]);
  const found = detectRecurring(data.txns, data.bills, data.today, { thorough, dismissed });
  const bills = [...data.bills].sort((a, b) => Number(b.active) - Number(a.active) || a.dueDay - b.dueDay);
  const monthly = monthlyBillsTotal(data.bills);
  const rm = roommateTransfer(data.bills);

  // what's due each day this month, plus paydays
  const [y, m] = month.split('-').map(Number);
  const first = makeDate(y, m, 1);
  const last = makeDate(y, m, daysInMonth(y, m));
  const due = new Map<ISODate, { bill: Bill; amount: number }[]>();
  for (const b of data.bills.filter((x) => x.active)) for (const d of billDueDates(b, first, addDays(last, 1))) due.set(d, [...(due.get(d) ?? []), { bill: b, amount: yourAmount(b) }]);
  const paydays = new Set<ISODate>();
  for (let k = -3; k <= 4; k++) {
    const p = periodByIndex(data.settings.pay, data.upcoming.period.index + k);
    if (p.payday >= first && p.payday <= last) paydays.add(p.payday);
  }
  const lead = dayOfWeek(first);
  const cells: (ISODate | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth(y, m) }, (_, i) => makeDate(y, m, i + 1))];
  const monthTotal = [...due.values()].flat().reduce((s, x) => s + x.amount, 0);
  const pickedList = picked ? (due.get(picked) ?? []) : [];

  const addFound = async (r: RecurringCandidate) => {
    await saveBill(
      newBill({
        name: r.name,
        amount: r.amount,
        dueDay: r.dueDay,
        frequency: r.frequency,
        dueMonth: r.frequency === 'yearly' ? Number(r.lastDate.slice(5, 7)) : null,
        anchorDate: r.frequency === 'weekly' || r.frequency === 'biweekly' ? r.lastDate : null,
        category: categoryOf(r.category).group === 'bills' ? r.category : r.category === 'p2p' ? 'housing' : 'subscriptions',
        matchPattern: r.pattern,
        toRoommate: r.category === 'p2p' ? true : undefined,
      }),
    );
    toast(`${r.name} added to bills`);
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
            <ChevronLeft />
          </button>
          <div className="center">
            <div className="strong">{fmtMonth(month)}</div>
            <div className="tiny muted">{usd(monthTotal)} due · your share</div>
          </div>
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
            <ChevronRight />
          </button>
        </div>
        <div className="cal" style={{ marginBottom: 6 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <div key={d} className="cal-dow">
              {dowName(d)}
            </div>
          ))}
        </div>
        <div className="cal">
          {cells.map((d, i) =>
            d ? (
              <button key={d} className={`day bill-day${d === data.today ? ' today' : ''}${picked === d ? ' edited' : ''}`} onClick={() => setPicked(picked === d ? null : d)} aria-label={fmtDay(d)}>
                <span className="d">{Number(d.slice(8))}</span>
                {due.has(d) && (
                  <span className="tiny strong num">
                    {usd(
                      due.get(d)!.reduce((s, x) => s + x.amount, 0),
                      true,
                    )}
                  </span>
                )}
                {paydays.has(d) && <span className="payday-tag">Pay</span>}
              </button>
            ) : (
              <div key={`e${i}`} />
            ),
          )}
        </div>
        {picked && (
          <div className="mt">
            <div className="small strong">{fmtDay(picked)}</div>
            {pickedList.length ? (
              pickedList.map((x) => (
                <div key={x.bill.id} className="row between small" style={{ padding: '4px 0' }}>
                  <span>{x.bill.name}</span>
                  <span className="num">{usd(x.amount)}</span>
                </div>
              ))
            ) : (
              <div className="tiny muted">{paydays.has(picked) ? 'Payday. No bills due.' : 'No bills due.'}</div>
            )}
          </div>
        )}
        <button
          className="btn block mt"
          disabled={!data.bills.some((b) => b.active)}
          onClick={async () => {
            const ics = billsCalendar(data.bills, data.today, data.upcoming.period.payday);
            try {
              await openTextFile('pebbles-bills.ics', 'text/calendar', ics);
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          <CalendarPlus /> Add to Phone Calendar
        </button>
        <p className="tiny muted mt" style={{ marginBottom: 0 }}>
          Opens your calendar app (Samsung Calendar works) with every bill as a repeating event and a reminder the day before, plus your paydays. If you change bills later, add it again.
        </p>
      </div>

      {rm && (
        <div className="card">
          <div className="row gap-s" style={{ marginBottom: 6 }}>
            <Users size={18} style={{ color: 'var(--moss)' }} />
            <div className="eyebrow">Send Your Roommate</div>
          </div>
          <div className="big-number">{usd(rm.send)}</div>
          <div className="small ink2">
            {usd(rm.rent)} rent
            {rm.credits.map((c) => ` − ${usd(c.amount)} their part of ${c.name}`).join('')}
          </div>
          <p className="tiny muted mt" style={{ marginBottom: 0 }}>
            Your budget counts full rent plus only your share of the split bills, which is what you really pay.
          </p>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Your Bills</div>
            <div className="small muted">
              {usd(monthly)} a month · about {usd((monthly * 12) / 26)} per paycheck
            </div>
          </div>
          <button className="btn small" onClick={() => setEditing(newBill())}>
            <Plus /> Add
          </button>
        </div>
        {bills.length ? (
          <div className="list">
            {bills.map((b) => (
              <button key={b.id} className="list-item" onClick={() => setEditing(b)} style={!b.active ? { opacity: 0.5 } : undefined}>
                <CategoryIcon id={b.category} size={34} />
                <div className="grow">
                  <div className="strong ellipsis">{b.name}</div>
                  <div className="tiny muted">
                    {freqLabel(b)}
                    {b.autopay ? ' · autopay' : ''}
                    {b.yourSharePct != null && b.yourSharePct < 100 ? ` · your share ${b.yourSharePct}%` : ''}
                    {b.toRoommate ? ' · paid to roommate' : ''}
                  </div>
                </div>
                <div className="amount">{usd(b.amount)}</div>
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">Add rent, utilities, phone, insurance, car payment and subscriptions. Pebbles sets aside money for each before payday.</p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Found in Your Statements</div>
            <div className="small muted">{thorough ? 'A closer look: amounts that change, Venmo payments and known subscriptions' : 'Charges that repeat on a schedule'}</div>
          </div>
          {!thorough && (
            <button className="btn small" onClick={() => setThorough(true)}>
              <Search /> Look Again
            </button>
          )}
        </div>
        {found.length ? (
          <div className="list">
            {found.slice(0, 15).map((r) => (
              <div key={r.key} className="list-item">
                <CategoryIcon id={r.category} size={30} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small strong ellipsis">{r.name}</div>
                  <div className="tiny muted">
                    {usd(r.amount)} {r.count === 1 ? '· looks like a subscription' : `${r.frequency} · seen ${r.count}×`}
                  </div>
                </div>
                <button className="icon-btn" aria-label={`${r.name} isn't a bill`} title="Not a bill" onClick={() => void dismissInsight(`bill:${r.key}`)}>
                  <X size={16} />
                </button>
                <button className="btn small" onClick={() => void addFound(r)}>
                  <Plus /> Bill
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            {data.txns.length
              ? thorough
                ? 'Nothing else looks like a bill. You can also turn any transaction into a bill from Budget → Spending.'
                : 'Nothing new. Tap Look Again for a closer look.'
              : 'Connect a bank or import statements and Pebbles will find your bills.'}
          </p>
        )}
      </div>

      {editing && <BillSheet bill={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function freqLabel(b: Bill): string {
  const th = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
  switch (b.frequency) {
    case 'monthly':
      return `Monthly on the ${th(b.dueDay)}`;
    case 'yearly':
      return `Yearly · ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(b.dueMonth ?? 1) - 1]} ${b.dueDay} (${usd(monthlyEquivalent(b))}/mo)`;
    case 'semiannual':
      return `Every 6 months · ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][((b.dueMonth ?? 1) - 1) % 12]} ${b.dueDay} (${usd(monthlyEquivalent(b))}/mo)`;
    case 'quarterly':
      return `Every 3 months on the ${th(b.dueDay)}`;
    case 'weekly':
      return 'Weekly';
    case 'biweekly':
      return 'Every 2 weeks';
  }
}

/** A bill made from one transaction in your history. */
export function billFromTransaction(t: Transaction): Bill {
  const name = t.merchant || t.description;
  return newBill({
    name: name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40),
    amount: Math.abs(t.amount),
    dueDay: Number(t.date.slice(8, 10)),
    category: categoryOf(t.category).group === 'bills' ? t.category : t.category === 'p2p' ? 'housing' : 'subscriptions',
    matchPattern: name.toUpperCase().split(' ').slice(0, 2).join(' '),
    toRoommate: t.category === 'p2p' ? true : undefined,
  });
}

export function BillSheet({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [b, setB] = useState(bill);
  const isNew = !store.get('bills', bill.id);
  const billCats = CATEGORIES.filter((c) => c.group === 'bills' || ['transport', 'health', 'pets', 'household'].includes(c.id));
  const split = b.yourSharePct != null && b.yourSharePct < 100;
  return (
    <Sheet
      title={isNew ? 'New Bill' : 'Edit Bill'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button
              className="btn danger"
              onClick={async () => {
                await deleteBill(b.id);
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <button
            className="btn primary"
            disabled={!b.name.trim() || !(b.amount > 0)}
            onClick={async () => {
              // a new utility bill: ask for its amount each month from next month on (you just entered this one)
              const auto = b.amountReminder === undefined && looksVariable(b) ? { amountReminder: { day: 9, time: '10:00', doneMonth: ym(new Date()) } } : {};
              await saveBill({ ...b, ...auto, name: b.name.trim() });
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
          <TextInput value={b.name} onChange={(v) => setB({ ...b, name: v })} placeholder={COMMUNITY ? 'Rent, electric, phone…' : 'Rent, Colorado Springs Utilities, phone…'} autoFocus={!bill.name} />
        </Field>
        <div className="form-grid two">
          <Field label="Amount" hint={split ? 'The full bill' : undefined}>
            <NumberInput value={b.amount} onChange={(v) => setB({ ...b, amount: v ?? 0 })} prefix="$" />
          </Field>
          <Field label="How Often">
            <select className="input" value={b.frequency} onChange={(e) => setB({ ...b, frequency: e.target.value as BillFrequency })}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="semiannual">Every 6 Months</option>
              <option value="quarterly">Every 3 Months</option>
              <option value="biweekly">Every 2 Weeks</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          {(b.frequency === 'monthly' || b.frequency === 'quarterly' || b.frequency === 'semiannual' || b.frequency === 'yearly') && (
            <Field label="Due Day of the Month">
              <NumberInput value={b.dueDay} onChange={(v) => setB({ ...b, dueDay: Math.min(31, Math.max(1, Math.round(v ?? 1))) })} />
            </Field>
          )}
          {(b.frequency === 'yearly' || b.frequency === 'quarterly' || b.frequency === 'semiannual') && (
            <Field label={b.frequency === 'yearly' ? 'Month' : 'A Month It’s Due'} hint={b.frequency === 'semiannual' ? 'Like car insurance: pick either month it renews' : undefined}>
              <select className="input" value={b.dueMonth ?? 1} onChange={(e) => setB({ ...b, dueMonth: Number(e.target.value) })}>
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((mm, i) => (
                  <option key={mm} value={i + 1}>
                    {mm}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(b.frequency === 'weekly' || b.frequency === 'biweekly') && (
            <Field label="A Recent Due Date">
              <input className="input" type="date" value={b.anchorDate ?? ''} onChange={(e) => setB({ ...b, anchorDate: e.target.value || null })} />
            </Field>
          )}
        </div>
        <Field label="Category">
          <div className="row wrap" style={{ gap: 6 }}>
            {billCats.map((c) => (
              <button key={c.id} className={`chip${b.category === c.id ? ' on' : ''}`} onClick={() => setB({ ...b, category: c.id })}>
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Shows Up on Statements As (Optional)" hint="Helps Pebbles recognize the payment">
          <TextInput value={b.matchPattern} onChange={(v) => setB({ ...b, matchPattern: v })} placeholder="e.g. CSU, T-MOBILE, VENMO" />
        </Field>

        <div className="card tint" style={{ padding: 14 }}>
          <div className="strong small" style={{ marginBottom: 8 }}>
            Roommate
          </div>
          <Segmented
            value={b.toRoommate ? 'to' : split ? 'split' : 'mine'}
            options={[
              { value: 'mine', label: 'All Mine' },
              { value: 'split', label: 'Split It' },
              { value: 'to', label: 'I Pay Them' },
            ]}
            onChange={(v) =>
              setB({
                ...b,
                toRoommate: v === 'to' ? true : undefined,
                category: v === 'to' && b.category === 'utilities' ? 'housing' : b.category,
                yourSharePct: v === 'split' ? (split ? b.yourSharePct : 50) : null,
                fromRent: v === 'split' ? (b.fromRent ?? true) : undefined,
              })
            }
          />
          {split && (
            <div className="col gap-l mt">
              <Field label="Your Share" hint={`You pay ${usd(yourAmount(b))} of ${usd(b.amount)}`}>
                <NumberInput value={b.yourSharePct ?? 50} onChange={(v) => setB({ ...b, yourSharePct: Math.min(99, Math.max(1, Math.round(v ?? 50))) })} suffix="%" />
              </Field>
              <ToggleRow title="Take Their Share Out of Rent" hint="You pay the whole bill and send them that much less for rent" on={!!b.fromRent} onChange={(v) => setB({ ...b, fromRent: v })} />
            </div>
          )}
          {b.toRoommate && (
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>
              Rent you send them (by Venmo, say). Split bills you take out of it are subtracted on the Bills page.
            </p>
          )}
        </div>

        <ToggleRow
          title="Ask Me for the Amount Each Month"
          hint="For bills that change, like utilities. Pebbles pops up on the day you pick; Not Posted asks again in 24 hours."
          on={!!b.amountReminder}
          onChange={(v) => setB({ ...b, amountReminder: v ? { day: 9, time: '10:00', ...(bill.amountReminder ?? {}) } : null })}
        />
        {b.amountReminder && (
          <div className="form-grid two">
            <Field label="Day of the Month">
              <NumberInput value={b.amountReminder.day} onChange={(v) => setB({ ...b, amountReminder: { ...b.amountReminder!, day: Math.min(31, Math.max(1, Math.round(v ?? 9))) } })} />
            </Field>
            <Field label="Time">
              <input className="input" type="time" value={b.amountReminder.time} onChange={(e) => setB({ ...b, amountReminder: { ...b.amountReminder!, time: e.target.value || '10:00' } })} />
            </Field>
          </div>
        )}
        <ToggleRow title="Autopay" hint="No reminder needed" on={b.autopay} onChange={(v) => setB({ ...b, autopay: v })} />
        <ToggleRow title="Active" on={b.active} onChange={(v) => setB({ ...b, active: v })} />
        <p className="small muted center">
          {usd(monthlyEquivalent(b))} a month for you · about {usd((monthlyEquivalent(b) * 12) / 26)} per paycheck
        </p>
      </div>
    </Sheet>
  );
}
