// Grocery and gas cost estimates.
//
// Food: USDA Food Plans ("Cost of Food at Home"). The official May 2026 report puts
// the Thrifty plan for a reference family of four at $1,018.20/month. Per-person
// values below are derived from that report using the plan's age/sex shares and the
// usual plan-to-plan ratios, then adjusted for household size the way USDA advises.
// When live CPI data is available, costs are scaled by food-at-home inflation since
// the reference month.
import type { HouseholdSettings, MarketData } from './types';
import { round2 } from './money';

export const FOOD_PLAN_REFERENCE = { month: '2026-05', label: 'USDA Food Plans, May 2026' };

// monthly cost per person, in a 4-person household
const PER_PERSON = {
  adult: { thrifty: 283, low: 300, moderate: 376, liberal: 458 },
  child: { thrifty: 226, low: 240, moderate: 300, liberal: 366 },
  senior: { thrifty: 269, low: 285, moderate: 357, liberal: 435 },
};

export const FOOD_PLAN_LABEL: Record<HouseholdSettings['foodPlan'], string> = {
  thrifty: 'Thrifty',
  low: 'Low-cost',
  moderate: 'Moderate',
  liberal: 'Liberal',
};

export function householdSize(h: HouseholdSettings): number {
  return Math.max(1, (h.adults || 0) + (h.children || 0) + (h.seniors || 0));
}

function sizeFactor(n: number): number {
  if (n <= 1) return 1.2;
  if (n === 2) return 1.1;
  if (n === 3) return 1.05;
  if (n === 4) return 1;
  if (n <= 6) return 0.95;
  return 0.9;
}

export function foodPlanMonthly(h: HouseholdSettings, plan: HouseholdSettings['foodPlan'] = h.foodPlan, inflationSinceRef = 0): number {
  const base =
    (h.adults || 0) * PER_PERSON.adult[plan] + (h.children || 0) * PER_PERSON.child[plan] + (h.seniors || 0) * PER_PERSON.senior[plan];
  const n = householdSize(h);
  const v = (base || PER_PERSON.adult[plan]) * sizeFactor(n) * (1 + inflationSinceRef);
  return round2(v);
}

/** Food-at-home inflation since the USDA reference month, estimated from the YoY CPI. */
export function inflationSinceReference(market: MarketData | null): number {
  if (!market?.foodCpi) return 0;
  const [ry, rm] = FOOD_PLAN_REFERENCE.month.split('-').map(Number);
  const [y, m] = market.foodCpi.asOf.slice(0, 7).split('-').map(Number);
  const months = Math.max(0, (y - ry) * 12 + (m - rm));
  return (((market.foodCpi.yoyPct ?? 0) / 100) * months) / 12;
}

export function currentGasPrice(market: MarketData | null): { price: number; source: string } | null {
  if (market?.manualGasPrice) return { price: market.manualGasPrice, source: 'your price' };
  if (market?.gas) return { price: market.gas.price, source: market.gas.region };
  return null;
}

export const FALLBACK_GAS_PRICE = 3.05; // Colorado regular, late 2026 ballpark; replaced by live data

export function gasMonthly(h: HouseholdSettings, market: MarketData | null): number | null {
  if (!h.vehicleMpg || !h.milesPerMonth) return null;
  const price = currentGasPrice(market)?.price ?? FALLBACK_GAS_PRICE;
  return round2((h.milesPerMonth / h.vehicleMpg) * price * 1.05); // 5% cushion
}
