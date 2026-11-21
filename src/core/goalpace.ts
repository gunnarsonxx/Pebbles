// Goals that have to be ready by their date (a trip, a visit, a move): the least you can save each paycheck so
// every one of them is fully funded in time. The soonest one is filled first; when it's done, the next one takes over.
import { addDays, diffDays } from './dates';
import type { Goal, ISODate } from './types';

export interface MustHitLine {
  goalId: string;
  date: ISODate;
  remaining: number;
  checks: number; // paychecks from this one through the goal's date
  ready: ISODate | null; // the payday it's fully funded at the planned pace
  thisCheck: number;
}

export interface MustHitPlan {
  perCheck: number; // the least each paycheck has to save for all of them to be on time
  lines: MustHitLine[];
  thisCheck: Map<string, number>;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Paychecks from `payday` up to and including `date` (at least one). */
export function checksUntil(date: ISODate, payday: ISODate): number {
  return date < payday ? 1 : Math.floor(diffDays(date, payday) / 14) + 1;
}

export function isMustHit(g: Goal): boolean {
  return !!g.mustHit && !!g.targetDate && !g.isEmergency && !g.archived && !g.completedAt;
}

export function mustHitPlan(goals: Goal[], balanceOf: (id: string) => number, payday: ISODate): MustHitPlan {
  const open = goals
    .filter(isMustHit)
    .map((g) => ({ g, date: g.targetDate as ISODate, remaining: r2(Math.max(0, g.target - balanceOf(g.id))) }))
    .filter((x) => x.remaining > 0.5)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return { perCheck: 0, lines: [], thisCheck: new Map() };
  // the tightest stretch decides: everything due by a date has to fit in the checks before it
  let cum = 0;
  let need = 0;
  for (const x of open) {
    cum += x.remaining;
    need = Math.max(need, cum / checksUntil(x.date, payday));
  }
  const perCheck = Math.ceil(need * 100) / 100;
  // walk it forward: each check's amount goes to the soonest goal still short
  const left = new Map(open.map((x) => [x.g.id, x.remaining]));
  const ready = new Map<string, ISODate>();
  const thisCheck = new Map<string, number>();
  for (let k = 0; k < 26 * 5 && ready.size < open.length; k++) {
    const day = addDays(payday, k * 14);
    let money = perCheck;
    for (const x of open) {
      const l = left.get(x.g.id) ?? 0;
      if (l <= 0.004 || money <= 0) continue;
      const give = r2(Math.min(l, money));
      left.set(x.g.id, r2(l - give));
      money = r2(money - give);
      if (k === 0) thisCheck.set(x.g.id, r2((thisCheck.get(x.g.id) ?? 0) + give));
      if ((left.get(x.g.id) ?? 0) <= 0.004) ready.set(x.g.id, day);
    }
  }
  return {
    perCheck,
    thisCheck,
    lines: open.map((x) => ({ goalId: x.g.id, date: x.date, remaining: x.remaining, checks: checksUntil(x.date, payday), ready: ready.get(x.g.id) ?? null, thisCheck: thisCheck.get(x.g.id) ?? 0 })),
  };
}
