import { describe, expect, it } from 'vitest';
import { buildList } from './pantry';
import type { PantryItem } from './types';

const item = (id: string, extra: Partial<PantryItem>): PantryItem => ({
  id,
  name: id,
  key: id,
  dept: 'pantry',
  mode: 'level',
  qty: 0,
  unit: 'ct',
  perBuy: 1,
  lowAt: 0,
  level: 'low',
  lastBought: null,
  ...extra,
});

describe('what goes on the grocery list by itself', () => {
  it('only staples; other low things are suggestions', () => {
    const lines = buildList([item('Milk', { always: true, level: 'out' }), item('Gochujang', { level: 'low' })], [], [], '2026-11-21', () => null);
    expect(lines.find((l) => l.name === 'Milk')!.why).toBe('out');
    expect(lines.find((l) => l.name === 'Gochujang')!.why).toBe('due'); // "Maybe Running Low", not on the list
  });
});
