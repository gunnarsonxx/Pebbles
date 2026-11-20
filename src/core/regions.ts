// Where you live decides which public price series fit you best.
import { STATE_NAMES } from './taxrules';

/** EIA weekly retail regular gasoline: a state series where EIA has one, otherwise your region (PADD). */
const EIA_STATES: Record<string, string> = { CA: 'SCA', CO: 'SCO', FL: 'SFL', MA: 'SMA', MN: 'SMN', NY: 'SNY', OH: 'SOH', TX: 'STX', WA: 'SWA' };
const PADD: { code: string; name: string; states: string[] }[] = [
  { code: 'R1X', name: 'New England', states: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'] },
  { code: 'R1Y', name: 'Central Atlantic', states: ['DE', 'DC', 'MD', 'NJ', 'NY', 'PA'] },
  { code: 'R1Z', name: 'Lower Atlantic', states: ['FL', 'GA', 'NC', 'SC', 'VA', 'WV'] },
  { code: 'R20', name: 'Midwest', states: ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MN', 'MO', 'NE', 'ND', 'SD', 'OH', 'OK', 'TN', 'WI'] },
  { code: 'R30', name: 'Gulf Coast', states: ['AL', 'AR', 'LA', 'MS', 'NM', 'TX'] },
  { code: 'R40', name: 'Rocky Mountain', states: ['CO', 'ID', 'MT', 'UT', 'WY'] },
  { code: 'R50', name: 'West Coast', states: ['AK', 'AZ', 'CA', 'HI', 'NV', 'OR', 'WA'] },
];

export function gasSeries(state: string): { series: string; label: string } {
  const st = (state || 'CO').toUpperCase();
  if (EIA_STATES[st]) return { series: `EMM_EPMR_PTE_${EIA_STATES[st]}_DPG`, label: `${STATE_NAMES[st] ?? st} Average` };
  const p = PADD.find((x) => x.states.includes(st));
  if (p) return { series: `EMM_EPMR_PTE_${p.code}_DPG`, label: `${p.name} Average` };
  return { series: 'EMM_EPMR_PTE_NUS_DPG', label: 'U.S. Average' };
}

/** BLS's four Census regions, for food prices. */
const BLS_REGIONS: { code: string; name: string; states: string[] }[] = [
  { code: '0100', name: 'Northeast', states: ['CT', 'ME', 'MA', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'] },
  { code: '0200', name: 'Midwest', states: ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'] },
  { code: '0300', name: 'South', states: ['AL', 'AR', 'DE', 'DC', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV'] },
  { code: '0400', name: 'West', states: ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'NM', 'OR', 'UT', 'WA', 'WY'] },
];

export function blsRegion(state: string): { code: string; name: string } {
  const st = (state || 'CO').toUpperCase();
  const r = BLS_REGIONS.find((x) => x.states.includes(st)) ?? BLS_REGIONS[3];
  return { code: r.code, name: r.name };
}

/**
 * A rough state income tax withholding rate (percent of taxable pay) for a typical single worker, for states
 * Pebbles doesn't model bracket by bracket. Upload a pay stub and Pebbles switches to your real rate.
 * 0 = no state income tax on wages.
 */
export const STATE_APPROX_RATE: Record<string, number> = {
  AL: 4.0,
  AK: 0,
  AZ: 2.5,
  AR: 3.4,
  CA: 3.5,
  CO: 4.4,
  CT: 4.5,
  DE: 4.6,
  DC: 5.5,
  FL: 0,
  GA: 5.1,
  HI: 6.4,
  ID: 5.3,
  IL: 4.95,
  IN: 3.0,
  IA: 3.8,
  KS: 5.0,
  KY: 3.5,
  LA: 3.0,
  ME: 5.5,
  MD: 4.75,
  MA: 5.0,
  MI: 4.25,
  MN: 5.4,
  MS: 4.0,
  MO: 4.2,
  MT: 4.5,
  NE: 4.4,
  NV: 0,
  NH: 0,
  NJ: 3.0,
  NM: 3.4,
  NY: 5.0,
  NC: 3.99,
  ND: 1.5,
  OH: 2.75,
  OK: 4.0,
  OR: 7.5,
  PA: 3.07,
  RI: 3.75,
  SC: 4.0,
  SD: 0,
  TN: 0,
  TX: 0,
  UT: 4.5,
  VT: 4.5,
  VA: 4.8,
  WA: 0,
  WV: 4.0,
  WI: 4.5,
  WY: 0,
};
