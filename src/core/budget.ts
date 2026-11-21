// The paycheck plan: how each check splits into bills, essentials, savings and you.
import { addDays, diffDays, makeDate, parts } from './dates';
import { averageCategory, recentFullMonths } from './analytics';
import { foodPlanMonthly, gasMonthly, inflationSinceReference, currentGasPrice, FOOD_PLAN_LABEL, FALLBACK_GAS_PRICE } from './food';
import { floorTo, round2 } from './money';
import { checksUntil, isMustHit, mustHitPlan, type MustHitLine } from './goalpace';
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
    case 'semiannual':
      return amount / 6;
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
    if (b.frequency === 'quarterly' && (((m - (b.dueMonth ?? 1)) % 3) + 3) % 3 !== 0) continue;
    if (b.frequency === 'semiannual' && (((m - (b.dueMonth ?? 1)) % 6) + 6) % 6 !== 0) continue;
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
      adjusted >= thrifty ? `Your ${months.length}-month average${yoy > 0 ? `, plus ${yoy.toFixed(1)}% food inflation` : ''}` : `Raised to the USDA Thrifty minimum so your home is always fed`;
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

/** The order goals for things are saved in: must-be-ready by date, then dated by date, then undated by priority. */
export function thingsQueue(goals: Goal[]): Goal[] {
  const rank = (g: Goal) => (isMustHit(g) ? 0 : g.targetDate ? 1 : 2);
  return goals
    .filter((g) => !g.isEmergency && !g.archived && !g.completedAt)
    .sort((a, b) => rank(a) - rank(b) || (a.targetDate ?? '').localeCompare(b.targetDate ?? '') || b.priority - a.priority || a.createdAt - b.createdAt);
}

/** Split a savings amount across goals: emergency fund first, then deadlines, then priority. */
export function allocateSavings(amount: number, goals: Goal[], contributions: Contribution[], monthlyNeeds: number, _nextPayday: ISODate, mustHit?: Map<string, number>): Allocation[] {
  const active = goals.filter((g) => !g.archived && !g.completedAt);
  const open = active.map((g) => ({ g, remaining: Math.max(0, g.target - goalBalance(g.id, contributions)) })).filter((x) => x.remaining > 0.5);
  if (amount <= 0 || !open.length) return [];
  const alloc = new Map<string, { amount: number; reason: string }>();
  const give = (id: string, amt: number, reason: string) => {
    const cur = alloc.get(id);
    alloc.set(id, { amount: (cur?.amount ?? 0) + amt, reason: cur?.reason ?? reason });
  };
  let left = amount;

  // 0) goals that must be ready by their date: their share for this check comes first (soonest first)
  if (mustHit)
    for (const x of open) {
      const m = Math.min(mustHit.get(x.g.id) ?? 0, x.remaining, left);
      if (m > 0) {
        give(x.g.id, m, 'Must be ready by its date');
        left -= m;
      }
    }

  // 0b) "Reach It Sooner": the extra you chose for a goal goes to it first
  for (const x of open) {
    const b = Math.min(x.g.boost ?? 0, x.remaining, left);
    if (b > 0) {
      give(x.g.id, b, 'Reaching it sooner');
      left -= b;
    }
  }

  // 1) the emergency fund gets the biggest single share: 60% until it holds a month of needs, then 45% until
  //    the full fund is there. When "must be ready" goals needed their guaranteed part, a little less (50% / 35%).
  const em = open.find((x) => x.g.isEmergency);
  const floorsUsed = amount - left > 0.004;
  if (em) {
    const bal = goalBalance(em.g.id, contributions);
    if (bal < monthlyNeeds) {
      const share = Math.min(em.remaining, open.length > 1 ? left * (floorsUsed ? 0.5 : 0.6) : left, monthlyNeeds - bal + 1);
      give(em.g.id, share, 'Building your first month of safety');
      left -= share;
    } else {
      // past the starter month: a steady share until the full fund is there (then it's done and steps aside)
      const share = Math.min(em.remaining, open.length > 1 ? left * (floorsUsed ? 0.35 : 0.45) : left);
      give(em.g.id, share, 'Growing to the full emergency fund');
      left -= share;
    }
  }

  // 1b) then each dated goal's own pace (what's left of it ÷ the checks until its date), soonest date first, so
  //    every goal moves every check when there's enough, and a near date wins when there isn't
  {
    const dated = open.filter((x) => !x.g.isEmergency && x.g.targetDate).sort((p, q) => (p.g.targetDate as string).localeCompare(q.g.targetDate as string));
    for (const x of dated) {
      if (left <= 0.004) break;
      const room = x.remaining - (alloc.get(x.g.id)?.amount ?? 0);
      const amt = Math.min(room / checksUntil(x.g.targetDate as ISODate, _nextPayday), room, left);
      if (amt <= 0) continue;
      give(x.g.id, amt, isMustHit(x.g) ? 'Must be ready by its date' : 'On pace for its date');
      left -= amt;
    }
  }

  // 2) the rest is shared by all your goals for things, every deposit. Each one's share follows what it needs
  //    per paycheck to make its date (sooner dates and bigger gaps get more); goals with no date get a small
  //    steady share. "Must be ready" goals already got their guaranteed part above and share in this too.
  const things = open.filter((x) => !x.g.isEmergency);
  const pace = (x: (typeof open)[number]) => {
    const room = x.remaining - (alloc.get(x.g.id)?.amount ?? 0);
    if (room <= 0.004) return 0;
    const checks = x.g.targetDate ? checksUntil(x.g.targetDate, _nextPayday) : 52; // no date: as if two years out
    return (room / checks) * (x.g.priority === 3 ? 1.25 : x.g.priority === 1 ? 0.75 : 1);
  };
  for (let round = 0; round < 4 && left > 0.01; round++) {
    const ws = things.map((x) => ({ x, w: pace(x) })).filter((y) => y.w > 0);
    const wsum = ws.reduce((t, y) => t + y.w, 0);
    if (!wsum) break;
    let used = 0;
    for (const { x, w } of ws) {
      const room = x.remaining - (alloc.get(x.g.id)?.amount ?? 0);
      const amt = Math.min(room, (left * w) / wsum);
      if (amt <= 0) continue;
      give(x.g.id, amt, isMustHit(x.g) ? 'Must be ready by its date' : x.g.targetDate ? 'Paced for its date' : 'Steady progress');
      used += amt;
    }
    left -= used; // anything a full goal couldn't take goes around again
  }

  // 3) everything else is full: the rest builds the emergency fund
  if (left > 0.01 && em) {
    const room = em.remaining - (alloc.get(em.g.id)?.amount ?? 0);
    if (room > 0) give(em.g.id, Math.min(room, left), 'Growing to the full emergency fund');
  }

  // round to whole dollars, keeping the total
  const rows = [...alloc.entries()].map(([goalId, v]) => ({ goalId, amount: Math.floor(v.amount), reason: v.reason, frac: v.amount - Math.floor(v.amount) }));
  let diff =
    Math.round(
      Math.min(
        amount,
        rows.reduce((s, r) => s + r.amount + r.frac, 0),
      ),
    ) - rows.reduce((s, r) => s + r.amount, 0);
  rows.sort((a, b) => b.frac - a.frac);
  for (const r of rows) {
    if (diff <= 0) break;
    r.amount += 1;
    diff--;
  }
  return rows.filter((r) => r.amount > 0).map(({ goalId, amount: a, reason }) => ({ goalId, amount: a, reason }));
}

/**
 * What a goal really gets each paycheck: the paycheck deposits it got over the last few pay periods plus the
 * one planned next, averaged. One big or small check doesn't swing its finish date around.
 */
export function averagePerCheck(goalId: string, contributions: Contribution[], plannedNext: number, today: ISODate, checks = 6): { avg: number; periods: number } {
  const since = addDays(today, -14 * checks);
  const deposits = contributions.filter((c) => c.goalId === goalId && c.amount > 0 && c.kind !== 'interest' && c.date > since && c.date <= today);
  if (!deposits.length) return { avg: round2(plannedNext), periods: 1 };
  const first = deposits.reduce((m, c) => (c.date < m ? c.date : m), deposits[0].date);
  const past = Math.min(checks, Math.max(1, Math.ceil((diffDays(today, first) + 1) / 14)));
  const sum = deposits.reduce((s2, c) => s2 + c.amount, 0);
  return { avg: round2((sum + plannedNext) / (past + 1)), periods: past + 1 };
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
  /** goals that must be ready by their date: what each check needs, and how far short this one is */
  mustHit?: { perCheck: number; short: number; lines: MustHitLine[] };
  savingsBase?: number; // usual savings per check (without the must-be-ready raise)
  savingsCap?: number; // the most a check can save with bills and basics covered
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
    // goals are saved one after another (each spent on its day), so the tightest stretch of dates decides
    const deadlineNeed = mustHitPlan(
      goals.map((g) => (g.targetDate && !g.isEmergency ? { ...g, mustHit: true } : { ...g, mustHit: false })),
      (id) => goalBalance(id, contributions),
      payday,
    ).perCheck;
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
  // goals that must be ready by their date: save at least the amount that gets every one there on time,
  // even if it means less spending money, as long as bills and basics are covered
  const baseSuggested = suggested; // your usual savings, before must-be-ready goals raise it
  let mhWant = 0;
  const mh = mustHitPlan(goals, (id) => goalBalance(id, contributions), payday);
  const cushion = Math.max(25, net * 0.03);
  const mustRoom = Math.max(0, floorTo(available - cushion, 1));
  if (mh.perCheck > 0 && available > 0) {
    const want = Math.min(Math.ceil(mh.perCheck), mustRoom);
    mhWant = want;
    if (want > suggested) suggested = want;
    if (mh.perCheck > mustRoom + 0.5)
      notes.push(`Your must-be-ready goals need ${'$' + mh.perCheck.toFixed(2)} a check, ${'$' + (mh.perCheck - mustRoom).toFixed(2)} more than this check can spare. Savings shows what to trim.`);
  }
  // "Reach It Sooner" boosts come out of spending money, on top of the usual savings
  const boosts = round2(
    goals.filter((g) => !g.archived && !g.completedAt && (g.boost ?? 0) > 0).reduce((s, g) => s + Math.min(g.boost ?? 0, Math.max(0, g.target - goalBalance(g.id, contributions))), 0),
  );
  if (boosts > 0 && available > suggested) {
    const add = Math.min(boosts, floorTo(available - suggested, 1));
    suggested = round2(suggested + add);
    if (add < boosts - 0.5) notes.push(`Your Reach It Sooner extras only fit ${'$' + add.toFixed(2)} of ${'$' + boosts.toFixed(2)} this check.`);
  }
  let savings = suggested;
  if (opts.savingsOverride != null && opts.savingsOverride >= 0) savings = Math.min(Math.max(0, available), opts.savingsOverride);
  const personal = round2(available - savings);
  const days = Math.max(1, diffDays(nextPayday, payday));
  const monthlyNeeds = monthlyBillsTotal(bills) + essentials.totalMonthly;
  const allocations = allocateSavings(savings, goals, contributions, monthlyNeeds, payday, mh.thisCheck);
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
    mustHit: { perCheck: mh.perCheck, short: round2(Math.max(0, mh.perCheck - savings)), lines: mh.lines },
    savingsBase: round2(opts.savingsOverride != null && opts.savingsOverride >= 0 ? savings : Math.max(0, savings - Math.max(0, mhWant - baseSuggested))),
    savingsCap: mustRoom,
  };
}

/** Months with three paychecks are a gift for biweekly earners. */
export function threePaycheckMonths(periodPaydays: ISODate[]): string[] {
  const counts = new Map<string, number>();
  for (const d of periodPaydays) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= 3).map(([m]) => m);
}

// ---------------- where every goal ends up ----------------

export interface GoalForecast {
  ready: ISODate | null; // the payday it's fully saved
  starts: ISODate | null; // the first payday it gets money
  perCheck: number; // about what it gets each paycheck while it's being saved for
  spent: ISODate | null; // a goal for a thing: the day its money comes out (its date)
}

export interface ForecastPoint {
  date: ISODate;
  balance: number; // everything in savings after this check
  deposits: number; // total put in so far
  interest: number; // total interest so far
  spent: number; // total taken out for goals so far
}

export interface Forecast {
  byGoal: Map<string, GoalForecast>;
  series: ForecastPoint[]; // one point per paycheck, starting before the first
  withdrawals: { goalId: string; date: ISODate; amount: number }[];
}

/**
 * Walks your savings forward one paycheck at a time with the same rules as the plan. This paycheck uses its real
 * plan; after that, your usual (average) savings per check, raised when "must be ready" goals need more. A goal
 * for a thing is bought on its date: its money comes out of savings then. The emergency fund stays.
 */
export function forecastGoals(opts: {
  goals: Goal[];
  contributions: Contribution[];
  firstAllocations?: Allocation[]; // this paycheck's real plan (worked out like the rest if left out)
  firstAmount?: number; // this paycheck's planned savings
  savingsPerCheck: number; // usual savings after this check
  perCheckAt?: (k: number, day: ISODate) => number; // each check's own planned savings, when known
  cap: number; // most a check can save
  monthlyNeeds: number;
  payday: ISODate;
  checks?: number;
  apy?: number | null;
  startBalance?: number; // what the account holds now (defaults to the goals' total)
}): Forecast {
  const bal = new Map(opts.goals.map((g) => [g.id, goalBalance(g.id, opts.contributions)]));
  const goals = opts.goals.filter((g) => !g.archived && !g.completedAt).map((g) => ({ ...g }));
  const byGoal = new Map<string, GoalForecast>(goals.map((g) => [g.id, { ready: null, starts: null, perCheck: 0, spent: null }]));
  const got = new Map<string, { sum: number; n: number }>();
  const n = opts.checks ?? 26 * 6;
  const rate = opts.apy ? Math.pow(1 + opts.apy / 100, 14 / 365) - 1 : 0;
  let total = opts.startBalance ?? opts.goals.filter((g) => !g.archived).reduce((t, g) => t + (bal.get(g.id) ?? 0), 0);
  let deposits = 0;
  let interest = 0;
  let spentTotal = 0;
  const series: ForecastPoint[] = [{ date: addDays(opts.payday, -1), balance: round2(total), deposits: 0, interest: 0, spent: 0 }];
  const withdrawals: Forecast['withdrawals'] = [];
  const waiting = new Set<string>(); // saved up, bought on its date
  for (let k = 0; k < n; k++) {
    const day = addDays(opts.payday, k * 14);
    // goals whose day has come: the money is spent (whatever they hold by then)
    for (const g of goals) {
      // (a payday on the goal's date still adds to it first; it's spent before the next payday)
      if (g.isEmergency || !g.targetDate || g.targetDate >= day || byGoal.get(g.id)!.spent) continue;
      const amt = round2(bal.get(g.id) ?? 0);
      byGoal.get(g.id)!.spent = g.targetDate;
      if (amt > 0) {
        withdrawals.push({ goalId: g.id, date: g.targetDate, amount: amt });
        total -= amt;
        spentTotal += amt;
      }
      bal.set(g.id, 0);
      g.completedAt = 1;
      waiting.delete(g.id);
    }
    const live = goals.filter((g) => !g.completedAt && !waiting.has(g.id));
    let allocs: Allocation[] = [];
    // what goes into savings this check, even when every goal is already full (it just isn't earmarked)
    const usual = opts.perCheckAt ? opts.perCheckAt(k, day) : opts.savingsPerCheck;
    let saved = k === 0 && opts.firstAllocations ? (opts.firstAmount ?? opts.firstAllocations.reduce((t, a) => t + a.amount, 0)) : usual;
    if (live.length) {
      const contribs: Contribution[] = live.map((g) => ({ id: g.id, goalId: g.id, amount: bal.get(g.id) ?? 0, date: day, note: '', paycheckId: null }));
      if (k === 0 && opts.firstAllocations) allocs = opts.firstAllocations;
      else {
        const mh = mustHitPlan(live, (id) => bal.get(id) ?? 0, day);
        // a check's own plan already raises savings for must-be-ready goals; otherwise use the usual amount, raised if needed
        const amount = opts.perCheckAt ? usual : Math.min(opts.cap, Math.max(usual, Math.ceil(mh.perCheck)));
        allocs = allocateSavings(amount, live, contribs, opts.monthlyNeeds, day, mh.thisCheck);
        saved = amount;
      }
    }
    const i = total * rate;
    interest += i;
    total += i;
    for (const a of allocs) {
      if (a.amount <= 0) continue;
      bal.set(a.goalId, round2((bal.get(a.goalId) ?? 0) + a.amount));
      const f = byGoal.get(a.goalId);
      if (f && !f.starts) f.starts = day;
      const gg = got.get(a.goalId) ?? { sum: 0, n: 0 };
      got.set(a.goalId, { sum: gg.sum + a.amount, n: gg.n + 1 });
    }
    total += saved;
    deposits += saved;
    for (const g of live) {
      if ((bal.get(g.id) ?? 0) >= g.target - 0.5) {
        const f = byGoal.get(g.id)!;
        if (!f.ready) f.ready = day;
        if (g.isEmergency) g.completedAt = 1;
        else waiting.add(g.id);
      }
    }
    series.push({ date: day, balance: round2(total), deposits: round2(deposits), interest: round2(interest), spent: round2(spentTotal) });
  }
  for (const [id, f] of byGoal) {
    const gg = got.get(id);
    f.perCheck = gg ? round2(gg.sum / gg.n) : 0;
  }
  return { byGoal, series, withdrawals };
}
