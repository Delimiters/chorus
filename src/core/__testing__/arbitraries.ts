/**
 * fast-check arbitraries shared across the engine's property tests.
 *
 * Ranges are chosen to stress the cases that historically broke: leap years,
 * month lengths of 28/29/30/31, and both week-start conventions.
 */

import fc from 'fast-check';

import { fromEpochDay, toEpochDay } from '../civil/date';
import type { CalendarConfig, CivilDate, DateWindow, NthWeek, Weekday } from '../civil/types';

/** 1990-01-01 through 2060-12-31 — wide enough to cover 17 leap years. */
const MIN_EPOCH_DAY = toEpochDay('1990-01-01' as CivilDate);
const MAX_EPOCH_DAY = toEpochDay('2060-12-31' as CivilDate);

export const arbEpochDay = (): fc.Arbitrary<number> =>
  fc.integer({ min: MIN_EPOCH_DAY, max: MAX_EPOCH_DAY });

export const arbCivilDate = (): fc.Arbitrary<CivilDate> => arbEpochDay().map(fromEpochDay);

export const arbWeekday = (): fc.Arbitrary<Weekday> =>
  fc.constantFrom<Weekday>(0, 1, 2, 3, 4, 5, 6);

export const arbNthWeek = (): fc.Arbitrary<NthWeek> => fc.constantFrom<NthWeek>(1, 2, 3, 4, -1);

/** Only Sunday and Monday: the two conventions any real household uses. */
export const arbCalendarConfig = (): fc.Arbitrary<CalendarConfig> =>
  fc.record({
    weekStartsOn: fc.constantFrom<Weekday>(0, 1),
    timeZone: fc.constantFrom(
      'UTC',
      'America/Denver',
      'America/New_York',
      'Pacific/Kiritimati',
      'Pacific/Niue',
    ),
  });

/**
 * A window of at most `maxSpanDays`, so property tests stay fast while still
 * crossing month and year boundaries.
 */
export const arbWindow = (maxSpanDays = 400): fc.Arbitrary<DateWindow> =>
  fc.tuple(arbEpochDay(), fc.integer({ min: 0, max: maxSpanDays })).map(([start, span]) => ({
    start: fromEpochDay(start),
    end: fromEpochDay(start + span),
  }));

/** A date and a split point strictly inside a window — for composability tests. */
export const arbWindowWithSplit = (
  maxSpanDays = 400,
): fc.Arbitrary<{ window: DateWindow; splitAfter: CivilDate }> =>
  fc.tuple(arbEpochDay(), fc.integer({ min: 1, max: maxSpanDays })).chain(([start, span]) =>
    fc.integer({ min: 0, max: span - 1 }).map((offset) => ({
      window: { start: fromEpochDay(start), end: fromEpochDay(start + span) },
      splitAfter: fromEpochDay(start + offset),
    })),
  );
