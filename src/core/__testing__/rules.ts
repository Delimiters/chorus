/**
 * Arbitraries for recurrence rules and schedules.
 *
 * Weighted toward the shapes that historically broke: high days-of-month,
 * floating rules, and long `everyN` intervals.
 */

import fc from 'fast-check';

import { fromEpochDay } from '../civil/date';
import type { CivilDate, NthWeek, Weekday } from '../civil/types';
import type { RecurrenceRule, Schedule } from '../recurrence/types';
import { arbCivilDate, arbEpochDay, arbNthWeek, arbWeekday } from './arbitraries';

const arbEveryN = (max = 6): fc.Arbitrary<number> => fc.integer({ min: 1, max });

/** Non-empty, sorted, duplicate-free weekday set. */
export const arbWeekdays = (): fc.Arbitrary<readonly Weekday[]> =>
  fc
    .uniqueArray(arbWeekday(), { minLength: 1, maxLength: 7 })
    .map((days) => [...days].sort((a, b) => a - b));

export const arbUnscheduled = (): fc.Arbitrary<RecurrenceRule> =>
  fc.constant({ kind: 'unscheduled' as const });

export const arbOnce = (): fc.Arbitrary<RecurrenceRule> =>
  fc.record({
    kind: fc.constant('once' as const),
    dueOn: arbCivilDate(),
    granularity: fc.constantFrom('day' as const, 'week' as const, 'month' as const),
  });

export const arbDaily = (): fc.Arbitrary<RecurrenceRule> =>
  fc.record({ kind: fc.constant('daily' as const), everyNDays: arbEveryN(10) });

export const arbWeekly = (): fc.Arbitrary<RecurrenceRule> =>
  fc.record({
    kind: fc.constant('weekly' as const),
    everyNWeeks: arbEveryN(4),
    weekdays: arbWeekdays(),
  });

export const arbWeeklyFloating = (): fc.Arbitrary<RecurrenceRule> =>
  fc.record({
    kind: fc.constant('weeklyFloating' as const),
    everyNWeeks: arbEveryN(4),
    timesPerPeriod: fc.integer({ min: 1, max: 7 }),
  });

export const arbMonthlyByDay = (): fc.Arbitrary<RecurrenceRule> =>
  fc.record({
    kind: fc.constant('monthlyByDay' as const),
    everyNMonths: arbEveryN(6),
    // Biased toward the boundary days that break naive implementations.
    dayOfMonth: fc.oneof(
      { weight: 3, arbitrary: fc.integer({ min: 28, max: 31 }) },
      { weight: 1, arbitrary: fc.integer({ min: 1, max: 27 }) },
    ),
    overflow: fc.constantFrom('clamp' as const, 'skip' as const),
  });

export const arbMonthlyByWeekday = (): fc.Arbitrary<RecurrenceRule> =>
  fc.record({
    kind: fc.constant('monthlyByWeekday' as const),
    everyNMonths: arbEveryN(6),
    nth: arbNthWeek() as fc.Arbitrary<NthWeek>,
    weekday: arbWeekday(),
  });

export const arbMonthlyFloating = (): fc.Arbitrary<RecurrenceRule> =>
  fc.record({
    kind: fc.constant('monthlyFloating' as const),
    everyNMonths: arbEveryN(6),
    timesPerPeriod: fc.integer({ min: 1, max: 10 }),
  });

/** Any rule, including `unscheduled`. */
export const arbRecurrenceRule = (): fc.Arbitrary<RecurrenceRule> =>
  fc.oneof(
    arbUnscheduled(),
    arbOnce(),
    arbDaily(),
    arbWeekly(),
    arbWeeklyFloating(),
    arbMonthlyByDay(),
    arbMonthlyByWeekday(),
    arbMonthlyFloating(),
  );

/** Any rule that actually produces occurrences. */
export const arbSchedulableRule = (): fc.Arbitrary<RecurrenceRule> =>
  fc.oneof(
    arbOnce(),
    arbDaily(),
    arbWeekly(),
    arbWeeklyFloating(),
    arbMonthlyByDay(),
    arbMonthlyByWeekday(),
    arbMonthlyFloating(),
  );

export interface ScheduleOptions {
  readonly rule?: fc.Arbitrary<RecurrenceRule>;
  /** Probability of generating a bounded schedule. */
  readonly withEnd?: boolean;
}

export const arbSchedule = (options: ScheduleOptions = {}): fc.Arbitrary<Schedule> =>
  fc
    .tuple(
      options.rule ?? arbRecurrenceRule(),
      arbEpochDay(),
      fc.option(fc.integer({ min: 0, max: 800 }), { nil: null }),
    )
    .map(([rule, startEpochDay, endOffset]) => ({
      rule,
      startsOn: fromEpochDay(startEpochDay),
      endsOn: endOffset === null ? null : (fromEpochDay(startEpochDay + endOffset) as CivilDate),
      timeOfDay: null,
    }));

/** A schedule guaranteed to be unbounded, for tests about infinite sequences. */
export const arbUnboundedSchedule = (rule?: fc.Arbitrary<RecurrenceRule>): fc.Arbitrary<Schedule> =>
  fc.tuple(rule ?? arbSchedulableRule(), arbEpochDay()).map(([r, start]) => ({
    rule: r,
    startsOn: fromEpochDay(start),
    endsOn: null,
    timeOfDay: null,
  }));
