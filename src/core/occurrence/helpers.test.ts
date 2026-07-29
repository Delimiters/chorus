import { civilDate } from '../civil/date';
import type { CalendarConfig } from '../civil/types';
import { expandOccurrences } from '../recurrence/expand';
import type { Occurrence } from '../recurrence/types';
import { keyForSubject } from './project';

const CAL: CalendarConfig = { weekStartsOn: 0, timeZone: 'UTC' };
const ANCHOR = civilDate('2026-01-04');

const occurrence = (): Occurrence =>
  expandOccurrences(
    'chore-9',
    { rule: { kind: 'daily', everyNDays: 1 }, startsOn: ANCHOR, endsOn: null, timeOfDay: null },
    CAL,
    { start: ANCHOR, end: ANCHOR },
  )[0] as Occurrence;

describe('keyForSubject', () => {
  it('rebuilds the key an occurrence would have for a given subject', () => {
    const occ = occurrence();
    expect(keyForSubject(occ, null)).toBe(occ.occurrenceKey);
    expect(keyForSubject(occ, 'alice')).toContain(':alice');
    expect(keyForSubject(occ, 'alice')).not.toBe(keyForSubject(occ, 'bob'));
  });
});
