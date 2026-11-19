// Autopilot: Pebbles does the thinking and tells you what to move on payday.
// Moves are checked off by you, or automatically when the bank data shows them.
import { addDays, diffDays } from './dates';
import { categoryOf } from './categories';
import type { PaycheckPlan } from './budget';
import type { Period } from './pay';
import { round2, usd } from './money';
import type { Goal, ISODate, MoveState, Transaction } from './types';

export type MoveKey = 'save' | 'bills' | 'essentials' | 'spend' | 'bonus';

export interface Move {
  key: MoveKey;
  title: string;
  detail: string;
  amount: number;
  checkable: boolean;
  done: boolean;
  auto: boolean;
}

export function moveId(period: Period, key: MoveKey): string {
  return `${period.start}:${key}`;
}

export function paydayMoves(opts: {
  period: Period;
  plan: PaycheckPlan;
  goals: Goal[];
  savingsName: string; // e.g. "Marcus"
  states: Map<string, MoveState>;
  bonusMonth: boolean;
}): Move[] {
  const { period, plan, goals, savingsName, states, bonusMonth } = opts;
  const st = (k: MoveKey) => states.get(moveId(period, k));
  const goalName = (id: string) => goals.find((g) => g.id === id)?.name ?? 'a goal';
  const moves: Move[] = [];
  if (plan.savings > 0) {
    const split = plan.allocations.map((a) => `${goalName(a.goalId)} ${usd(a.amount, true)}`).join(' · ');
    moves.push({
      key: 'save',
      title: `Move ${usd(plan.savings, true)} to ${savingsName}`,
      detail: split ? `For ${split}` : 'Into savings',
      amount: plan.savings,
      checkable: true,
      done: !!st('save')?.done,
      auto: !!st('save')?.auto,
    });
  }
  if (plan.bills > 0) {
    const due = plan.billsDue.slice(0, 4).map((b) => `${b.bill.name} ${b.date.slice(5).replace('-', '/')}`);
    moves.push({
      key: 'bills',
      title: `Leave ${usd(plan.bills, true)} in checking for bills`,
      detail: due.length ? `Coming up: ${due.join(', ')}${plan.billsDue.length > 4 ? '…' : ''}` : 'Your share of this month’s bills',
      amount: plan.bills,
      checkable: false,
      done: false,
      auto: false,
    });
  }
  if (plan.essentials > 0)
    moves.push({
      key: 'essentials',
      title: `Keep ${usd(plan.essentials, true)} for groceries & gas`,
      detail: 'Already counted at today’s prices',
      amount: plan.essentials,
      checkable: false,
      done: false,
      auto: false,
    });
  moves.push({
    key: 'spend',
    title: plan.personal > 0 ? `${usd(plan.personal, true)} is yours to spend` : 'Nothing extra this check',
    detail: plan.personal > 0 ? `About ${usd(plan.personalPerDay, true)} a day until next payday. Guilt-free.` : 'Bills and essentials are covered first.',
    amount: Math.max(0, plan.personal),
    checkable: false,
    done: false,
    auto: false,
  });
  if (bonusMonth && plan.personal > 50) {
    const extra = round2(Math.floor((plan.personal * 0.5) / 5) * 5);
    moves.push({
      key: 'bonus',
      title: `Bonus paycheck month: move ${usd(extra, true)} more to ${savingsName}`,
      detail: 'Your bills are covered by the other two checks this month.',
      amount: extra,
      checkable: true,
      done: !!st('bonus')?.done,
      auto: !!st('bonus')?.auto,
    });
  }
  return moves;
}

/** A paycheck deposit near payday, if the bank data shows one. */
export function findPaycheckDeposit(txns: Transaction[], payday: ISODate, expected: number): Transaction | null {
  const candidates = txns.filter(
    (t) =>
      t.amount > 0 &&
      !t.pending &&
      t.category === 'paycheck' &&
      Math.abs(diffDays(t.date, payday)) <= 3 &&
      Math.abs(t.amount - expected) <= Math.max(150, expected * 0.35),
  );
  candidates.sort((a, b) => Math.abs(a.amount - expected) - Math.abs(b.amount - expected));
  return candidates[0] ?? null;
}

/** A transfer to savings after payday that matches the planned amount. */
export function findSavingsTransfer(txns: Transaction[], payday: ISODate, planned: number, goalsAccountId: string | null): Transaction | null {
  if (planned <= 0) return null;
  const end = addDays(payday, 7);
  const hits = txns.filter((t) => {
    if (t.date < addDays(payday, -1) || t.date > end) return false;
    const intoSavingsAccount = goalsAccountId != null && t.accountId === goalsAccountId && t.amount > 0 && !/INTEREST/i.test(t.description);
    const outOfChecking = t.amount < 0 && categoryOf(t.category).id === 'savings';
    if (!intoSavingsAccount && !outOfChecking) return false;
    const amt = Math.abs(t.amount);
    return amt >= planned * 0.8 && amt <= planned * 1.5 + 5;
  });
  return hits[0] ?? null;
}
