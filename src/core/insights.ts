// "Field notes": plain-language suggestions generated from your own data.
import { addMonths, diffDays, fmtMonth, monthKey } from './dates';
import { categoryOf } from './categories';
import { averageCategory, detectRecurring, recentFullMonths, summarizeMonth } from './analytics';
import { foodPlanMonthly, FOOD_PLAN_LABEL, inflationSinceReference } from './food';
import { goalBalance, monthlyBillsTotal, threePaycheckMonths } from './budget';
import { cleanMerchant } from './statements';
import { round2, usd } from './money';
import type { Bill, Contribution, Goal, ISODate, MarketData, Settings, Transaction } from './types';

export type InsightKind = 'save' | 'quit' | 'keep' | 'cut' | 'heads_up' | 'win';

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  monthlyImpact: number; // money you could free up per month
  priority: number; // higher shows first
}

export interface InsightInput {
  settings: Settings;
  txns: Transaction[];
  bills: Bill[];
  goals: Goal[];
  contributions: Contribution[];
  market: MarketData | null;
  asOf: ISODate;
  netPerPaycheck: number;
  upcomingPaydays: ISODate[];
  otPremiumYtd: number;
  otTaxSaved: number;
}

export function generateInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const { txns, settings, asOf } = i;
  const current = monthKey(asOf);
  const months = recentFullMonths(txns, current, 3);
  const last = months[0];
  const lastSum = last ? summarizeMonth(txns, last) : null;
  const avg = (cats: string[]) => averageCategory(txns, cats, months);
  const hasData = txns.length > 0 && months.length > 0;

  if (!txns.length) {
    out.push({
      id: 'import-first',
      kind: 'heads_up',
      title: 'Bring In a Bank Statement',
      body: 'Import a CSV, QFX or PDF statement (Budget → Spending), or connect your bank. Pebbles will learn your real grocery, gas and bill costs and tailor every suggestion to you.',
      monthlyImpact: 0,
      priority: 100,
    });
  }

  // Subscriptions
  const subs = detectRecurring(txns, [], asOf).filter((r) => r.category === 'subscriptions' || r.category === 'entertainment');
  const subMonthly = subs.reduce((s, r) => s + (r.frequency === 'yearly' ? r.amount / 12 : r.frequency === 'weekly' ? (r.amount * 52) / 12 : r.amount), 0);
  if (subs.length >= 2) {
    const names = subs.slice(0, 4).map((s) => `${s.name} (${usd(s.amount)})`).join(', ');
    out.push({
      id: 'subs',
      kind: 'cut',
      title: `${subs.length} Subscriptions Cost ${usd(subMonthly)} a Month`,
      body: `That's ${usd(subMonthly * 12, true)} a year: ${names}${subs.length > 4 ? '…' : ''}. Cancel one you haven't opened in 30 days, or rotate streaming services month to month.`,
      monthlyImpact: round2(subs[subs.length - 1]?.amount ?? 0),
      priority: 70,
    });
  }

  // Dining & delivery vs groceries
  if (hasData) {
    const dining = avg(['dining']);
    const delivery = avg(['delivery']);
    const groceries = avg(['groceries']);
    const eatingOut = dining + delivery;
    const foodTotal = eatingOut + groceries;
    if (foodTotal > 0 && eatingOut / foodTotal > 0.35 && eatingOut > 120) {
      const save = round2(eatingOut * 0.3);
      out.push({
        id: 'eating-out',
        kind: 'cut',
        title: `Eating out is ${Math.round((eatingOut / foodTotal) * 100)}% of your food money`,
        body: `You average ${usd(eatingOut)} a month on restaurants${delivery > 0 ? ' and delivery' : ''}. Cooking two more dinners a week could free about ${usd(save)} a month.`,
        monthlyImpact: save,
        priority: 65,
      });
    }
    if (delivery > 40) {
      const orders = countIn(txns, months, 'delivery');
      out.push({
        id: 'delivery',
        kind: 'quit',
        title: 'Delivery Apps Add Up Quietly',
        body: `About ${Math.round(orders / months.length)} orders a month (${usd(delivery)}). Fees and menu markups usually add 25–40%; picking up the same order saves roughly ${usd(delivery * 0.3)} a month.`,
        monthlyImpact: round2(delivery * 0.3),
        priority: 60,
      });
    }

    // Coffee habit
    const coffee = txns.filter(
      (t) => months.includes(monthKey(t.date)) && t.amount < 0 && /STARBUCKS|DUTCH BROS|COFFEE|DUNKIN|SCOOTERS|PEET|CARIBOU|ESPRESSO|CAFE/i.test(t.description),
    );
    if (coffee.length / Math.max(1, months.length) >= 8) {
      const monthly = -coffee.reduce((s, t) => s + t.amount, 0) / months.length;
      out.push({
        id: 'coffee',
        kind: 'quit',
        title: `Coffee Runs: ${Math.round(coffee.length / months.length)} a Month`,
        body: `That's ${usd(monthly)} a month, ${usd(monthly * 12, true)} a year. Brewing at home on workdays could keep about ${usd(monthly * 0.6)} a month in your pocket.`,
        monthlyImpact: round2(monthly * 0.6),
        priority: 50,
      });
    }

    // Bank fees
    const fees = avg(['fees']);
    if (fees > 0) {
      out.push({
        id: 'fees',
        kind: 'quit',
        title: `Bank Fees: ${usd(fees)} a Month`,
        body: 'Overdraft, ATM and maintenance fees are the easiest money to win back. Turn on low-balance alerts, use in-network ATMs, and ask your bank to waive a first overdraft.',
        monthlyImpact: fees,
        priority: 75,
      });
    }

    // Category trends: up vs usual (keep or cut)
    if (lastSum && months.length >= 2) {
      const prior = months.slice(1);
      for (const cat of ['dining', 'shopping', 'entertainment', 'groceries', 'gas', 'delivery']) {
        const before = averageCategory(txns, [cat], prior);
        const now = lastSum.byCategory[cat] ?? 0;
        if (before < 40) continue;
        const change = (now - before) / before;
        const name = categoryOf(cat).name;
        if (change > 0.25 && now - before > 40) {
          out.push({
            id: `up-${cat}`,
            kind: 'heads_up',
            title: `${name} Rose ${Math.round(change * 100)}% in ${fmtMonth(last)}`,
            body: `${usd(now)} vs your usual ${usd(before)}. If it was a one-off, no worries. If not, a weekly cap of ${usd(before / 4.3)} keeps it in line.`,
            monthlyImpact: round2(now - before),
            priority: 45,
          });
        } else if (change < -0.15 && before - now > 25 && categoryOf(cat).group === 'personal') {
          out.push({
            id: `down-${cat}`,
            kind: 'keep',
            title: `Nice: ${name} Down ${Math.round(-change * 100)}%`,
            body: `You spent ${usd(before - now)} less than usual in ${fmtMonth(last)}. Keep this habit. Moving that difference to savings each month adds up to ${usd((before - now) * 12, true)} a year.`,
            monthlyImpact: 0,
            priority: 40,
          });
        }
      }
    }

    // Overspent month
    if (lastSum && lastSum.income > 0 && lastSum.spending > lastSum.income) {
      out.push({
        id: 'overspent',
        kind: 'heads_up',
        title: `${fmtMonth(last)}: Spent ${usd(lastSum.spending - lastSum.income)} More than Came In`,
        body: 'Check Budget → Spending for the biggest categories. The paycheck plan sets aside bills, groceries and gas first, so this is easier to avoid.',
        monthlyImpact: 0,
        priority: 80,
      });
    }

    // Groceries vs USDA
    const h = settings.household;
    const plan = foodPlanMonthly(h, h.foodPlan, inflationSinceReference(i.market));
    const groceries2 = avg(['groceries']);
    if (groceries2 > plan * 1.25) {
      out.push({
        id: 'groceries-high',
        kind: 'cut',
        title: 'Groceries Are Running Above Your Food Plan',
        body: `You average ${usd(groceries2)}; the USDA ${FOOD_PLAN_LABEL[h.foodPlan]} plan for your household is about ${usd(plan)}. Store brands, a weekly meal plan and King Soopers digital coupons can close the gap.`,
        monthlyImpact: round2((groceries2 - plan) * 0.5),
        priority: 55,
      });
    } else if (groceries2 > 0 && groceries2 <= plan) {
      out.push({
        id: 'groceries-good',
        kind: 'keep',
        title: 'Your Grocery Spending Is Right on Plan',
        body: `${usd(groceries2)} a month is at or under the USDA ${FOOD_PLAN_LABEL[h.foodPlan]} plan (${usd(plan)}). Cooking at home is your strongest saving habit, so keep it going.`,
        monthlyImpact: 0,
        priority: 30,
      });
    }

    // Buy now pay later
    const bnpl = txns.filter((t) => months.includes(monthKey(t.date)) && /AFFIRM|KLARNA|AFTERPAY|SEZZLE|ZIP\.CO/i.test(t.description));
    if (bnpl.length >= 2) {
      out.push({
        id: 'bnpl',
        kind: 'quit',
        title: 'Buy-Now-Pay-Later Is Stacking Up',
        body: `${bnpl.length} installment payments recently. They're easy to lose track of; finish the current ones before starting new plans.`,
        monthlyImpact: 0,
        priority: 50,
      });
    }
  }

  // Gas
  if (i.market?.gas && i.market.gas.previous && settings.household.vehicleMpg && settings.household.milesPerMonth) {
    const delta = i.market.gas.price - i.market.gas.previous;
    if (Math.abs(delta) >= 0.05) {
      const gallons = settings.household.milesPerMonth / settings.household.vehicleMpg;
      out.push({
        id: 'gas-move',
        kind: delta > 0 ? 'heads_up' : 'win',
        title: `Gas ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta * 100).toFixed(0)}¢ (${i.market.gas.region})`,
        body: `At ${Math.round(gallons)} gallons a month that's ${delta > 0 ? '+' : '−'}${usd(Math.abs(delta * gallons))}. ${delta > 0 ? 'Your plan already moved a little more into essentials. Fuel points from groceries and warehouse-club gas can save 10–30¢ a gallon.' : 'Your plan freed that money for you and your goals.'}`,
        monthlyImpact: delta > 0 ? 0 : round2(-delta * gallons),
        priority: 58,
      });
    }
  }

  // Three-paycheck months
  const triple = threePaycheckMonths(i.upcomingPaydays).filter((m) => m >= current).slice(0, 1);
  if (triple.length) {
    out.push({
      id: `triple-${triple[0]}`,
      kind: 'save',
      title: `${fmtMonth(triple[0])} Has Three Paydays`,
      body: `Bills are usually covered by two checks, so the third one (about ${usd(i.netPerPaycheck)}) can go mostly to savings. That's a big pile of pebbles in one go.`,
      monthlyImpact: 0,
      priority: 62,
    });
  }

  // Emergency fund
  const monthlyNeeds = monthlyBillsTotal(i.bills);
  const emergency = i.goals.find((g) => g.isEmergency && !g.archived);
  if (!emergency) {
    out.push({
      id: 'emergency-start',
      kind: 'save',
      title: 'Start a Bedrock Fund',
      body: `An emergency fund turns surprises into inconveniences. Aim for ${settings.budget.emergencyMonths} months of bills and essentials. Pebbles fills it first, a little each paycheck.`,
      monthlyImpact: 0,
      priority: 68,
    });
  } else {
    const bal = goalBalance(emergency.id, i.contributions);
    if (monthlyNeeds > 0 && bal >= monthlyNeeds && bal < emergency.target) {
      out.push({
        id: 'emergency-month',
        kind: 'win',
        title: 'One Full Month of Bills Is Covered',
        body: `Your ${emergency.name} holds ${usd(bal, true)}, enough for a month of bills. Pebbles raised the goal to the full emergency fund (${settings.budget.emergencyMonths} months) and keeps a steady share going there; the rest of your savings goes to your other goals.`,
        monthlyImpact: 0,
        priority: 35,
      });
    }
  }

  // No tax on overtime
  if (i.otPremiumYtd > 0 && i.otTaxSaved > 5) {
    out.push({
      id: 'ot-deduction',
      kind: 'win',
      title: `Overtime May Bring a Refund of About ${usd(i.otTaxSaved, true)}`,
      body: `Under the federal "no tax on overtime" deduction (2025–2028), the extra half-time part of your overtime (about ${usd(i.otPremiumYtd, true)} this year) can be deducted when you file. Paychecks still withhold on it, so expect it back at tax time.`,
      monthlyImpact: 0,
      priority: 52,
    });
  }

  // Savings rate
  const rate = savingsRateRecent(i.contributions, asOf, i.netPerPaycheck);
  if (rate != null && i.netPerPaycheck > 0) {
    if (rate >= settings.budget.savingsTargetPct / 100) {
      out.push({
        id: 'rate-good',
        kind: 'win',
        title: `You're Saving ${Math.round(rate * 100)}% of Take-Home`,
        body: 'That beats the 20% guideline most planners recommend. Every paycheck adds to the pile.',
        monthlyImpact: 0,
        priority: 25,
      });
    } else {
      const bump = round2((i.netPerPaycheck * 0.02 * 26) / 12);
      out.push({
        id: 'rate-bump',
        kind: 'save',
        title: 'Nudge Savings Up by 2%',
        body: `You're saving about ${Math.round(rate * 100)}% now. Two more percent is about ${usd((i.netPerPaycheck * 2) / 100)} a check, ${usd(bump * 12, true)} a year, and it's rarely missed.`,
        monthlyImpact: bump,
        priority: 33,
      });
    }
  }

  // Bill audit: biggest bills
  if (i.bills.filter((b) => b.active).length >= 3) {
    const insurance = i.bills.filter((b) => b.active && b.category === 'insurance');
    const phone = i.bills.filter((b) => b.active && b.category === 'phone_internet');
    if (insurance.length) {
      out.push({
        id: 'shop-insurance',
        kind: 'cut',
        title: 'Shop Your Insurance Once a Year',
        body: `You pay ${usd(insurance.reduce((s, b) => s + b.amount, 0))} a month for insurance. Getting two quotes at renewal and raising deductibles (once your Bedrock fund can cover them) often saves 10–20%.`,
        monthlyImpact: round2(insurance.reduce((s, b) => s + b.amount, 0) * 0.12),
        priority: 28,
      });
    }
    const phoneTotal = phone.reduce((s, b) => s + b.amount, 0);
    if (phoneTotal > 90) {
      out.push({
        id: 'phone-plan',
        kind: 'cut',
        title: 'Phone & Internet Look Pricey',
        body: `${usd(phoneTotal)} a month. Prepaid carriers on the same networks (Mint, Visible, US Mobile) run $15–$30 a line, and calling your internet provider about current promos often works.`,
        monthlyImpact: round2(Math.max(0, phoneTotal - 75)),
        priority: 38,
      });
    }
  }

  return out.sort((a, b) => b.priority - a.priority);
}

function countIn(txns: Transaction[], months: string[], cat: string): number {
  return txns.filter((t) => t.category === cat && t.amount < 0 && months.includes(monthKey(t.date))).length;
}

function savingsRateRecent(contributions: Contribution[], asOf: ISODate, netPerCheck: number): number | null {
  const recent = contributions.filter((c) => diffDays(asOf, c.date) <= 62 && diffDays(asOf, c.date) >= 0);
  if (recent.length < 2 || netPerCheck <= 0) return null;
  const total = recent.reduce((s, c) => s + c.amount, 0);
  const checks = 62 / 14;
  return total / (netPerCheck * checks);
}

export function topMerchants(txns: Transaction[], month: string, n = 5): { name: string; total: number; count: number }[] {
  const map = new Map<string, { name: string; total: number; count: number }>();
  for (const t of txns) {
    if (monthKey(t.date) !== month || t.amount >= 0 || t.excluded || categoryOf(t.category).group === 'transfer') continue;
    const name = t.merchant || cleanMerchant(t.description);
    const cur = map.get(name) ?? { name, total: 0, count: 0 };
    cur.total += -t.amount;
    cur.count++;
    map.set(name, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, n);
}

export function monthsBack(current: string, n: number): string[] {
  return Array.from({ length: n }, (_, k) => addMonths(current, -(n - 1 - k)));
}
