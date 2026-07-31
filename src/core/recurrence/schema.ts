/**
 * The single validation point for schedules.
 *
 * Applied on write *and* on read from the database, so malformed jsonb — from a
 * bad migration, a hand-edited row, or an older app version — can never reach
 * the engine. The engine itself performs no defensive checks; it trusts that
 * anything it receives passed through here.
 */

import { z } from 'zod';

import { daysInMonth, tryCivilDate } from '../civil/date';
import type { CivilDate, CivilTime } from '../civil/types';
import type { RecurrenceRule, Schedule } from './types';

/** Largest sensible "every N" interval. Guards against absurd input, not typos. */
const MAX_INTERVAL = 52;
/** Largest sensible "N times per period". Twice a day, every day, is 14/week. */
const MAX_TIMES_PER_PERIOD = 31;

const civilDateSchema = z
  .string()
  .refine((value) => tryCivilDate(value) !== null, {
    message: 'Expected a real calendar date in YYYY-MM-DD form',
  })
  .transform((value) => value as CivilDate);

const civilTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM in 24-hour form')
  .transform((value) => value as CivilTime);

const weekdaySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

const nthWeekSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(-1),
]);

const interval = (max = MAX_INTERVAL) => z.number().int().min(1).max(max);

export const recurrenceRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unscheduled') }),

  z.object({
    kind: z.literal('once'),
    dueOn: civilDateSchema,
    granularity: z.enum(['day', 'week', 'month']),
  }),

  z.object({
    kind: z.literal('daily'),
    everyNDays: interval(365),
  }),

  z.object({
    kind: z.literal('weekly'),
    everyNWeeks: interval(),
    weekdays: z
      .array(weekdaySchema)
      .min(1, 'Pick at least one day of the week')
      .refine((days) => new Set(days).size === days.length, 'Days must be unique')
      .refine(
        (days) => days.every((day, i) => i === 0 || day > (days[i - 1] as number)),
        'Days must be sorted ascending',
      ),
  }),

  z.object({
    kind: z.literal('weeklyFloating'),
    everyNWeeks: interval(),
    timesPerPeriod: z.number().int().min(1).max(MAX_TIMES_PER_PERIOD),
  }),

  z.object({
    kind: z.literal('monthlyByDay'),
    everyNMonths: interval(),
    dayOfMonth: z.number().int().min(1).max(31),
    overflow: z.enum(['clamp', 'skip']),
  }),

  z.object({
    kind: z.literal('monthlyByWeekday'),
    everyNMonths: interval(),
    nth: nthWeekSchema,
    weekday: weekdaySchema,
  }),

  z.object({
    kind: z.literal('monthlyFloating'),
    everyNMonths: interval(),
    timesPerPeriod: z.number().int().min(1).max(MAX_TIMES_PER_PERIOD),
  }),
]);

export const scheduleSchema = z
  .object({
    rule: recurrenceRuleSchema,
    startsOn: civilDateSchema,
    endsOn: civilDateSchema.nullable().default(null),
    timeOfDay: civilTimeSchema.nullable().default(null),
  })
  .refine((schedule) => schedule.endsOn === null || schedule.endsOn >= schedule.startsOn, {
    message: 'The end date must not precede the start date',
    path: ['endsOn'],
  })
  /**
   * A `once` rule carries its own date, so `startsOn` is vestigial for it — and
   * two fields that must agree but are stored separately will eventually
   * disagree. This one already had: the seed writes `startsOn: 2026-01-04` on a
   * chore due 2026-02-14.
   *
   * Normalised rather than rejected. Rejecting would fail existing rows for a
   * field that means nothing on this rule, and "the occurrence is on the date
   * you named" is what the author meant either way. This is what makes the
   * bounds property (P9 — nothing before `startsOn`) true universally instead of
   * true-except-for-one-kind; an expander that honoured `startsOn` here would
   * instead make a one-time chore dated before it permanently invisible, which
   * is the bug this replaced.
   */
  .transform((schedule) =>
    schedule.rule.kind === 'once' && schedule.startsOn !== schedule.rule.dueOn
      ? { ...schedule, startsOn: schedule.rule.dueOn }
      : schedule,
  );

/** Parses and validates a schedule, throwing on invalid input. */
export function parseSchedule(value: unknown): Schedule {
  return scheduleSchema.parse(value) as Schedule;
}

/** Parses a schedule, returning a discriminated result rather than throwing. */
export function safeParseSchedule(
  value: unknown,
): { success: true; data: Schedule } | { success: false; error: z.ZodError } {
  const result = scheduleSchema.safeParse(value);
  return result.success
    ? { success: true, data: result.data as Schedule }
    : { success: false, error: result.error };
}

export function parseRecurrenceRule(value: unknown): RecurrenceRule {
  return recurrenceRuleSchema.parse(value) as RecurrenceRule;
}

/**
 * Warns when a monthly-by-day rule will silently clamp.
 *
 * Not an error — clamping is the intended default — but the chore form should
 * say so out loud, because "the 31st" quietly becoming "the 28th" is exactly
 * the kind of surprise that erodes trust in a scheduler.
 */
export function willClamp(rule: RecurrenceRule, year: number, month: number): boolean {
  return (
    rule.kind === 'monthlyByDay' &&
    rule.overflow === 'clamp' &&
    rule.dayOfMonth > daysInMonth(year, month)
  );
}
