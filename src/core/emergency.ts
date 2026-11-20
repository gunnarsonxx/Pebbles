// The Bedrock (emergency) fund grows in steps: a starter month of expenses, then the full fund.
// Pebbles moves the goal's target up on its own as each step is reached (and as your expenses change),
// and once the full fund is there, savings go to your other goals.
import { round2 } from './money';
import type { Goal } from './types';

export interface EmergencyLevel {
  months: number;
  name: string;
  amount: number;
}

export interface EmergencyStatus {
  goalId: string;
  balance: number;
  monthlyNeeds: number;
  levels: EmergencyLevel[];
  step: number; // index of the level being built; levels.length when all are reached
  target: number; // what the goal's target should be now
  full: boolean; // the last level is reached: savings can go elsewhere
  monthsCovered: number;
}

const roundUp = (x: number, step = 50) => Math.ceil(x / step) * step;

export function emergencyLevels(monthlyNeeds: number, fullMonths: number): EmergencyLevel[] {
  const full = Math.max(1, fullMonths);
  const months = [...new Set([1, Math.min(3, full), full])].sort((a, b) => a - b);
  return months.map((m, i) => ({
    months: m,
    name: i === 0 ? 'Starter Emergency Fund' : m === full ? 'Full Emergency Fund' : `${m} Months Saved`,
    amount: roundUp(monthlyNeeds * m),
  }));
}

export function emergencyStatus(goal: Goal | undefined, balance: number, monthlyNeeds: number, fullMonths: number): EmergencyStatus | null {
  if (!goal || monthlyNeeds <= 0) return null;
  const levels = emergencyLevels(monthlyNeeds, fullMonths);
  // a little slack so a few dollars of spending doesn't knock you back a step
  let step = levels.findIndex((l) => balance < l.amount - Math.max(10, l.amount * 0.01));
  if (step < 0) step = levels.length;
  const full = step >= levels.length;
  return {
    goalId: goal.id,
    balance,
    monthlyNeeds,
    levels,
    step,
    target: full ? levels[levels.length - 1].amount : levels[step].amount,
    full,
    monthsCovered: round2(balance / monthlyNeeds),
  };
}

/** Whether the goal should follow the steps (on unless you turned it off). */
export const autoTarget = (g: Goal) => g.isEmergency && g.autoTarget !== false;

/** The change to make to the goal, if any: a new target, and reopening it when it fell below. */
export function emergencyGoalUpdate(goal: Goal, s: EmergencyStatus): Partial<Goal> | null {
  if (!autoTarget(goal)) return null;
  const patch: Partial<Goal> = {};
  // only move for a real change (a new step, or expenses moved by more than ~2%)
  if (Math.abs(goal.target - s.target) > Math.max(25, s.target * 0.02)) patch.target = s.target;
  const target = patch.target ?? goal.target;
  if (s.full && s.balance >= target - Math.max(10, target * 0.01)) {
    if (!goal.completedAt) patch.completedAt = Date.now();
  } else if (goal.completedAt) patch.completedAt = null; // spent some, or expenses went up: build it back
  return Object.keys(patch).length ? patch : null;
}
