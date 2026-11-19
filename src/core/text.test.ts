import { describe, expect, it } from 'vitest';
import { titleCase } from './text';

describe('titleCase', () => {
  it.each([
    ['Shorter day', 'Shorter Day'],
    ['Federal income tax', 'Federal Income Tax'],
    ['Upload a pay stub', 'Upload a Pay Stub'],
    ['Estimated take-home', 'Estimated Take-Home'],
    ['How we got there', 'How We Got There'],
    ['Pay & schedule', 'Pay & Schedule'],
    ['Employer 401(k) match', 'Employer 401(k) Match'],
    ['FICA', 'FICA'],
    ['W-4 step 2', 'W-4 Step 2'],
    ['Where your next dollar goes', 'Where Your Next Dollar Goes'],
    ['Money already in Marcus', 'Money Already in Marcus'],
    ['Year-to-date', 'Year-to-Date'],
    ['What it’s for', 'What It’s For'],
    ['King Soopers prices', 'King Soopers Prices'],
  ])('%s → %s', (a, b) => expect(titleCase(a)).toBe(b));
});
