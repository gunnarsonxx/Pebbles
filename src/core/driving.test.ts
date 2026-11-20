import { describe, expect, it } from 'vitest';
import { drivingStats, fillupMpg, monthlyFuelCost, trustworthy } from './driving';
import { sellsGas, googleSellsGas } from './gas';
import { projectSavings, monthlyRate } from './savingsAccount';
import type { DriveEntry } from './types';

const e = (date: string, odometer: number, extra: Partial<DriveEntry> = {}): DriveEntry => ({ id: date + odometer, date, at: Date.parse(date), odometer, ...extra });

describe('driving log', () => {
  const log = [
    e('2026-10-30', 48210, { gallons: 11.2, perGallon: 2.99 }),
    e('2026-11-02', 48302),
    e('2026-11-06', 48455, { dashMpg: 27.8 }),
    e('2026-11-10', 48560, { gallons: 10.9 }),
    e('2026-11-14', 48701),
    e('2026-11-19', 48862, { gallons: 11.4 }),
  ];
  it('miles a day and a month, and mpg from fill-ups (miles between them ÷ gallons to refill)', () => {
    const s = drivingStats(log, '2026-11-20')!;
    expect(s.milesPerDay).toBe(32.6); // 652 mi over 20 days
    expect(s.milesPerMonth).toBe(991);
    expect(fillupMpg(log)).toEqual({ mpg: 29.24, fillups: 2 }); // 652 mi ÷ 22.3 gal
    expect(s.mpgFrom).toBe('fillups');
    expect(trustworthy(s)).toBe(true);
    expect(monthlyFuelCost(s.milesPerMonth, s.mpg!, 2.99)).toBe(101.34);
  });
  it('splits miles between work days and days off', () => {
    const work = new Set(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    const s = drivingStats(log, '2026-11-20', work)!;
    expect(s.work?.days).toBe(4);
    expect(s.off?.days).toBe(16);
  });
  it('uses the dash mpg until there are two fill-ups, and ignores a backwards typo', () => {
    const s = drivingStats([e('2026-11-01', 1000), e('2026-11-05', 1100, { dashMpg: 30 }), e('2026-11-06', 900)], '2026-11-07')!;
    expect(s.mpgFrom).toBe('dash');
    expect(s.mpg).toBe(30);
    expect(trustworthy(drivingStats([e('2026-11-01', 1000), e('2026-11-03', 1060)], '2026-11-04'))).toBe(false); // too soon to trust
  });
});

describe('gas stations', () => {
  it('drops closed places and ones without pumps', () => {
    expect(sellsGas({ amenity: 'fuel', name: 'Shell' })).toBe(true);
    expect(sellsGas({ amenity: 'fuel', name: 'Old Conoco', disused: 'yes' })).toBe(false);
    expect(sellsGas({ amenity: 'fuel', name: 'AmeriGas Propane' })).toBe(false);
    expect(sellsGas({ amenity: 'fuel', 'fuel:lpg': 'yes' })).toBe(false);
    expect(sellsGas({ amenity: 'fuel', 'fuel:lpg': 'yes', 'fuel:octane_87': 'yes' })).toBe(true);
    expect(googleSellsGas({ businessStatus: 'CLOSED_PERMANENTLY', primaryType: 'gas_station' })).toBe(false);
    expect(googleSellsGas({ businessStatus: 'OPERATIONAL', primaryType: 'convenience_store', displayName: { text: 'Corner Market' } })).toBe(false);
    expect(googleSellsGas({ businessStatus: 'OPERATIONAL', primaryType: 'convenience_store', displayName: { text: '7-Eleven' } })).toBe(true);
  });
});

describe('savings projection', () => {
  it('balance + 12 months of deposits + interest', () => {
    const p = projectSavings(2450, 3.65, 628.33, 12);
    expect(monthlyRate(3.65)).toBeCloseTo(0.002994, 5);
    expect(p[12].balance).toBeCloseTo(2450 + 628.33 * 12 + p[12].interestTotal, 1);
  });
});
