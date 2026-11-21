import { describe, expect, it } from 'vitest';
import { stubHours } from './paystub';

describe('hours on a pay stub', () => {
  it('adds up regular, overtime and paid leave, and tells leave apart', () => {
    const h = stubHours({
      hours: [
        { label: 'Regular', hours: 64 },
        { label: 'Overtime', hours: 4.5 },
        { label: 'PTO', hours: 8 },
      ],
    });
    expect(h).toEqual({ worked: 68.5, leave: 8, total: 76.5 });
  });
  it('is unknown when the stub lists no hours', () => {
    expect(stubHours({ hours: [] })).toBeNull();
  });
});
