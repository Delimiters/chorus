import fc from 'fast-check';

import { arbCivilDate, arbEpochDay, arbNthWeek, arbWeekday } from '../__testing__/arbitraries';
import type { CivilDate } from './types';
import {
  InvalidCivilDateError,
  addDays,
  addMonthsClamped,
  civilDate,
  compareCivil,
  daysBetween,
  daysInMonth,
  endOfMonth,
  fromEpochDay,
  fromParts,
  isAfter,
  isBefore,
  isLeapYear,
  isSameOrAfter,
  isSameOrBefore,
  isWithin,
  maxCivil,
  minCivil,
  monthsBetween,
  nthWeekdayOfMonth,
  partsOf,
  startOfMonth,
  startOfWeek,
  toEpochDay,
  tryCivilDate,
  weekdayOf,
  weeksBetween,
} from './date';

const d = (s: string): CivilDate => civilDate(s);

describe('validation', () => {
  it.each([
    '2026-01-01',
    '2026-12-31',
    '2024-02-29', // leap year
    '2000-02-29', // divisible by 400
  ])('accepts %s', (s) => {
    expect(civilDate(s)).toBe(s);
  });

  it.each([
    ['2026-02-30', 'day does not exist'],
    ['2026-02-29', 'not a leap year'],
    ['1900-02-29', 'century not divisible by 400'],
    ['2026-13-01', 'month out of range'],
    ['2026-00-01', 'month out of range'],
    ['2026-01-00', 'day below range'],
    ['2026-04-31', 'April has 30 days'],
    ['26-01-01', 'malformed'],
    ['2026-1-1', 'unpadded'],
    ['not a date', 'malformed'],
    ['', 'empty'],
  ])('rejects %s (%s)', (s) => {
    expect(() => civilDate(s)).toThrow(InvalidCivilDateError);
    expect(tryCivilDate(s)).toBeNull();
  });

  it('reports the reason in the error message', () => {
    expect(() => civilDate('2026-02-30')).toThrow(/day 30 does not exist in 2026-02/);
  });
});

describe('leap years and month lengths', () => {
  it.each([
    [2024, true],
    [2026, false],
    [2000, true],
    [1900, false],
    [2100, false],
  ])('isLeapYear(%i) === %s', (year, expected) => {
    expect(isLeapYear(year)).toBe(expected);
  });

  it('gives February 29 days only in leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it.each([
    [1, 31],
    [4, 30],
    [6, 30],
    [9, 30],
    [11, 30],
    [12, 31],
  ])('month %i has %i days', (month, expected) => {
    expect(daysInMonth(2026, month)).toBe(expected);
  });

  it('rejects out-of-range months', () => {
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});

describe('epoch day conversion', () => {
  it.each([
    ['1970-01-01', 0],
    ['1970-01-02', 1],
    ['1969-12-31', -1],
    ['2000-01-01', 10957],
    ['2026-07-29', 20663],
  ])('%s <-> %i', (date, epochDay) => {
    expect(toEpochDay(d(date))).toBe(epochDay);
    expect(fromEpochDay(epochDay)).toBe(date);
  });

  // P18 — round-trip
  it('round-trips through epoch day for any date', () => {
    fc.assert(
      fc.property(arbCivilDate(), (date) => {
        expect(fromEpochDay(toEpochDay(date))).toBe(date);
      }),
    );
  });

  it('round-trips from epoch day for any day number', () => {
    fc.assert(
      fc.property(arbEpochDay(), (n) => {
        expect(toEpochDay(fromEpochDay(n))).toBe(n);
      }),
    );
  });

  it('produces only valid dates', () => {
    fc.assert(
      fc.property(arbEpochDay(), (n) => {
        // Throws if the produced string isn't a real calendar date.
        expect(() => civilDate(fromEpochDay(n))).not.toThrow();
      }),
    );
  });

  it('is monotonic', () => {
    fc.assert(
      fc.property(arbEpochDay(), fc.integer({ min: 1, max: 10_000 }), (n, delta) => {
        expect(toEpochDay(fromEpochDay(n))).toBeLessThan(toEpochDay(fromEpochDay(n + delta)));
      }),
    );
  });
});

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays(d('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
    expect(addDays(d('2024-03-01'), -1)).toBe('2024-02-29');
  });

  it('crosses year boundaries', () => {
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2026-01-01'), -1)).toBe('2025-12-31');
  });

  // P18 — inverse
  it('is invertible', () => {
    fc.assert(
      fc.property(arbCivilDate(), fc.integer({ min: -5000, max: 5000 }), (date, n) => {
        expect(addDays(addDays(date, n), -n)).toBe(date);
      }),
    );
  });

  it('agrees with daysBetween', () => {
    fc.assert(
      fc.property(arbCivilDate(), fc.integer({ min: -5000, max: 5000 }), (date, n) => {
        expect(daysBetween(date, addDays(date, n))).toBe(n);
      }),
    );
  });
});

describe('addMonthsClamped', () => {
  // P6/P18 — the bug that killed monthly recurrence in the Swift prototype.
  it('clamps the 31st into short months', () => {
    expect(addMonthsClamped(d('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonthsClamped(d('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonthsClamped(d('2026-01-31'), 3)).toBe('2026-04-30');
    expect(addMonthsClamped(d('2026-03-31'), 1)).toBe('2026-04-30');
  });

  it('does not clamp when the day exists', () => {
    expect(addMonthsClamped(d('2026-01-15'), 1)).toBe('2026-02-15');
    expect(addMonthsClamped(d('2026-01-31'), 2)).toBe('2026-03-31');
  });

  it('handles negative and zero offsets', () => {
    expect(addMonthsClamped(d('2026-03-31'), -1)).toBe('2026-02-28');
    expect(addMonthsClamped(d('2026-03-15'), 0)).toBe('2026-03-15');
    expect(addMonthsClamped(d('2026-01-15'), -1)).toBe('2025-12-15');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonthsClamped(d('2026-11-30'), 3)).toBe('2027-02-28');
    expect(addMonthsClamped(d('2026-02-28'), -14)).toBe('2024-12-28');
  });

  // P18 — never produces an invalid date, for any date and any offset.
  it('always produces a valid calendar date', () => {
    fc.assert(
      fc.property(arbCivilDate(), fc.integer({ min: -600, max: 600 }), (date, months) => {
        expect(() => civilDate(addMonthsClamped(date, months))).not.toThrow();
      }),
    );
  });

  it('lands on the intended month', () => {
    fc.assert(
      fc.property(arbCivilDate(), fc.integer({ min: -600, max: 600 }), (date, months) => {
        expect(monthsBetween(date, addMonthsClamped(date, months))).toBe(months);
      }),
    );
  });

  it('preserves day-of-month whenever the target month is long enough', () => {
    fc.assert(
      fc.property(arbCivilDate(), fc.integer({ min: -600, max: 600 }), (date, months) => {
        const result = addMonthsClamped(date, months);
        const originalDay = Number(date.slice(-2));
        const resultDay = Number(result.slice(-2));
        // Either the day survived, or it was clamped to the month's last day.
        expect(resultDay === originalDay || result === endOfMonth(result)).toBe(true);
        expect(resultDay).toBeLessThanOrEqual(originalDay);
      }),
    );
  });
});

describe('monthsBetween', () => {
  it('counts calendar months, ignoring day of month', () => {
    expect(monthsBetween(d('2026-01-31'), d('2026-02-01'))).toBe(1);
    expect(monthsBetween(d('2026-01-01'), d('2026-01-31'))).toBe(0);
    expect(monthsBetween(d('2026-01-01'), d('2027-01-01'))).toBe(12);
    expect(monthsBetween(d('2026-06-15'), d('2026-01-15'))).toBe(-5);
  });
});

describe('startOfMonth / endOfMonth', () => {
  it('finds month boundaries', () => {
    expect(startOfMonth(d('2026-07-29'))).toBe('2026-07-01');
    expect(endOfMonth(d('2026-07-29'))).toBe('2026-07-31');
    expect(endOfMonth(d('2026-02-10'))).toBe('2026-02-28');
    expect(endOfMonth(d('2024-02-10'))).toBe('2024-02-29');
  });
});

describe('weekdayOf', () => {
  it.each([
    ['2026-07-26', 0], // Sunday
    ['2026-07-27', 1],
    ['2026-07-29', 3], // Wednesday
    ['2026-08-01', 6], // Saturday
    ['1970-01-01', 4], // Thursday
  ])('%s is weekday %i', (date, weekday) => {
    expect(weekdayOf(d(date))).toBe(weekday);
  });

  it('is non-negative before the epoch', () => {
    fc.assert(
      fc.property(fc.integer({ min: -30_000, max: -1 }), (n) => {
        const weekday = weekdayOf(fromEpochDay(n));
        expect(weekday).toBeGreaterThanOrEqual(0);
        expect(weekday).toBeLessThanOrEqual(6);
      }),
    );
  });

  it('advances by one per day, wrapping at 7', () => {
    fc.assert(
      fc.property(arbCivilDate(), (date) => {
        expect(weekdayOf(addDays(date, 1))).toBe((weekdayOf(date) + 1) % 7);
      }),
    );
  });
});

describe('startOfWeek', () => {
  // P15 — week start is configurable, not hardcoded to Sunday.
  it('respects the household week-start setting', () => {
    // 2026-07-29 is a Wednesday.
    expect(startOfWeek(d('2026-07-29'), 0)).toBe('2026-07-26'); // Sunday
    expect(startOfWeek(d('2026-07-29'), 1)).toBe('2026-07-27'); // Monday
    expect(startOfWeek(d('2026-07-29'), 3)).toBe('2026-07-29'); // Wednesday: itself
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(arbCivilDate(), arbWeekday(), (date, ws) => {
        const once = startOfWeek(date, ws);
        expect(startOfWeek(once, ws)).toBe(once);
      }),
    );
  });

  it('always lands on the configured weekday, within the preceding 7 days', () => {
    fc.assert(
      fc.property(arbCivilDate(), arbWeekday(), (date, ws) => {
        const start = startOfWeek(date, ws);
        expect(weekdayOf(start)).toBe(ws);
        const delta = daysBetween(start, date);
        expect(delta).toBeGreaterThanOrEqual(0);
        expect(delta).toBeLessThan(7);
      }),
    );
  });
});

describe('weeksBetween', () => {
  it('counts whole weeks between week starts', () => {
    expect(weeksBetween(d('2026-07-26'), d('2026-08-02'), 0)).toBe(1);
    expect(weeksBetween(d('2026-07-29'), d('2026-07-31'), 0)).toBe(0); // same week
    expect(weeksBetween(d('2026-08-02'), d('2026-07-26'), 0)).toBe(-1);
  });

  it('always returns a whole number', () => {
    fc.assert(
      fc.property(arbCivilDate(), arbCivilDate(), arbWeekday(), (a, b, ws) => {
        expect(Number.isInteger(weeksBetween(a, b, ws))).toBe(true);
      }),
    );
  });
});

describe('nthWeekdayOfMonth', () => {
  it('finds the nth weekday', () => {
    // July 2026: 1st is a Wednesday.
    expect(nthWeekdayOfMonth(2026, 7, 1, 6)).toBe('2026-07-04'); // 1st Saturday
    expect(nthWeekdayOfMonth(2026, 7, 2, 6)).toBe('2026-07-11'); // 2nd Saturday
    expect(nthWeekdayOfMonth(2026, 7, -1, 5)).toBe('2026-07-31'); // last Friday
    expect(nthWeekdayOfMonth(2026, 7, 1, 3)).toBe('2026-07-01'); // 1st Wednesday
  });

  it('handles the shortest month, which has exactly 4 of each weekday', () => {
    // February 2026 starts on a Sunday and has 28 days.
    expect(nthWeekdayOfMonth(2026, 2, 4, 0)).toBe('2026-02-22');
    expect(nthWeekdayOfMonth(2026, 2, 4, 6)).toBe('2026-02-28');
  });

  it('last occurrence is always in the final week of the month', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2060 }),
        fc.integer({ min: 1, max: 12 }),
        arbWeekday(),
        (year, month, weekday) => {
          const found = nthWeekdayOfMonth(year, month, -1, weekday);
          expect(weekdayOf(found)).toBe(weekday);
          // Adding a week must leave the month.
          expect(addDays(found, 7).slice(0, 7)).not.toBe(found.slice(0, 7));
        },
      ),
    );
  });

  // Never returns null: 28 days is 4 of every weekday, and nth is capped at 4.
  it('always returns a valid date in the requested month with the requested weekday', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2060 }),
        fc.integer({ min: 1, max: 12 }),
        arbNthWeek(),
        arbWeekday(),
        (year, month, nth, weekday) => {
          const result = nthWeekdayOfMonth(year, month, nth, weekday);
          expect(() => civilDate(result)).not.toThrow();
          expect(weekdayOf(result)).toBe(weekday);
          const yyyymm = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
          expect(result.slice(0, 7)).toBe(yyyymm);
        },
      ),
    );
  });
});

describe('ordering helpers', () => {
  const early = d('2026-01-01');
  const late = d('2026-06-15');

  it('isBefore / isAfter', () => {
    expect(isBefore(early, late)).toBe(true);
    expect(isBefore(late, early)).toBe(false);
    expect(isBefore(early, early)).toBe(false);
    expect(isAfter(late, early)).toBe(true);
    expect(isAfter(early, late)).toBe(false);
    expect(isAfter(early, early)).toBe(false);
  });

  it('isSameOrBefore / isSameOrAfter include equality', () => {
    expect(isSameOrBefore(early, late)).toBe(true);
    expect(isSameOrBefore(early, early)).toBe(true);
    expect(isSameOrBefore(late, early)).toBe(false);
    expect(isSameOrAfter(late, early)).toBe(true);
    expect(isSameOrAfter(early, early)).toBe(true);
    expect(isSameOrAfter(early, late)).toBe(false);
  });

  it('minCivil / maxCivil', () => {
    expect(minCivil(early, late)).toBe(early);
    expect(minCivil(late, early)).toBe(early);
    expect(maxCivil(early, late)).toBe(late);
    expect(maxCivil(late, early)).toBe(late);
    expect(minCivil(early, early)).toBe(early);
    expect(maxCivil(early, early)).toBe(early);
  });

  it('min and max are consistent with compare for any pair', () => {
    fc.assert(
      fc.property(arbCivilDate(), arbCivilDate(), (a, b) => {
        expect(compareCivil(minCivil(a, b), maxCivil(a, b))).toBeLessThanOrEqual(0);
        expect([a, b]).toContain(minCivil(a, b));
        expect([a, b]).toContain(maxCivil(a, b));
      }),
    );
  });
});

describe('dates far outside the app range', () => {
  // The engine only ever sees modern dates, but the arithmetic is era-based and
  // should stay exact rather than silently degrading at the boundaries.
  it('handles pre-epoch and year-1 dates', () => {
    expect(toEpochDay(d('0001-01-01'))).toBe(-719162);
    expect(fromEpochDay(-719162)).toBe('0001-01-01');
    expect(addDays(d('0001-01-01'), -1)).toBe('0000-12-31');
    expect(weekdayOf(d('0001-01-01'))).toBe(1); // Monday
  });

  it('handles negative (BCE) years', () => {
    const bce = '-0001-12-31' as CivilDate;
    expect(fromEpochDay(toEpochDay(bce))).toBe(bce);
    expect(partsOf(bce)).toEqual({ year: -1, month: 12, day: 31 });
    expect(addDays(bce, 1)).toBe('0000-01-01');
  });

  it('round-trips across the era boundary', () => {
    fc.assert(
      fc.property(fc.integer({ min: -800_000, max: 800_000 }), (n) => {
        expect(toEpochDay(fromEpochDay(n))).toBe(n);
      }),
    );
  });
});

describe('comparison', () => {
  it('orders dates', () => {
    expect(compareCivil(d('2026-01-01'), d('2026-01-02'))).toBeLessThan(0);
    expect(compareCivil(d('2026-01-02'), d('2026-01-01'))).toBeGreaterThan(0);
    expect(compareCivil(d('2026-01-01'), d('2026-01-01'))).toBe(0);
  });

  it('agrees with lexicographic order for 4-digit years', () => {
    fc.assert(
      fc.property(arbCivilDate(), arbCivilDate(), (a, b) => {
        expect(Math.sign(compareCivil(a, b))).toBe(Math.sign(a < b ? -1 : a > b ? 1 : 0));
      }),
    );
  });

  it('isWithin is inclusive at both ends', () => {
    expect(isWithin(d('2026-01-01'), d('2026-01-01'), d('2026-01-31'))).toBe(true);
    expect(isWithin(d('2026-01-31'), d('2026-01-01'), d('2026-01-31'))).toBe(true);
    expect(isWithin(d('2025-12-31'), d('2026-01-01'), d('2026-01-31'))).toBe(false);
    expect(isWithin(d('2026-02-01'), d('2026-01-01'), d('2026-01-31'))).toBe(false);
  });
});

describe('fromParts', () => {
  it('builds and validates', () => {
    expect(fromParts(2026, 7, 29)).toBe('2026-07-29');
    expect(() => fromParts(2026, 2, 30)).toThrow(InvalidCivilDateError);
  });
});
