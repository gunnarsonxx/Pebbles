// The paycheck plan: how each check splits into bills, essentials, savings and you.
import { addDays, diffDays, makeDate, parts } from './dates';
import { averageCategory, recentFullMonths } from './analytics';
import { foodPlanMonthly, gasMonthly, inflationSinceReference, currentGasPrice, FOOD_PLAN_LABEL, FALLBACK_GAS_PRICE } from './food';
import { floorTo, round2 } from './money';
import type { Bill, Contribution, Goal, ISODate, MarketData, Settings, Transaction } from './types';

// ---------------- bills ----------------

/** Your part of a bill (all of it unless it's split with a roommate). */
export function yourAmount(b: Bill): number {
  const pct = b.yourSharePct;
  return pct != null && pct >= 0 && pct < 100 ? round2((b.amount * pct) / 100) : b.amount;
}

function perMonth(b: Bill, amount: number): number {
  switch (b.frequency) {
    case 'monthly':
      return amount;
    case 'yearly':
      return amount / 12;
    case 'quarterly':
      return amount / 3;
    case 'weekly':
      return (amount * 52) / 12;
    case 'biweekly':
      return (amount * 26) / 12;
  }
}

/** What a bill costs you per month (your share). */
export function monthlyEquivalent(b: Bill): number {
  return perMonth(b, yourAmount(b));
}

/**
 * Paying rent to a roommate who owes you part of bills in your name: what to send them.
 * Rent (and anything else you pay them) minus their share of the split bills you cover.
 */
export function roommateTransfer(bills: Bill[]): { send: number; rent: number; credits: { name: string; amount: number }[] } | null {
  const active = bills.filter((b) => b.active);
  const to = active.filter((b) => b.toRoommate);
  if (!to.length) return null;
  const rent = round2(to.reduce((s, b) => s + perMonth(b, b.amount), 0));
  const credits = active
    .filter((b) => b.fromRent && b.yourSharePct != null && b.yourSharePct < 100)
    .map((b) => ({ name: b.name, amount: round2(perMonth(b, b.amount - yourAmount(b))) }))
    .filter((c) => c.amount > 0);
  return { send: round2(rent - credits.reduce((s, c) => s + c.amount, 0)), rent, credits };
}

/** All due dates for a bill in [from, to). */
export function billDueDates(b: Bill, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  if (b.frequency === 'weekly' || b.frequency === 'biweekly') {
    const step = b.frequency === 'weekly' ? 7 : 14;
    let d = b.anchorDate ?? from;
    if (d < from) d = addDays(d, Math.ceil(diffDays(from, d) / step) * step);
    else while (diffDays(d, from) >= step) d = addDays(d, -step);
    for (; d < to; d = addDays(d, step)) if (d >= from) out.push(d);
    return out;
  }
  const f = parts(from);
  for (let i = -1; i < 14; i++) {
    const total = f.y * 12 + (f.m - 1) + i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    if (b.frequency === 'yearly' && m !== (b.dueMonth ?? 1)) continue;
    if (b.frequency === 'quarterly' && ((m - (b.dueMonth ?? 1)) % 3 + 3) % 3 !== 0) continue;
    const d = makeDate(y, m, b.dueDay);
    if (d >= from && d < to) out.push(d);
    if (d >= to) break;
  }
  return out;
}

export interface BillDue {
  bill: Bill;
  date: ISODate;
  amount: number;
}

export function billsDueBetween(bills: Bill[], from: ISODate, to: ISODate): BillDue[] {
  return bills
    .filter((b) => b.active)
    .flatMap((b) => billDueDates(b, from, to).map((date) => ({ bill: b, date, amount: yourAmount(b) })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function monthlyBillsTotal(bills: Bill[]): number {
  return round2(bills.filter((b) => b.active).reduce((s, b) => s + monthlyEquivalent(b), 0));
}

// ---------------- essentials ----------------

export interface EssentialsEstimate {
  groceriesMonthly: number;
  groceriesReason: string;
  groceriesActualAvg: number;
  groceriesPlan: number;
  gasMonthly: number;
  gasReason: string;
  gasActualAvg: number;
  otherMonthly: number;
  totalMonthly: number;
  perPaycheck: number;
}

export function estimateEssentials(
  settings: Settings,
  txns: Transaction[],
  market: MarketData | null,
  asOf: ISODate,
  receiptNeed: { monthly: number; reason: string } | null = null,
  drive: { milesPerMonth: number; mpg: number | null; days: number } | null = null,
): EssentialsEstimate {
  // your driving log beats the miles and mpg you guessed in Settings
  const h = drive ? { ...settings.household, milesPerMonth: drive.milesPerMonth, vehicleMpg: drive.mpg ?? settings.household.vehicleMpg } : settings.household;
  const months = recentFullMonths(txns, asOf.slice(0, 7), 3);
  const infl = inflationSinceReference(market);
  const plan = foodPlanMonthly(h, h.foodPlan, infl);
  const thrifty = foodPlanMonthly(h, 'thrifty', infl);
  const actualGroceries = averageCategory(txns, ['groceries'], months);
  let groceries: number;
  let groceriesReason: string;
  if (receiptNeed && receiptNeed.monthly > 0) {
    // your usual needs-based trips from receipts, at today's prices with tax
    groceries = Math.max(receiptNeed.monthly, thrifty);
    groceriesReason = receiptNeed.monthly >= thrifty ? receiptNeed.reason : 'Raised to the USDA Thrifty minimum so your home is always fed';
  } else if (actualGroceries > 0) {
    // what you really spend, nudged for food inflation, but never below the USDA thrifty floor
    const yoy = market?.foodCpi?.yoyPct ?? 0;
    const adjusted = actualGroceries * (1 + Math.max(0, yoy) / 100 / 4);
    groceries = Math.max(adjusted, thrifty);
    groceriesReason =
      adjusted >= thrifty
        ? `Your ${months.length}-month average${yoy > 0 ? `, plus ${yoy.toFixed(1)}% food inflation` : ''}`
        : `Raised to the USDA Thrifty minimum so your home is always fed`;
  } else {
    groceries = plan;
    groceriesReason = `USDA ${FOOD_PLAN_LABEL[h.foodPlan]} plan for your household`;
  }
  const gasCalc = gasMonthly(h, market);
  const actualGas = averageCategory(txns, ['gas'], months);
  let gas: number;
  let gasReason: string;
  if (gasCalc != null) {
    gas = gasCalc;
    const gp = currentGasPrice(market);
    gasReason = `${drive ? 'Your driving log: ' : ''}${h.milesPerMonth} mi ÷ ${h.vehicleMpg} mpg × $${(gp?.price ?? FALLBACK_GAS_PRICE).toFixed(2)}/gal${gp ? '' : ' (typical Colorado price until live prices load)'}`;
  } else if (actualGas > 0) {
    gas = actualGas;
    gasReason = `Your ${months.length}-month average`;
  } else {
    gas = 0;
    gasReason = 'Add your car’s mpg and monthly miles in Settings';
  }
  const other = h.otherEssentialsMonthly || 0;
  const total = round2(groceries + gas + other);
  return {
    groceriesMonthly: round2(groceries),
    groceriesReason,
    groceriesActualAvg: actualGroceries,
    groceriesPlan: plan,
    gasMonthly: round2(gas),
    gasReason,
    gasActualAvg: actualGas,
    otherMonthly: other,
    totalMonthly: total,
    perPaycheck: round2((total * 12) / 26),
  };
}

// ---------------- goals ----------------

export function goalBalance(goalId: string, contributions: Contribution[]): number {
  return round2(contributions.filter((c) => c.goalId === goalId).reduce((s, c) => s + c.amount, 0));
}

export function totalSaved(goals: Goal[], contributions: Contribution[]): number {
  const ids = new Set(goals.filter((g) => !g.archived).map((g) => g.id));
  return round2(contributions.filter((c) => ids.has(c.goalId)).reduce((s, c) => s + c.amount, 0));
}

export interface Allocation {
  goalId: string;
  amount: number;
  reason: string;
}

/** Split a savings amount across goals: emergency fund first, then deadlines, then priority. */
export function allocateSavings(
  amount: number,
  goals: Goal[],
  contributions: Contribution[],
  monthlyNeeds: number,
  nextPayday: ISODate,
): Allocation[] {
  const active = goals.filter((g) => !g.archived && !g.completedAt);
  const open = active
    .map((g) => ({ g, remaining: Math.max(0, g.target - goalBalance(g.id, contributions)) }))
    .filter((x) => x.remaining > 0.5);
  if (amount <= 0 || !open.length) return [];
  const alloc = new Map<string, { amount: number; reason: string }>();
  const give = (id: string, amt: number, reason: string) => {
    const cur = alloc.get(id);
    alloc.set(id, { amount: (cur?.amount ?? 0) + amt, reason: cur?.reason ?? reason });
  };
  let left = amount;

  // 1) emergency fund until it holds one month of needs: half of savings
  const em = open.find((x) => x.g.isEmergency);
  if (em) {
    const bal = goalBalance(em.g.id, contributions);
    if (bal < monthlyNeeds) {
      const share = Math.min(em.remaining, open.length > 1 ? left * 0.5 : left, monthlyNeeds - bal + 1);
      give(em.g.id, share, 'Building your first month of safety');
      left -= share;
    } else {
      // past the starter month: a steady third until the full fund is there (then it's done and steps aside)
      const share = Math.min(em.remaining, open.length > 1 ? left * 0.35 : left);
      give(em.g.id, share, 'Growing to the full emergency fund');
      left -= share;
    }
  }

  // 2) deadline goals: what's needed per paycheck to arrive on time
  const deadlines = open
    .filter((x) => x.g.targetDate && x.g.targetDate > nextPayday)
    .map((x) => {
      const checks = Math.max(1, Math.floor(diffDays(x.g.targetDate as ISODate, nextPayday) / 14) + 1);
      const rem = x.remaining - (alloc.get(x.g.id)?.amount ?? 0);
      return { ...x, need: Math.max(0, rem / checks) };
    })
    .filter((x) => x.need > 0);
  const needTotal = deadlines.reduce((s, x) => s + x.need, 0);
  if (needTotal > 0 && left > 0) {
    const scale = Math.min(1, left / needTotal);
    for (const x of deadlines) {
      const amt = x.need * scale;
      give(x.g.id, amt, scale < 1 ? 'Toward your target date (stretched)' : 'On pace for your target date');
      left -= amt;
    }
  }

  // 3) the rest by priority weight
  if (left > 0.01) {
    let pool = open.filter((x) => x.remaining - (alloc.get(x.g.id)?.amount ?? 0) > 0.5);
    // the emergency fund already got its share; the rest goes to your other goals while they have room
    if (pool.some((x) => !x.g.isEmergency)) pool = pool.filter((x) => !x.g.isEmergency);
    const wsum = pool.reduce((s, x) => s + x.g.priority, 0);
    for (const x of pool) {
      const room = x.remaining - (alloc.get(x.g.id)?.amount ?? 0);
      const amt = Math.min(room, (left * x.g.priority) / wsum);
      give(x.g.id, amt, x.g.priority === 3 ? 'High priority' : 'Steady progress');
    }
  }

  // round to whole dollars, keeping the total
  const rows = [...alloc.entries()].map(([goalId, v]) => ({ goalId, amount: Math.floor(v.amount), reason: v.reason, frac: v.amount - Math.floor(v.amount) }));
  let diff = Math.round(Math.min(amount, rows.reduce((s, r) => s + r.amount + r.frac, 0))) - rows.reduce((s, r) => s + r.amount, 0);
  rows.sort((a, b) => b.frac - a.frac);
  for (const r of rows) {
    if (diff <= 0) break;
    r.amount += 1;
    diff--;
  }
  return rows.filter((r) => r.amount > 0).map(({ goalId, amount: a, reason }) => ({ goalId, amount: a, reason }));
}

export function projectGoalDate(goal: Goal, balance: number, perPaycheck: number, nextPayday: ISODate): ISODate | null {
  const remaining = goal.target - balance;
  if (remaining <= 0) return nextPayday;
  if (perPaycheck <= 0) return null;
  const checks = Math.ceil(remaining / perPaycheck);
  if (checks > 26 * 30) return null;
  return addDays(nextPayday, (checks - 1) * 14);
}

// ---------------- the plan ----------------

export interface PaycheckPlan {
  net: number;
  bills: number;
  billsDue: BillDue[];
  billsTopUp?: boolean; // bills is a top-up of a bills-only account, not this check's share
  essentials: number;
  available: number; // after bills & essentials
  savings: number;
  savingsSuggested: number;
  personal: number;
  personalPerDay: number;
  shortfall: number; // > 0 when bills + essentials exceed the check
  allocations: Allocation[];
  notes: string[];
  savingsRate: number;
}

export function buildPlan(opts: {
  settings: Settings;
  net: number;
  payday: ISODate;
  nextPayday: ISODate;
  bills: Bill[];
  essentials: EssentialsEstimate;
  goals: Goal[];
  contributions: Contribution[];
  savingsOverride?: number | null;
  /** with a separate Bills account: what this check has to put in it (its balance already counts) */
  billsTopUp?: number | null;
}): PaycheckPlan {
  const { settings, net, payday, nextPayday, bills, essentials, goals, contributions } = opts;
  const b = settings.budget;
  const notes: string[] = [];
  const billsDue = billsDueBetween(bills, payday, nextPayday);
  const steady = b.billsMode === 'due_dates' ? round2(billsDue.reduce((s, x) => s + x.amount, 0)) : round2((monthlyBillsTotal(bills) * 12) / 26);
  // money already sitting in a bills-only account counts; "same every check" still never puts in less than needed
  // with a bills-only account the amount is worked out from it (a top-up, or the same amount every check)
  const billsAmt = opts.billsTopUp == null ? steady : round2(opts.billsTopUp);
  const essentialsAmt = essentials.perPaycheck;
  const available = round2(net - billsAmt - essentialsAmt);
  const step = b.roundTo || 1;
  let suggested = 0;
  let shortfall = 0;
  if (available <= 0) {
    shortfall = round2(-available);
    notes.push(`Bills and essentials are ${'$' + shortfall.toFixed(2)} more than this check. Pebbles paused savings this time.`);
    if (b.billsMode === 'due_dates') notes.push('A big bill like rent lands on this check. Switching Settings → Budget → “Same amount every check” spreads it evenly.');
  } else {
    const floor = (net * b.personalFloorPct) / 100;
    const ideal = (net * b.savingsTargetPct) / 100;
    const minimum = (net * b.minSavingsPct) / 100;
    // deadline needs can pull savings above the ideal, but never below your comfort floor
    const nextDay = nextPayday;
    const deadlineNeed = goals
      .filter((g) => !g.archived && !g.completedAt && g.targetDate && g.targetDate > payday)
      .reduce((s, g) => {
        const rem = Math.max(0, g.target - goalBalance(g.id, contributions));
        const checks = Math.max(1, Math.floor(diffDays(g.targetDate as ISODate, nextDay) / 14) + 1);
        return s + rem / checks;
      }, 0);
    const room = Math.max(0, available - floor);
    suggested = Math.min(Math.max(ideal, Math.min(deadlineNeed, room)), room);
    // experts suggest keeping wants near 30%: once your bills are entered, extra beyond that grows your savings
    if (b.wantsMaxPct > 0 && monthlyBillsTotal(bills) > 0) {
      const beyondWants = available - (net * b.wantsMaxPct) / 100;
      if (beyondWants > suggested) suggested = Math.min(beyondWants, room);
    }
    if (suggested < minimum && available > minimum * 2) suggested = Math.min(minimum, available * 0.5);
    if (suggested <= 0 && available > 0) suggested = Math.min(available * 0.25, minimum || available * 0.1);
    suggested = floorTo(suggested, step);
    if (suggested > available) suggested = floorTo(available, 1);
    if (suggested < ideal * 0.9 - 1) notes.push(`Saving ${Math.round((suggested / net) * 100)}% this check keeps everyday money comfortable. Your aim is ${b.savingsTargetPct}%.`);
    if (deadlineNeed > room && deadlineNeed > 0) notes.push('Your goal dates need more than this check can spare. Consider moving a date out.');
  }
  let savings = suggested;
  if (opts.savingsOverride != null && opts.savingsOverride >= 0) savings = Math.min(Math.max(0, available), opts.savingsOverride);
  const personal = round2(available - savings);
  const days = Math.max(1, diffDays(nextPayday, payday));
  const monthlyNeeds = monthlyBillsTotal(bills) + essentials.totalMonthly;
  const allocations = allocateSavings(savings, goals, contributions, monthlyNeeds, payday);
  return {
    net,
    bills: billsAmt,
    billsDue,
    billsTopUp: opts.billsTopUp != null,
    essentials: essentialsAmt,
    available,
    savings: round2(savings),
    savingsSuggested: round2(suggested),
    personal,
    personalPerDay: round2(Math.max(0, personal) / days),
    shortfall,
    allocations,
    notes,
    savingsRate: net > 0 ? savings / net : 0,
  };
}

/** Months with three paychecks are a gift for biweekly earners. */
export function threePaycheckMonths(periodPaydays: ISODate[]): string[] {
  const counts = new Map<string, number>();
  for (const d of periodPaydays) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= 3).map(([m]) => m);
}
