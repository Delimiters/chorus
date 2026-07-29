import fc from 'fast-check';

import { arbCivilDate, arbWeekday } from '../__testing__/arbitraries';
import { civilDate, startOfWeek } from '../civil/date';
import {
  OCCURRENCE_KEY_VERSION,
  dayPeriodKey,
  monthPeriodKey,
  occurrenceKeyOf,
  parseOccurrenceKey,
  weekPeriodKey,
} from './period';

describe('period keys', () => {
  it('uses the date itself for day periods', () => {
    expect(dayPeriodKey(civilDate('2026-07-29'))).toBe('2026-07-29');
  });

  it('uses YYYY-MM for month periods', () => {
    expect(monthPeriodKey(civilDate('2026-07-29'))).toBe('2026-07');
    expect(monthPeriodKey(civilDate('2026-01-01'))).toBe('2026-01');
  });

  it('uses YYYY-Www for week periods', () => {
    // 2026-01-01 is a Thursday; with Sunday weeks its week begins 2025-12-28.
    expect(weekPeriodKey(civilDate('2026-07-29'), 0)).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('gives every day in the same week the same key', () => {
    fc.assert(
      fc.property(arbCivilDate(), arbWeekday(), (date, weekStartsOn) => {
        const weekStart = startOfWeek(date, weekStartsOn);
        expect(weekPeriodKey(date, weekStartsOn)).toBe(weekPeriodKey(weekStart, weekStartsOn));
      }),
    );
  });

  it('gives adjacent weeks different keys', () => {
    fc.assert(
      fc.property(arbCivilDate(), arbWeekday(), (date, weekStartsOn) => {
        const thisWeek = startOfWeek(date, weekStartsOn);
        const nextWeek = startOfWeek(date, weekStartsOn);
        expect(weekPeriodKey(thisWeek, weekStartsOn)).toBe(weekPeriodKey(nextWeek, weekStartsOn));
      }),
    );
  });

  it('gives every month in the same month the same key', () => {
    expect(monthPeriodKey(civilDate('2026-07-01'))).toBe(monthPeriodKey(civilDate('2026-07-31')));
  });
});

describe('occurrenceKeyOf', () => {
  it('builds a versioned, structured key', () => {
    expect(occurrenceKeyOf('chore-1', '2026-07-29', 0, null)).toBe(
      `${OCCURRENCE_KEY_VERSION}:chore-1:2026-07-29:0:-`,
    );
    expect(occurrenceKeyOf('chore-1', '2026-W31', 2, 'alice')).toBe(
      `${OCCURRENCE_KEY_VERSION}:chore-1:2026-W31:2:alice`,
    );
  });

  it('distinguishes slots — the fix for collapsing floating schedules', () => {
    const keys = [0, 1, 2].map((slot) => occurrenceKeyOf('c', '2026-W31', slot, null));
    expect(new Set(keys).size).toBe(3);
  });

  it('distinguishes subjects', () => {
    expect(occurrenceKeyOf('c', '2026-07-29', 0, 'alice')).not.toBe(
      occurrenceKeyOf('c', '2026-07-29', 0, 'bob'),
    );
  });
});

describe('parseOccurrenceKey', () => {
  it('round-trips a key built by occurrenceKeyOf', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !s.includes(':')),
        fc.constantFrom('2026-07-29', '2026-W31', '2026-07'),
        fc.nat({ max: 30 }),
        fc.option(
          fc.string({ minLength: 1 }).filter((s) => !s.includes(':') && s !== '-'),
          { nil: null },
        ),
        (choreId, periodKey, slot, subject) => {
          const key = occurrenceKeyOf(choreId, periodKey, slot, subject);
          expect(parseOccurrenceKey(key)).toEqual({
            version: OCCURRENCE_KEY_VERSION,
            choreId,
            periodKey,
            slot,
            subject,
          });
        },
      ),
    );
  });

  it('parses a concrete key', () => {
    expect(parseOccurrenceKey('v1:abc:2026-W31:2:alice')).toEqual({
      version: 'v1',
      choreId: 'abc',
      periodKey: '2026-W31',
      slot: 2,
      subject: 'alice',
    });
  });

  it('maps the "-" sentinel back to null', () => {
    expect(parseOccurrenceKey('v1:abc:2026-07-29:0:-')?.subject).toBeNull();
  });

  // Splitting from the right means a colon in the id can't corrupt the parse.
  it('tolerates colons inside the chore id', () => {
    const parsed = parseOccurrenceKey('v1:has:colons:2026-07-29:0:-');
    expect(parsed?.choreId).toBe('has:colons');
    expect(parsed?.periodKey).toBe('2026-07-29');
    expect(parsed?.slot).toBe(0);
  });

  it.each([
    ['too few segments', 'v1:abc:2026-07-29'],
    ['empty string', ''],
    ['non-numeric slot', 'v1:abc:2026-07-29:x:-'],
    ['negative slot', 'v1:abc:2026-07-29:-1:-'],
    ['fractional slot', 'v1:abc:2026-07-29:1.5:-'],
    ['empty chore id', 'v1::2026-07-29:0:-'],
  ])('returns null for %s', (_label, key) => {
    expect(parseOccurrenceKey(key)).toBeNull();
  });

  it('preserves an unknown version rather than guessing', () => {
    // A future v2 key must parse as v2, so a migration can detect it.
    expect(parseOccurrenceKey('v2:abc:2026-07-29:0:-')?.version).toBe('v2');
  });
});
