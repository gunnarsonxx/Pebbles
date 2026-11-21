// When the goals don't fit: where your money actually went lately, and how much each change would free up per paycheck.
import { categoryOf } from './categories';
import { addDays } from './dates';
import type { Bill, ISODate, Transaction } from './types';

export interface CutIdea {
  id: string;
  title: string;
  detail: string;
  monthly: number; // what it costs you a month now
  perCheck: number; // what the suggested change frees up each paycheck
}

const PER_CHECK = 12 / 26;
const r2 = (v: number) => Math.round(v * 100) / 100;

// how much of each kind of spending is realistic to trim
const TRIM: Record<string, { share: number; how: string }> = {
  delivery: { share: 0.75, how: 'Cook or pick up instead of delivery most nights' },
  dining: { share: 0.5, how: 'Eat out or grab coffee half as often' },
  shopping: { share: 0.4, how: 'Wait a week on anything that isn’t needed' },
  entertainment: { share: 0.4, how: 'Swap a few paid outings for free ones' },
  cash: { share: 0.25, how: 'Take out a little less cash' },
  fees: { share: 1, how: 'Bank fees can usually be avoided or waived: ask your bank' },
  travel: { share: 0.3, how: 'Trim trips that aren’t part of a goal' },
  gifts: { share: 0.25, how: 'Set a gift budget' },
};

export function whereToCut(txns: Transaction[], bills: Bill[], today: ISODate, days = 90): CutIdea[] {
  const since = addDays(today, -days);
  const months = days / 30.4;
  const recent = txns.filter((t) => t.amount < 0 && !t.excluded && !t.dupOf && t.date > since && t.date <= today);
  const ideas: CutIdea[] = [];

  // everyday spending you choose
  const byCat = new Map<string, { total: number; merchants: Map<string, number> }>();
  for (const t of recent) {
    if (!TRIM[t.category]) continue;
    const c = byCat.get(t.category) ?? { total: 0, merchants: new Map() };
    c.total += -t.amount;
    const m = (t.merchant || t.description).trim();
    c.merchants.set(m, (c.merchants.get(m) ?? 0) + -t.amount);
    byCat.set(t.category, c);
  }
  for (const [cat, c] of byCat) {
    const monthly = c.total / months;
    if (monthly < 15) continue;
    const top = [...c.merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    ideas.push({
      id: `cat:${cat}`,
      title: `${categoryOf(cat).name}: about $${Math.round(monthly)} a month`,
      detail: `${TRIM[cat].how}.${top.length ? ` Most went to ${top.map(([m, v]) => `${m} ($${Math.round(v / months)}/mo)`).join(', ')}.` : ''}`,
      monthly: r2(monthly),
      perCheck: r2(monthly * TRIM[cat].share * PER_CHECK),
    });
  }

  // subscriptions you could pause or cancel
  for (const b of bills) {
    if (!b.active || b.category !== 'subscriptions') continue;
    const monthly =
      b.frequency === 'yearly'
        ? b.amount / 12
        : b.frequency === 'semiannual'
          ? b.amount / 6
          : b.frequency === 'quarterly'
            ? b.amount / 3
            : b.frequency === 'weekly'
              ? (b.amount * 52) / 12
              : b.frequency === 'biweekly'
                ? (b.amount * 26) / 12
                : b.amount;
    if (monthly < 3) continue;
    ideas.push({
      id: `bill:${b.id}`,
      title: `${b.name}: $${monthly.toFixed(2)} a month`,
      detail: 'A subscription. Pause or cancel it until your goals are on track.',
      monthly: r2(monthly),
      perCheck: r2(monthly * PER_CHECK),
    });
  }

  return ideas.sort((a, b) => b.perCheck - a.perCheck);
}

/** The fewest ideas (biggest first) that cover what's short each paycheck. */
export function cutsToCover(ideas: CutIdea[], shortPerCheck: number): { picks: CutIdea[]; covered: number } {
  const picks: CutIdea[] = [];
  let covered = 0;
  for (const i of ideas) {
    if (covered >= shortPerCheck) break;
    picks.push(i);
    covered = r2(covered + i.perCheck);
  }
  return { picks, covered };
}
