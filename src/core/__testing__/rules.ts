/**
 * Arbitraries for recurrence rules and schedules.
 *
 * Weighted toward the shapes that historically broke: high days-of-month,
 * floating rules, and long `everyN` intervals.
 */

import fc from 'fast-check';

import { addDays, fromEpochDay, toEpochDay } from '../civil/date';
import type { CivilDate, DateWindow, NthWeek, Weekday } from '../civil/types';
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
      // Mostly unbounded, stated explicitly rather than via fc.option's `freq`
      // (which is the probability of *nil*, and is easy to get backwards). A
      // short `endsOn` combined with an independently drawn window is how the
      // original generator made ~94% of property runs compare two empty arrays.
      fc.oneof(
        { weight: 8, arbitrary: fc.constant(null) },
        { weight: 2, arbitrary: fc.integer({ min: 30, max: 800 }) },
      ),
    )
    .map(([rule, startEpochDay, endOffset]) => {
      // `once` carries its own date, and the schema normalises `startsOn` to
      // match it — see the transform in schema.ts. Generating the two
      // independently would produce a state the app cannot hold, and did: the
      // bounds property failed on a one-time chore due the day before its own
      // start date. A generator that draws unreachable states tests a program
      // that does not exist.
      const start = rule.kind === 'once' ? toEpochDay(rule.dueOn) : startEpochDay;
      return {
        rule,
        startsOn: fromEpochDay(start),
        // Measured from the same anchor, or `endsOn` lands before `startsOn`
        // whenever the two are drawn from different places — which the schema
        // rejects, so the generator would again be producing an unreachable
        // state.
        endsOn: endOffset === null ? null : (fromEpochDay(start + endOffset) as CivilDate),
        timeOfDay: null,
      };
    });

/**
 * A schedule paired with a window that actually overlaps it.
 *
 * THIS MATTERS MORE THAN IT LOOKS. The original generators drew `startsOn`
 * uniformly across 1990-2060 and the window as an independent 180-day slice of
 * the same 70-year range, so the two almost never intersected: measured, 93.8%
 * of runs produced zero occurrences and the mean was 0.82. Every property that
 * quantifies over occurrences — composability, ordering, key uniqueness, bounds
 * — was therefore asserting almost nothing, which is why two real expansion bugs
 * survived a property-based suite.
 *
 * Here the window is positioned relative to the schedule's own anchor, so the
 * interesting region is where the tests actually look.
 */
export const arbScheduleAndWindow = (
  options: ScheduleOptions & { maxSpanDays?: number } = {},
): fc.Arbitrary<{ schedule: Schedule; window: DateWindow }> => {
  const span = options.maxSpanDays ?? 180;
  return arbSchedule(options).chain((schedule) =>
    fc
      .tuple(fc.integer({ min: -30, max: 200 }), fc.integer({ min: 0, max: span }))
      .map(([offset, width]) => ({
        schedule,
        window: {
          start: addDays(schedule.startsOn, offset),
          end: addDays(schedule.startsOn, offset + width),
        },
      })),
  );
};

/** As {@link arbScheduleAndWindow}, plus a split point strictly inside the window. */
export const arbScheduleWindowAndSplit = (
  options: ScheduleOptions & { maxSpanDays?: number } = {},
): fc.Arbitrary<{ schedule: Schedule; window: DateWindow; splitAfter: CivilDate }> => {
  const span = options.maxSpanDays ?? 180;
  return arbSchedule(options).chain((schedule) =>
    fc
      .tuple(fc.integer({ min: -30, max: 200 }), fc.integer({ min: 1, max: span }))
      .chain(([offset, width]) =>
        fc.integer({ min: 0, max: width - 1 }).map((cut) => ({
          schedule,
          window: {
            start: addDays(schedule.startsOn, offset),
            end: addDays(schedule.startsOn, offset + width),
          },
          splitAfter: addDays(schedule.startsOn, offset + cut),
        })),
      ),
  );
};

/** A schedule guaranteed to be unbounded, for tests about infinite sequences. */
export const arbUnboundedSchedule = (rule?: fc.Arbitrary<RecurrenceRule>): fc.Arbitrary<Schedule> =>
  fc.tuple(rule ?? arbSchedulableRule(), arbEpochDay()).map(([r, start]) => ({
    rule: r,
    // Same normalisation as `arbSchedule` — see the note there.
    startsOn: r.kind === 'once' ? r.dueOn : fromEpochDay(start),
    endsOn: null,
    timeOfDay: null,
  }));
