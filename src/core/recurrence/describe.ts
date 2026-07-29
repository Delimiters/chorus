/**
 * Human-readable schedule summaries.
 *
 * These strings appear under every chore in the list and in the schedule
 * preview, so they are part of the product, not a debugging aid. They are
 * golden-tested: if the phrasing changes, a test changes with it deliberately.
 */

import type { NthWeek, Weekday } from '../civil/types';
import { assertNever } from '../lib/assertNever';
import type { RecurrenceRule, Schedule } from './types';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const NTH_NAMES: Record<Exclude<NthWeek, -1>, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const weekdayName = (day: Weekday): string => WEEKDAY_NAMES[day];
export const weekdayShortName = (day: Weekday): string => WEEKDAY_SHORT[day];

/** `1st`, `2nd`, `3rd`, `21st` … */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** `Monday`, `Monday and Friday`, `Monday, Wednesday and Friday`. */
function joinList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

/** `every 3 weeks` / `every week` — the interval phrase for "every N units". */
function everyN(n: number, unit: 'day' | 'week' | 'month'): string {
  if (n === 1) return `every ${unit}`;
  if (n === 2) return `every other ${unit}`;
  return `every ${n} ${unit}s`;
}

/** `once` / `twice` / `3 times`. */
function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

/**
 * A sentence fragment describing when a rule fires, e.g. "every other Monday".
 *
 * Deliberately lower-case and un-punctuated so callers can embed it.
 */
export function describeRule(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'unscheduled':
      return 'no schedule';

    case 'once': {
      const { year, month, day } = splitDate(rule.dueOn);
      const date = `${MONTH_NAMES[month - 1] as string} ${day}, ${year}`;
      switch (rule.granularity) {
        case 'day':
          return `once on ${date}`;
        case 'week':
          return `once in the week of ${date}`;
        case 'month':
          return `once in ${MONTH_NAMES[month - 1] as string} ${year}`;
        default:
          return assertNever(rule.granularity, 'once granularity');
      }
    }

    case 'daily':
      return rule.everyNDays === 1 ? 'every day' : everyN(rule.everyNDays, 'day');

    case 'weekly': {
      const days = joinList(rule.weekdays.map(weekdayName));
      if (rule.everyNWeeks === 1) return `every ${days}`;
      if (rule.everyNWeeks === 2) return `every other ${days}`;
      return `${days}, every ${rule.everyNWeeks} weeks`;
    }

    case 'weeklyFloating': {
      const count = times(rule.timesPerPeriod);
      if (rule.everyNWeeks === 1) return `${count} a week, any day`;
      return `${count} ${everyN(rule.everyNWeeks, 'week')}, any day`;
    }

    case 'monthlyByDay': {
      const day = `the ${ordinal(rule.dayOfMonth)}`;
      const base =
        rule.everyNMonths === 1
          ? `monthly on ${day}`
          : `${everyN(rule.everyNMonths, 'month')} on ${day}`;
      // Only worth mentioning for days that can actually overflow.
      if (rule.dayOfMonth <= 28) return base;
      return rule.overflow === 'clamp'
        ? `${base} (or the last day, in shorter months)`
        : `${base} (skipping shorter months)`;
    }

    case 'monthlyByWeekday': {
      const which = rule.nth === -1 ? 'last' : (NTH_NAMES[rule.nth] as string);
      const day = weekdayName(rule.weekday);
      return rule.everyNMonths === 1
        ? `monthly on the ${which} ${day}`
        : `${everyN(rule.everyNMonths, 'month')} on the ${which} ${day}`;
    }

    case 'monthlyFloating': {
      const count = times(rule.timesPerPeriod);
      if (rule.everyNMonths === 1) return `${count} a month, any day`;
      return `${count} ${everyN(rule.everyNMonths, 'month')}, any day`;
    }

    default:
      return assertNever(rule, 'recurrence rule');
  }
}

/**
 * A full description including bounds, capitalised for standalone display.
 *
 * e.g. `"Every other Monday, until March 1, 2027"`.
 */
export function describeSchedule(schedule: Schedule): string {
  const base = describeRule(schedule.rule);
  const sentence = base.charAt(0).toUpperCase() + base.slice(1);
  if (schedule.rule.kind === 'unscheduled' || schedule.rule.kind === 'once') return sentence;
  if (schedule.endsOn === null) return sentence;

  const { year, month, day } = splitDate(schedule.endsOn);
  return `${sentence}, until ${MONTH_NAMES[month - 1] as string} ${day}, ${year}`;
}

function splitDate(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}
