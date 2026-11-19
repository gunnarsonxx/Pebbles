import bundled from '../../data/guidelines.json';
import { monthlyBillsTotal, type EssentialsEstimate, type PaycheckPlan } from './budget';
import type { Bill } from './types';

export interface GuidelinesFile {
  schema: number;
  version: string;
  about?: string;
  targets: {
    needsMaxPctOfNet: number;
    wantsMaxPctOfNet: number;
    savingsTargetPctOfNet: number;
    savingsMinPctOfNet: number;
    retirementPctOfGross: number;
    emergencyStarterMonths: number;
    emergencyMinMonths: number;
    emergencyMaxMonths: number;
    housingMaxPctOfGross: number;
  };
  consensus: string[];
  sources: { name: string; by: string; summary: string }[];
}

export const BUNDLED_GUIDELINES = bundled as GuidelinesFile;
export const GUIDELINES_URL = 'https://raw.githubusercontent.com/gunnarsonxx/Pebbles/main/data/guidelines.json';

export function isValidGuidelines(x: unknown): x is GuidelinesFile {
  const g = x as GuidelinesFile;
  return !!g && g.schema === 1 && typeof g.version === 'string' && !!g.targets && typeof g.targets.needsMaxPctOfNet === 'number';
}

export type Standing = 'good' | 'close' | 'off';

export interface GuidelineCheck {
  id: string;
  label: string;
  yours: string;
  target: string;
  standing: Standing;
  note: string;
}

export function checkGuidelines(opts: {
  g: GuidelinesFile;
  plan: PaycheckPlan;
  grossPerCheck: number;
  retirementPerCheck: number;
  emergencyBalance: number | null;
  essentials: EssentialsEstimate;
  bills: Bill[];
}): GuidelineCheck[] {
  const { g, plan, grossPerCheck, retirementPerCheck, emergencyBalance, essentials, bills } = opts;
  const t = g.targets;
  const net = plan.net || 1;
  const pct = (x: number) => `${Math.round(x)}%`;
  const out: GuidelineCheck[] = [];

  const needs = ((plan.bills + plan.essentials) / net) * 100;
  out.push({
    id: 'needs',
    label: 'Needs (Bills + Essentials)',
    yours: pct(needs),
    target: `≤ ${t.needsMaxPctOfNet}%`,
    standing: needs <= t.needsMaxPctOfNet ? 'good' : needs <= t.needsMaxPctOfNet + 10 ? 'close' : 'off',
    note: needs <= t.needsMaxPctOfNet ? 'Right where the experts suggest.' : 'Higher than ideal. Field notes point out the easiest places to trim.',
  });

  const save = (plan.savings / net) * 100;
  out.push({
    id: 'savings',
    label: 'Savings',
    yours: pct(save),
    target: `${t.savingsTargetPctOfNet}% (at least ${t.savingsMinPctOfNet}%)`,
    standing: save >= t.savingsTargetPctOfNet - 1 ? 'good' : save >= t.savingsMinPctOfNet ? 'close' : 'off',
    note: save >= t.savingsTargetPctOfNet - 1 ? 'On target.' : save >= t.savingsMinPctOfNet ? 'Still building. Pebbles raises it as room opens up.' : 'Below the minimum this check.',
  });

  const wants = (Math.max(0, plan.personal) / net) * 100;
  out.push({
    id: 'wants',
    label: 'Yours to Spend',
    yours: pct(wants),
    target: `≤ ${t.wantsMaxPctOfNet}%`,
    standing: wants <= t.wantsMaxPctOfNet + 2 ? 'good' : 'close',
    note: wants <= t.wantsMaxPctOfNet + 2 ? 'Comfortable and balanced.' : 'Room to save a bit more if you’d like to reach goals sooner.',
  });

  const monthlyNeeds = monthlyBillsTotal(bills) + essentials.totalMonthly;
  if (emergencyBalance != null && monthlyNeeds > 0) {
    const months = emergencyBalance / monthlyNeeds;
    out.push({
      id: 'emergency',
      label: 'Emergency Fund',
      yours: `${months.toFixed(1)} months`,
      target: `${t.emergencyMinMonths}–${t.emergencyMaxMonths} months`,
      standing: months >= t.emergencyMinMonths ? 'good' : months >= t.emergencyStarterMonths ? 'close' : 'off',
      note: months >= t.emergencyMinMonths ? 'Your safety net is solid.' : months >= t.emergencyStarterMonths ? 'First month done. Keep building.' : 'Pebbles fills this first.',
    });
  }

  if (grossPerCheck > 0) {
    const ret = (retirementPerCheck / grossPerCheck) * 100;
    out.push({
      id: 'retirement',
      label: 'Retirement (From Your Paycheck)',
      yours: pct(ret),
      target: `${t.retirementPctOfGross}% incl. match`,
      standing: ret >= t.retirementPctOfGross ? 'good' : ret > 0 ? 'close' : 'off',
      note: ret > 0 ? 'Make sure you get any employer match: it’s free money.' : 'If your job offers a 401(k) match, start with enough to get the full match.',
    });
  }

  const rent = bills.filter((b) => b.active && b.category === 'housing').reduce((s, b) => s + b.amount, 0);
  if (rent > 0 && grossPerCheck > 0) {
    const monthlyGross = (grossPerCheck * 26) / 12;
    const h = (rent / monthlyGross) * 100;
    out.push({
      id: 'housing',
      label: 'Housing',
      yours: pct(h),
      target: `≤ ${t.housingMaxPctOfGross}% of gross`,
      standing: h <= t.housingMaxPctOfGross ? 'good' : h <= t.housingMaxPctOfGross + 8 ? 'close' : 'off',
      note: h <= t.housingMaxPctOfGross ? 'Affordable by the usual measure.' : 'Rent takes a big share; everything else has to fit around it.',
    });
  }
  return out;
}
