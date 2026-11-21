// Bills and paydays as a calendar file (.ics) any phone calendar can import, including
// Samsung Calendar. Each bill is one repeating event with a reminder the day before.
import { addDays } from './dates';
import { billDueDates, yourAmount } from './budget';
import type { Bill, ISODate } from './types';

const fold = (line: string) => {
  // calendar lines are limited to 75 characters; longer ones continue on the next line after a space
  const out: string[] = [];
  let s = line;
  while (s.length > 74) {
    out.push(s.slice(0, 74));
    s = ' ' + s.slice(74);
  }
  out.push(s);
  return out.join('\r\n');
};
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const day = (d: ISODate) => d.replace(/-/g, '');
const money = (n: number) => `$${n.toFixed(2)}`;

function firstDue(b: Bill, from: ISODate): ISODate {
  return billDueDates(b, from, addDays(from, 400))[0] ?? from;
}

function rrule(b: Bill): string {
  switch (b.frequency) {
    case 'monthly':
      return `RRULE:FREQ=MONTHLY;BYMONTHDAY=${b.dueDay > 28 ? -1 : b.dueDay}`;
    case 'semiannual':
      return `RRULE:FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=${b.dueDay > 28 ? -1 : b.dueDay}`;
    case 'quarterly':
      return `RRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${b.dueDay > 28 ? -1 : b.dueDay}`;
    case 'yearly':
      return 'RRULE:FREQ=YEARLY';
    case 'weekly':
      return 'RRULE:FREQ=WEEKLY';
    case 'biweekly':
      return 'RRULE:FREQ=WEEKLY;INTERVAL=2';
  }
}

export function billsCalendar(bills: Bill[], today: ISODate, firstPayday?: ISODate): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pebbles//Bills//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Pebbles bills'];
  for (const b of bills.filter((x) => x.active)) {
    const start = firstDue(b, today);
    const amt = yourAmount(b);
    lines.push(
      'BEGIN:VEVENT',
      `UID:pebbles-bill-${b.id}@pebbles.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(start)}`,
      `DTEND;VALUE=DATE:${day(addDays(start, 1))}`,
      rrule(b),
      fold(`SUMMARY:${esc(`${b.name} ${money(b.amount)}${amt !== b.amount ? ` (your share ${money(amt)})` : ''}${b.autopay ? ' · autopay' : ''}`)}`),
      fold(`DESCRIPTION:${esc('From Pebbles. Change bills in Pebbles, then add the calendar again.')}`),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${esc(`${b.name} is due tomorrow`)}`),
      'TRIGGER:-PT15H', // 9 a.m. the day before
      'END:VALARM',
      'END:VEVENT',
    );
  }
  if (firstPayday) {
    lines.push(
      'BEGIN:VEVENT',
      'UID:pebbles-payday@pebbles.app',
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(firstPayday)}`,
      `DTEND;VALUE=DATE:${day(addDays(firstPayday, 1))}`,
      'RRULE:FREQ=WEEKLY;INTERVAL=2',
      'SUMMARY:Payday',
      fold(`DESCRIPTION:${esc('Open Pebbles to see what to move where.')}`),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
