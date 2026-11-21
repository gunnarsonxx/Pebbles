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
  perCheck: number; // about what it gets each paycheck while it's being saved for
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
  const needFrom = (day: ISODate, left: Map<string, number>) => {
    let cum = 0;
    let need = 0;
    for (const x of open) {
      const l = left.get(x.g.id) ?? 0;
      if (l <= 0.004) continue;
      cum += l;
      need = Math.max(need, cum / checksUntil(x.date, day));
    }
    return Math.ceil(need * 100) / 100;
  };
  // walk it forward one paycheck at a time. The amount is worked out again every check from what's left, so
  // once a goal is saved up (and then spent on the day), the later ones only ask for what they still need
  const left = new Map(open.map((x) => [x.g.id, x.remaining]));
  const ready = new Map<string, ISODate>();
  const thisCheck = new Map<string, number>();
  const got = new Map<string, { sum: number; n: number }>();
  const perCheck = needFrom(payday, left);
  for (let k = 0; k < 26 * 6 && ready.size < open.length; k++) {
    const day = addDays(payday, k * 14);
    let money = needFrom(day, left);
    for (const x of open) {
      const l = left.get(x.g.id) ?? 0;
      if (l <= 0.004 || money <= 0) continue;
      const give = r2(Math.min(l, money));
      left.set(x.g.id, r2(l - give));
      money = r2(money - give);
      const gg = got.get(x.g.id) ?? { sum: 0, n: 0 };
      got.set(x.g.id, { sum: gg.sum + give, n: gg.n + 1 });
      if (k === 0) thisCheck.set(x.g.id, r2((thisCheck.get(x.g.id) ?? 0) + give));
      if ((left.get(x.g.id) ?? 0) <= 0.004) ready.set(x.g.id, day);
    }
  }
  return {
    perCheck,
    thisCheck,
    lines: open.map((x) => ({
      goalId: x.g.id,
      date: x.date,
      remaining: x.remaining,
      checks: checksUntil(x.date, payday),
      ready: ready.get(x.g.id) ?? null,
      perCheck: got.get(x.g.id) ? r2(got.get(x.g.id)!.sum / got.get(x.g.id)!.n) : 0,
      thisCheck: thisCheck.get(x.g.id) ?? 0,
    })),
  };
}
