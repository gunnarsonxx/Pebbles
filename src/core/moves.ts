// Autopilot: Pebbles does the thinking and tells you what to move on payday.
// Moves are checked off by you, or automatically when the bank data shows them.
import { addDays, diffDays } from './dates';
import { categoryOf } from './categories';
import type { PaycheckPlan } from './budget';
import type { Period } from './pay';
import { round2, usd } from './money';
import type { Goal, ISODate, MoveState, Transaction } from './types';

export type MoveKey = 'save' | 'bills' | 'essentials' | 'spend' | 'bonus' | 'sweep';

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
  billsAccountName?: string | null; // a bills-only account you top up from each check
  billsThrough?: ISODate; // the top-up covers bills due before this payday
  billsSteady?: boolean; // the same amount every check
  sweep?: { amount: number; from: string } | null; // last check's money you didn't spend, to save
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
  if (opts.sweep && opts.sweep.amount > 0) {
    moves.push({
      key: 'sweep',
      title: `Move ${usd(opts.sweep.amount, true)} Left Over in ${opts.sweep.from} to ${savingsName}`,
      detail: 'Grocery, gas and fun money from last check that you didn’t spend. It goes to your goals instead of sitting there.',
      amount: opts.sweep.amount,
      checkable: true,
      done: !!st('sweep')?.done,
      auto: !!st('sweep')?.auto,
    });
  }
  if (opts.billsAccountName && plan.billsTopUp) {
    const through = opts.billsThrough ? new Date(opts.billsThrough + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'the next payday';
    moves.push(
      plan.bills > 0
        ? {
            key: 'bills',
            title: `Move ${usd(plan.bills, true)} to ${opts.billsAccountName}`,
            detail: opts.billsSteady ? 'The same every check: it pays every bill in full, on time, all year.' : `Tops it up so every bill through ${through} is paid.`,
            amount: plan.bills,
            checkable: true,
            done: !!st('bills')?.done,
            auto: !!st('bills')?.auto,
          }
        : {
            key: 'bills',
            title: `${opts.billsAccountName} Already Covers Bills`,
            detail: `Nothing to move for bills: it holds enough for everything due through ${through}.`,
            amount: 0,
            checkable: false,
            done: false,
            auto: false,
          },
    );
  } else if (plan.bills > 0) {
    const due = plan.billsDue.slice(0, 4).map((b) => `${b.bill.name} ${b.date.slice(5).replace('-', '/')}`);
    moves.push({
      key: 'bills',
      title: `Leave ${usd(plan.bills, true)} in Checking for Bills`,
      detail: due.length ? `Coming up: ${due.join(', ')}${plan.billsDue.length > 4 ? '…' : ''}` : 'Your share of this month’s bills',
      amount: plan.bills,
      checkable: false,
      done: false,
      auto: false,
    });
  }
  // whole dollars that add up: keep = groceries/gas + the rest
  const keep = Math.round(plan.essentials + Math.max(0, plan.personal));
  const groceries = Math.min(keep, Math.round(plan.essentials));
  moves.push({
    key: 'spend',
    title: `Keep ${usd(keep, true)} for You`,
    detail:
      plan.personal > 0
        ? `${usd(groceries, true)} of it for groceries and gas; the other ${usd(keep - groceries, true)} (${usd(plan.personalPerDay, true)} a day) is guilt-free.`
        : `That covers groceries and gas. Nothing extra to play with this check.`,
    amount: plan.essentials + Math.max(0, plan.personal),
    checkable: false,
    done: false,
    auto: false,
  });
  if (bonusMonth && plan.personal > 50) {
    const extra = round2(Math.floor((plan.personal * 0.5) / 5) * 5);
    moves.push({
      key: 'bonus',
      title: `Bonus Paycheck Month: Move ${usd(extra, true)} More to ${savingsName}`,
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
const PAYROLL = /PAYROLL|\bPAYRL\b|DIR(ECT)?\s*DEP|\bDD\b|PAYCHECK|SALARY|\bWAGES?\b|\bADP\b|PAYCHEX|GUSTO|DAYFORCE|CERIDIAN|WORKDAY|PAYLOCITY|PAYCOM|UKG|\bPPD\b/i;
const NOT_PAY = /TRANSFER|XFER|ZELLE|VENMO|CASH\s*APP|PAYPAL|REFUND|INTEREST|MARCUS|GOLDMAN|DAILYPAY|DAILY\s*PAY|REVERSAL/i;
const payerKey = (d: string) =>
  d
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');

/**
 * The deposit that is this paycheck. Banks often post direct deposit a day or two early, sometimes still
 * marked pending, and don't always tag it as a paycheck, so this looks for any payroll-looking deposit near
 * payday, or one from the same payer as an earlier paycheck, close to the expected amount.
 */
export function findPaycheckDeposit(txns: Transaction[], payday: ISODate, expected: number): Transaction | null {
  const payers = new Set(txns.filter((t) => t.amount > 0 && t.category === 'paycheck' && Math.abs(diffDays(t.date, payday)) > 3).map((t) => payerKey(t.description)));
  const candidates = txns.filter((t) => {
    if (t.amount <= 0) return false;
    const days = diffDays(t.date, payday);
    if (days < -4 || days > 3) return false;
    if (Math.abs(t.amount - expected) > Math.max(150, expected * 0.35)) return false;
    const looksLikePay = t.category === 'paycheck' || PAYROLL.test(t.description) || payers.has(payerKey(t.description));
    return looksLikePay && (t.category === 'paycheck' || !NOT_PAY.test(t.description));
  });
  // posted before pending, then closest to what was expected
  candidates.sort((a, b) => Number(!!a.pending) - Number(!!b.pending) || Math.abs(a.amount - expected) - Math.abs(b.amount - expected));
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
