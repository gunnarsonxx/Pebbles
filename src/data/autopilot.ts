// Autopilot: keeps your goals and paychecks in step with the bank, so the only
// thing you do is move the money Pebbles tells you to.
import { store } from './store';
import { emergencyGoalUpdate } from '../core/emergency';
import { looksVariable } from '../core/billPrompt';
import { baseName, cleanItemName, fullName, plainNameFor } from '../core/groceries';
import { knownTotal, paypalPurchases } from '../core/paypal';
import { computeData } from './useData';
import { today } from '../core/dates';
import { dedupePaypal } from '../core/paypal';
import { findPaycheckDeposit, findSavingsTransfer, moveId, type MoveKey } from '../core/moves';
import { goalsAccount, interestContributions, syncGoalsWithAccount, type Weight } from '../core/savingsAccount';
import { addDays } from '../core/dates';
import { periodByIndex, periodContaining } from '../core/pay';
import type { Allocation, PaycheckPlan } from '../core/budget';
import type { Period } from '../core/pay';
import type { Contribution, PaycheckRecord } from '../core/types';

export function paycheckContributions(period: Period, allocations: Allocation[], date: string): Contribution[] {
  return allocations
    .filter((a) => a.amount > 0)
    .map((a) => ({ id: `pc|${period.start}|${a.goalId}`, goalId: a.goalId, amount: a.amount, date, note: 'From paycheck', paycheckId: period.start, kind: 'deposit' as const }));
}

/** Check (or uncheck) a payday move. Checking "move to savings" drops the pebbles into your goals. */
export async function setMove(period: Period, plan: PaycheckPlan, key: MoveKey, done: boolean, auto = false, bankTracks = false): Promise<void> {
  await store.put('moves', { id: moveId(period, key), done, at: Date.now(), auto });
  if (key !== 'save' && key !== 'bonus') return;
  const existing = store.list('contributions').filter((c) => c.paycheckId === period.start && c.kind !== 'interest');
  if (key === 'save') {
    const mine = existing.filter((c) => c.id.startsWith('pc|'));
    // when the bank shows the transfer, the real deposit fills the goals instead (see syncGoalsWithAccount)
    const fromBank = store.list('contributions').some((c) => c.paycheckId === period.start && c.id.startsWith('dep|'));
    if (done && !mine.length && !fromBank && !(auto && bankTracks)) await store.putMany('contributions', paycheckContributions(period, plan.allocations, today() < period.payday ? period.payday : today()));
    if (!done && mine.length) await store.remove('contributions', mine.map((c) => c.id));
  }
}

export async function setBonusMove(period: Period, amount: number, goalId: string | null, done: boolean): Promise<void> {
  await store.put('moves', { id: moveId(period, 'bonus'), done, at: Date.now(), auto: false });
  const id = `bonus|${period.start}`;
  if (done && goalId && amount > 0)
    await store.put('contributions', { id, goalId, amount, date: today(), note: 'Bonus paycheck', paycheckId: period.start, kind: 'deposit' });
  if (!done && store.get('contributions', id)) await store.remove('contributions', id);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function startAutopilot() {
  store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runAutopilot(), 2500);
  });
  setTimeout(() => void runAutopilot(), 3000);
}

export async function runAutopilot(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const d = computeData(store.version, today());
    if (!d.settings.onboarded) return;

    // 0a) utility bills change every month: ask for the amount on the 9th at 10am (once, as a starting point)
    if (!(await store.getMeta<boolean>('billPromptSetup:v1'))) {
      const util = d.bills.filter((b) => b.active && !b.amountReminder && looksVariable(b));
      if (util.length) await store.putMany('bills', util.map((b) => ({ ...b, amountReminder: { day: 9, time: '10:00' } })));
      await store.setMeta('billPromptSetup:v1', true);
    }

    // 0b) receipts and pantry items saved before plain names: "King Soopers City Market Vitamin D" → Milk
    if (!(await store.getMeta<boolean>('baseNames:v1'))) {
      const recs = store.list('receipts').flatMap((r) => {
        let changed = false;
        const items = r.items.map((i) => {
          const c = plainNameFor(i.name);
          if (!c) return i;
          changed = true;
          return { ...i, name: c.name, key: c.key };
        });
        return changed ? [{ ...r, items }] : [];
      });
      if (recs.length) await store.putMany('receipts', recs);
      const pan = store.list('pantry').flatMap((p) => {
        const c = plainNameFor(p.name);
        return c ? [{ ...p, name: c.name, key: c.key }] : [];
      });
      if (pan.length) await store.putMany('pantry', pan);
      await store.setMeta('baseNames:v1', true);
    }

    // 0b2) coffee drinks and pods were read as plain "Coffee" before; and keep each line's full name
    if (!(await store.getMeta<boolean>('baseNames:v2'))) {
      const recs = store.list('receipts').flatMap((r) => {
        let changed = false;
        const items = r.items.map((i) => {
          const full = i.desc || fullName(i.raw || '');
          const again = full ? cleanItemName(full) : null;
          const fix = i.name === 'Coffee' && again && again.name !== 'Coffee' ? { name: again.name, key: again.key } : {};
          if (!Object.keys(fix).length && i.desc) return i;
          changed = true;
          return { ...i, ...fix, desc: i.desc || full || undefined };
        });
        return changed ? [{ ...r, items }] : [];
      });
      if (recs.length) await store.putMany('receipts', recs);
      await store.setMeta('baseNames:v2', true);
    }

    // 0b3) undo a mix-up: adding "Coffee" from a receipt could land on "Coffee Creamer" and give it the coffee's description
    if (!(await store.getMeta<boolean>('pantryDesc:v1'))) {
      const fix = store.list('pantry').filter((p) => {
        if (!p.desc) return false;
        const fromDesc = baseName(cleanItemName(p.desc).name);
        const own = baseName(p.name);
        return !!fromDesc && !!own && fromDesc !== own;
      });
      if (fix.length) await store.putMany('pantry', fix.map((p) => ({ ...p, desc: undefined })));
      await store.setMeta('pantryDesc:v1', true);
    }

    // 0) a PayPal purchase shows up at PayPal and at your bank: count it once
    const dups = dedupePaypal(d.txns, d.accounts);
    if (dups.length) {
      const byId = new Map(d.txns.map((t) => [t.id, t]));
      await store.putMany(
        'transactions',
        dups.filter((u) => byId.has(u.id)).map((u) => ({ ...byId.get(u.id)!, ...u.patch })),
      );
    }

    // 0c) a new PayPal purchase: note the paying bank's balance now, to tell when the bank has taken it out
    if (d.paypalFrom) {
      const from = d.paypalFrom;
      const now = from.available ?? from.balance;
      const fresh = paypalPurchases(d.txns, d.accounts, d.today).filter((t) => !t.seenBank || t.seenBank.accountId !== from.id);
      if (fresh.length && now != null) {
        const known = knownTotal(d.txns, from.id);
        await store.putMany('transactions', fresh.map((t) => ({ ...t, seenBank: { accountId: from.id, available: now, known } })));
      }
    }

    // 1) interest paid into the goals account → pebbles in each goal
    const acct = goalsAccount(d.accounts);
    const interest = interestContributions(d.txns, acct, d.goals, d.contributions, d.balances);
    if (interest.length) await store.putMany('contributions', interest);

    // 1b) the goals account is the truth: deposits split by plan, goals add up to the balance
    if (acct) {
      const key = `goalsSyncSince:${acct.id}`;
      let since = await store.getMeta<string>(key);
      if (!since) {
        since = d.today;
        await store.setMeta(key, since);
      }
      const planWeights: Weight[] = d.plan.allocations.map((a) => ({ goalId: a.goalId, w: a.amount }));
      const fresh = computeData(store.version, today());
      const res = syncGoalsWithAccount({
        account: acct,
        txns: fresh.txns,
        goals: fresh.goals,
        contributions: fresh.contributions,
        since,
        planWeights,
        paycheckFor: (date) => {
          const base = periodContaining(fresh.settings.pay, date);
          for (const k of [0, -1, 1]) {
            const p = periodByIndex(fresh.settings.pay, base.index + k);
            if (date >= addDays(p.payday, -2) && date <= addDays(p.payday, 10)) {
              const rec = fresh.paychecks.get(p.start);
              return { periodStart: p.start, weights: (rec?.goalAllocations ?? []).map((a) => ({ goalId: a.goalId, w: a.amount })) };
            }
          }
          return null;
        },
      });
      if (res.remove.length) await store.remove('contributions', res.remove);
      if (res.put.length) await store.putMany('contributions', res.put);
    }

    // 1c) the Bedrock fund steps up on its own: starter month → full fund, following your expenses
    {
      const fresh = computeData(store.version, today());
      const em = fresh.emergency;
      const goal = em ? fresh.goals.find((g) => g.id === em.goalId) : undefined;
      const patch = goal && em ? emergencyGoalUpdate(goal, em) : null;
      if (goal && patch) await store.put('goals', { ...goal, ...patch });
    }

    // 2) the paycheck landed → record it
    const m = d.movesFor;
    if (m && m.period.payday <= d.today) {
      const rec = d.paychecks.get(m.period.start);
      if (!rec?.received) {
        const deposit = findPaycheckDeposit(d.txns, m.period.payday, m.estimate.net);
        if (deposit) {
          const paycheck: PaycheckRecord = {
            id: m.period.start,
            periodStart: m.period.start,
            payday: m.period.payday,
            estimatedNet: m.estimate.net,
            estimatedNetRaw: m.estimate.withholding.net,
            estimatedGross: m.estimate.gross.gross,
            actualNet: deposit.amount,
            actualGross: rec?.actualGross ?? null,
            received: true,
            savingsOverride: rec?.savingsOverride ?? null,
            split: { bills: m.plan.bills, essentials: m.plan.essentials, savings: m.plan.savings, personal: m.plan.personal },
            goalAllocations: m.plan.allocations.map((a) => ({ goalId: a.goalId, amount: a.amount })),
            note: 'Recorded automatically from your bank',
          };
          await store.put('paychecks', paycheck);
        }
      }
      // 3) you moved the savings → check it off and fill the goals
      const saveState = store.get('moves', moveId(m.period, 'save'));
      if (!saveState?.done && m.plan.savings > 0) {
        const transfer = findSavingsTransfer(d.txns, m.period.payday, m.plan.savings, acct?.id ?? null);
        if (transfer) await setMove(m.period, m.plan, 'save', true, true, acct?.source === 'plaid' || transfer.accountId === acct?.id);
      }
    }
  } catch (e) {
    console.warn('autopilot', e);
  } finally {
    running = false;
  }
}
