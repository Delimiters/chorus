import { civilDate } from '../civil/date';
import type { CalendarConfig } from '../civil/types';
import { expandOccurrences } from '../recurrence/expand';
import { occurrenceKeyOf } from '../recurrence/period';
import type { Occurrence, Schedule } from '../recurrence/types';
import { assigneeFor, fanOut, rosterOn, turnFor } from './assign';
import type { Assignment, RotationCadence } from './types';
import { isFanOut } from './types';

const CAL: CalendarConfig = { weekStartsOn: 0 };
const ANCHOR = civilDate('2026-01-04');

const schedule: Schedule = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: ANCHOR,
  endsOn: null,
  timeOfDay: null,
};

const anOccurrence = (): Occurrence =>
  expandOccurrences('chore', schedule, CAL, { start: ANCHOR, end: ANCHOR })[0] as Occurrence;

describe('rosterOn', () => {
  const rotate: Assignment = {
    kind: 'rotate',
    cadence: { unit: 'occurrence', every: 1 },
    segments: [
      { effectiveFrom: civilDate('2026-01-01'), memberIds: ['alice', 'bob'], offset: 0 },
      { effectiveFrom: civilDate('2026-06-01'), memberIds: ['alice', 'carol'], offset: 0 },
    ],
  };

  it('returns the roster in effect on a date', () => {
    expect(rosterOn(rotate, civilDate('2026-03-01'))).toEqual(['alice', 'bob']);
    expect(rosterOn(rotate, civilDate('2026-07-01'))).toEqual(['alice', 'carol']);
  });

  it('returns empty before any segment applies', () => {
    expect(rosterOn(rotate, civilDate('2025-01-01'))).toEqual([]);
  });

  it('returns empty for non-rotating assignments', () => {
    expect(rosterOn({ kind: 'anyone' }, ANCHOR)).toEqual([]);
    expect(rosterOn({ kind: 'fixed', memberId: 'alice' }, ANCHOR)).toEqual([]);
    expect(rosterOn({ kind: 'everyone' }, ANCHOR)).toEqual([]);
  });
});

describe('fanOut', () => {
  const keyFor = (occ: Occurrence, subject: string) =>
    occurrenceKeyOf(occ.choreId, occ.periodKey, occ.slot, subject);

  it('produces one occurrence per member for everyone chores', () => {
    const result = fanOut(anOccurrence(), { kind: 'everyone' }, ['alice', 'bob'], keyFor);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.subject)).toEqual(['alice', 'bob']);
    expect(new Set(result.map((o) => o.occurrenceKey)).size).toBe(2);
  });

  it('leaves the date and index untouched', () => {
    const original = anOccurrence();
    for (const copy of fanOut(original, { kind: 'everyone' }, ['alice'], keyFor)) {
      expect(copy.dueOn).toBe(original.dueOn);
      expect(copy.occurrenceIndex).toBe(original.occurrenceIndex);
    }
  });

  it('passes non-fan-out assignments straight through', () => {
    const original = anOccurrence();
    for (const assignment of [
      { kind: 'anyone' },
      { kind: 'fixed', memberId: 'alice' },
      { kind: 'rotate', cadence: { unit: 'occurrence', every: 1 }, segments: [] },
    ] satisfies Assignment[]) {
      expect(fanOut(original, assignment, ['alice', 'bob'], keyFor)).toEqual([original]);
    }
  });

  it('produces nothing for an empty roster', () => {
    expect(fanOut(anOccurrence(), { kind: 'everyone' }, [], keyFor)).toEqual([]);
  });
});

describe('isFanOut', () => {
  it('is true only for everyone', () => {
    expect(isFanOut({ kind: 'everyone' })).toBe(true);
    expect(isFanOut({ kind: 'anyone' })).toBe(false);
    expect(isFanOut({ kind: 'fixed', memberId: 'a' })).toBe(false);
  });
});

describe('turnFor exhaustiveness', () => {
  it('rejects an unknown cadence unit', () => {
    const bogus = { unit: 'fortnight', every: 1 } as unknown as RotationCadence;
    expect(() => turnFor(anOccurrence(), bogus, CAL, ANCHOR)).toThrow(/Unhandled rotation cadence/);
  });
});

describe('assigneeFor exhaustiveness', () => {
  it('rejects an unknown assignment kind', () => {
    const bogus = { kind: 'auction' } as unknown as Assignment;
    expect(() => assigneeFor(anOccurrence(), bogus, CAL, ANCHOR)).toThrow(/Unhandled assignment/);
  });

  it('handles a turn before the anchor without going out of bounds', () => {
    // A date-based cadence can produce a negative turn when an occurrence
    // predates the schedule anchor. The modulo must still land in range.
    const occ: Occurrence = { ...anOccurrence(), dueOn: civilDate('2025-06-01') };
    const assignment: Assignment = {
      kind: 'rotate',
      cadence: { unit: 'month', every: 1 },
      segments: [
        { effectiveFrom: civilDate('2025-01-01'), memberIds: ['alice', 'bob'], offset: 0 },
      ],
    };
    const resolved = assigneeFor(occ, assignment, CAL, ANCHOR);
    expect(resolved.kind).toBe('member');
    expect(resolved.kind === 'member' && ['alice', 'bob']).toContain(
      resolved.kind === 'member' ? resolved.memberId : '',
    );
  });
});
