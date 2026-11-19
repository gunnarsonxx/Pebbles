// Retirement and FIRE (financial independence, retire early) math.
// Uses "real" returns (after inflation) so every number is in today's dollars.
import { round2 } from './money';

export interface FireInputs {
  age: number;
  retireAge: number; // the age you'd like to be able to stop
  invested: number; // retirement + brokerage today
  monthlyInvest: number; // everything going in each month (paycheck 401k, match, IRA, brokerage)
  annualSpending: number; // what you'd spend per year in retirement (today's dollars)
  returnPct: number; // nominal expected return, e.g. 7
  inflationPct: number; // e.g. 3
  withdrawalPct: number; // safe withdrawal rate, e.g. 4
}

export function realReturn(i: Pick<FireInputs, 'returnPct' | 'inflationPct'>): number {
  return (1 + i.returnPct / 100) / (1 + i.inflationPct / 100) - 1;
}

/** The nest egg that covers your spending forever at the withdrawal rate (25× spending at 4%). */
export function fiNumber(annualSpending: number, withdrawalPct: number): number {
  return withdrawalPct > 0 ? round2(annualSpending / (withdrawalPct / 100)) : Infinity;
}

/** Months until `start` growing with monthly deposits reaches `target` (null if not within 80 years). */
export function monthsToTarget(start: number, monthly: number, annualReal: number, target: number): number | null {
  if (start >= target) return 0;
  const r = Math.pow(1 + annualReal, 1 / 12) - 1;
  let b = start;
  for (let m = 1; m <= 960; m++) {
    b = b * (1 + r) + monthly;
    if (b >= target) return m;
  }
  return null;
}

export interface FirePlan {
  fi: number;
  leanFi: number;
  fatFi: number;
  coastFi: number; // invested today that reaches FI by retireAge with no more deposits
  coastReached: boolean;
  monthsToFi: number | null;
  fiAge: number | null;
  atRetireAge: number; // projected balance at your target age
  incomeAtRetireAge: number; // yearly income that balance supports
  progress: number; // invested ÷ FI number
  projection: { age: number; balance: number }[];
}

export function firePlan(i: FireInputs, leanSpending: number): FirePlan {
  const rr = realReturn(i);
  const fi = fiNumber(i.annualSpending, i.withdrawalPct);
  const leanFi = fiNumber(leanSpending, i.withdrawalPct);
  const fatFi = fiNumber(i.annualSpending * 1.5, i.withdrawalPct);
  const yearsLeft = Math.max(0, i.retireAge - i.age);
  const coastFi = round2(fi / Math.pow(1 + rr, yearsLeft));
  const months = monthsToTarget(i.invested, i.monthlyInvest, rr, fi);
  const r = Math.pow(1 + rr, 1 / 12) - 1;
  const projection: { age: number; balance: number }[] = [];
  let b = i.invested;
  let atRetireAge = i.invested;
  const horizon = Math.max(yearsLeft, months != null ? Math.ceil(months / 12) : 0, 10);
  for (let y = 0; y <= Math.min(horizon, 60); y++) {
    projection.push({ age: i.age + y, balance: round2(b) });
    if (y === yearsLeft) atRetireAge = b;
    for (let m = 0; m < 12; m++) b = b * (1 + r) + i.monthlyInvest;
  }
  return {
    fi,
    leanFi,
    fatFi,
    coastFi,
    coastReached: i.invested >= coastFi,
    monthsToFi: months,
    fiAge: months != null ? round2(i.age + months / 12) : null,
    atRetireAge: round2(atRetireAge),
    incomeAtRetireAge: round2(atRetireAge * (i.withdrawalPct / 100)),
    progress: fi > 0 ? Math.min(1, i.invested / fi) : 0,
    projection,
  };
}

/** The classic "savings rate → years to FI" table, starting from zero (5% real return, 4% withdrawal). */
export function yearsToFiFromSavingsRate(ratePct: number, realPct = 5, withdrawalPct = 4): number | null {
  if (ratePct <= 0) return null;
  if (ratePct >= 100) return 0;
  const income = 1;
  const save = (income * ratePct) / 100;
  const spend = income - save;
  const target = spend / (withdrawalPct / 100);
  const m = monthsToTarget(0, save / 12, realPct / 100, target);
  return m == null ? null : Math.round((m / 12) * 10) / 10;
}

/** Where each next dollar should go: the order most of the FI / personal finance community agrees on. */
export const ACCOUNT_ORDER = [
  { step: 'Starter emergency fund', detail: 'About one month of expenses in high-yield savings (your Bedrock fund at Marcus).' },
  { step: 'Full employer 401(k) match', detail: 'Contribute at least enough to get every dollar of match. It’s an instant 50–100% return.' },
  { step: 'Pay off high-interest debt', detail: 'Credit cards and anything above roughly 7–8% interest.' },
  { step: 'Full emergency fund', detail: '3–6 months of expenses.' },
  { step: 'Roth IRA', detail: 'Up to the yearly limit. Grows tax-free; good fit while your tax bracket is low.' },
  { step: 'HSA (if you have a high-deductible plan)', detail: 'Triple tax advantage: in, growth, and out for medical costs.' },
  { step: 'More 401(k)', detail: 'Work toward 15% of gross pay or more, up to the yearly limit.' },
  { step: 'Taxable brokerage', detail: 'Low-cost index funds for anything beyond that, and for retiring before 59½.' },
];

export const SIMPLE_PORTFOLIO = [
  { name: 'Target-date index fund', detail: 'One fund that holds everything and gets more conservative as you near the date. The simplest good choice.' },
  { name: 'Or a "three-fund portfolio"', detail: 'U.S. total stock market + international stock + U.S. bonds, in proportions you rebalance once a year.' },
  { name: 'Keep costs low', detail: 'Expense ratios under 0.1% are easy to find. Fees compound against you just like returns compound for you.' },
  { name: 'Stay the course', detail: 'Keep investing every paycheck through ups and downs. Time in the market beats timing the market.' },
];
