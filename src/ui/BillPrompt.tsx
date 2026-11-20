import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { NumberInput, Sheet, useToast } from './components';
import { saveBill } from '../data/actions';
import { duePrompts, nextPromptTime, postedAmount, saveAmount, snooze } from '../core/billPrompt';
import { fmtDay } from '../core/dates';
import { usd } from '../core/money';
import type { AppData } from '../data/useData';

/** Pops up when a bill that changes every month (utilities) needs this month's amount. */
export function BillAmountPrompt({ data }: { data: AppData }) {
  const toast = useToast();
  const [now, setNow] = useState(() => new Date());
  const [skipped, setSkipped] = useState<Set<string>>(new Set()); // closed without answering: ask again next time Pebbles opens
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);
  // wake right at the next prompt time (10:00 on the dot, or when a snooze ends)
  useEffect(() => {
    const next = data.bills.map((b) => nextPromptTime(b, now)?.getTime() ?? Infinity).reduce((a, b) => Math.min(a, b), Infinity);
    if (!isFinite(next)) return;
    const t = setTimeout(() => setNow(new Date()), Math.min(Math.max(250, next - Date.now() + 250), 3_600_000));
    return () => clearTimeout(t);
  }, [data.bills, now]);
  const due = data.settings.onboarded ? duePrompts(data.bills, now).find((b) => !skipped.has(b.id)) : undefined;
  // don't pop up on top of something you're in the middle of (another sheet); check again shortly
  const [shownId, setShownId] = useState<string | null>(null);
  useEffect(() => {
    if (!due || shownId === due.id) return;
    const check = () => {
      if (!document.querySelector('.scrim')) setShownId(due.id);
    };
    check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, [due?.id, shownId]);
  const bill = due && shownId === due.id ? due : undefined;
  const posted = bill ? postedAmount(bill, data.txns, now) : null;
  const [amount, setAmount] = useState<number | null>(null);
  useEffect(() => setAmount(posted?.amount ?? null), [bill?.id, posted?.amount]);
  // desktop left open in the background: a system notification at prompt time
  useEffect(() => {
    if (!bill || !document.hidden) return;
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(`Has ${bill.name} Posted?`, { body: 'Open Pebbles to enter this month’s amount.' });
    } catch {
      /* not available */
    }
  }, [bill?.id]);
  if (!bill) return null;
  const month = now.toLocaleDateString('en-US', { month: 'long' });

  return (
    <Sheet
      title={`Has ${bill.name} Posted?`}
      onClose={() => setSkipped(new Set(skipped).add(bill.id))}
      footer={
        <>
          <button
            className="btn"
            onClick={async () => {
              await saveBill(snooze(bill, new Date()));
              toast(`OK. Pebbles will ask about ${bill.name} again in 24 hours.`);
            }}
          >
            Not Posted
          </button>
          <button
            className="btn primary"
            disabled={!amount || amount <= 0}
            onClick={async () => {
              if (!amount) return;
              await saveBill(saveAmount(bill, amount, new Date()));
              toast(`${bill.name} set to ${usd(amount)}. The plan and Bills card use it now.`);
            }}
          >
            Save Amount
          </button>
        </>
      }
    >
      <div className="col gap-l">
        <div className="row gap-s">
          <Zap style={{ color: 'var(--citrine, var(--warn))' }} />
          <p className="small ink2" style={{ margin: 0 }}>
            {bill.name} changes every month. Enter {month}’s amount from the bill so Pebbles sets aside the right amount.
          </p>
        </div>
        <NumberInput value={amount} onChange={setAmount} prefix="$" placeholder={bill.amount.toFixed(2)} allowEmpty ariaLabel={`${bill.name} amount`} />
        <div className="small muted">
          Last amount: {usd(bill.amount)}
          {posted ? ` · your bank shows ${usd(posted.amount)} on ${fmtDay(posted.date)}` : ''}
        </div>
        {posted && amount !== posted.amount && (
          <button className="btn ghost small" onClick={() => setAmount(posted.amount)}>
            Use {usd(posted.amount)} From Your Bank
          </button>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>Not posted yet? Tap Not Posted and Pebbles asks again in 24 hours.</p>
      </div>
    </Sheet>
  );
}
