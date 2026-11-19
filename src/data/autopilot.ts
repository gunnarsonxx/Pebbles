// Autopilot: keeps your goals and paychecks in step with the bank, so the only
// thing you do is move the money Pebbles tells you to.
import { store } from './store';
import { computeData } from './useData';
import { today } from '../core/dates';
import { findPaycheckDeposit, findSavingsTransfer, moveId, type MoveKey } from '../core/moves';
import { goalsAccount, interestContributions } from '../core/savingsAccount';
import type { Allocation, PaycheckPlan } from '../core/budget';
import type { Period } from '../core/pay';
import type { Contribution, PaycheckRecord } from '../core/types';

export function paycheckContributions(period: Period, allocations: Allocation[], date: string): Contribution[] {
  return allocations
    .filter((a) => a.amount > 0)
    .map((a) => ({ id: `pc|${period.start}|${a.goalId}`, goalId: a.goalId, amount: a.amount, date, note: 'From paycheck', paycheckId: period.start, kind: 'deposit' as const }));
}

/** Check (or uncheck) a payday move. Checking "move to savings" drops the pebbles into your goals. */
export async function setMove(period: Period, plan: PaycheckPlan, key: MoveKey, done: boolean, auto = false): Promise<void> {
  await store.put('moves', { id: moveId(period, key), done, at: Date.now(), auto });
  if (key !== 'save' && key !== 'bonus') return;
  const existing = store.list('contributions').filter((c) => c.paycheckId === period.start && c.kind !== 'interest');
  if (key === 'save') {
    const mine = existing.filter((c) => c.id.startsWith('pc|'));
    if (done && !mine.length) await store.putMany('contributions', paycheckContributions(period, plan.allocations, today() < period.payday ? period.payday : today()));
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

    // 1) interest paid into the goals account → pebbles in each goal
    const acct = goalsAccount(d.accounts);
    const interest = interestContributions(d.txns, acct, d.goals, d.contributions, d.balances);
    if (interest.length) await store.putMany('contributions', interest);

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
        if (transfer) await setMove(m.period, m.plan, 'save', true, true);
      }
    }
  } catch (e) {
    console.warn('autopilot', e);
  } finally {
    running = false;
  }
}
