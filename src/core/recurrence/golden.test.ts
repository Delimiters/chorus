/**
 * Golden fixtures — executable documentation for the recurrence engine.
 *
 * Every case is written by hand with its expected dates spelled out, so this
 * file answers "what does the engine actually do?" without reading any code.
 * Every recurrence shape in docs/ROADMAP.md appears here as a named case.
 *
 * Reference dates used throughout:
 *   2026-01-01  Thursday
 *   2026-01-04  Sunday
 *   2026-01-05  Monday
 *   2026-02-28  Saturday (2026 is not a leap year)
 */

import { civilDate } from '../civil/date';
import type { CalendarConfig } from '../civil/types';
import { expandOccurrences } from './expand';
import type { RecurrenceRule, Schedule } from './types';

const SUNDAY_WEEKS: CalendarConfig = { weekStartsOn: 0 };
const MONDAY_WEEKS: CalendarConfig = { weekStartsOn: 1 };

interface GoldenCase {
  readonly description: string;
  readonly rule: RecurrenceRule;
  readonly startsOn: string;
  readonly endsOn?: string;
  readonly window: readonly [string, string];
  readonly cal?: CalendarConfig;
  /** Expected due dates, in order. Floating rules repeat their anchor date. */
  readonly expected: readonly string[];
}

const CASES: readonly GoldenCase[] = [
  // ── Daily ────────────────────────────────────────────────────────────────
  {
    description: 'daily',
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-01-05'],
    expected: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'],
  },
  {
    description: 'every 3 days',
    rule: { kind: 'daily', everyNDays: 3 },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-01-14'],
    expected: ['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10', '2026-01-13'],
  },
  {
    description: 'every 3 days, window starting mid-cycle, stays on the anchor phase',
    rule: { kind: 'daily', everyNDays: 3 },
    startsOn: '2026-01-01',
    window: ['2026-01-05', '2026-01-11'],
    expected: ['2026-01-07', '2026-01-10'],
  },
  {
    description: 'every 10 days across a month boundary',
    rule: { kind: 'daily', everyNDays: 10 },
    startsOn: '2026-01-25',
    window: ['2026-01-25', '2026-02-25'],
    expected: ['2026-01-25', '2026-02-04', '2026-02-14', '2026-02-24'],
  },

  // ── Weekly, anchored ─────────────────────────────────────────────────────
  {
    description: 'once a week on a specific day (Mondays)',
    rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1] },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-01-31'],
    expected: ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'],
  },
  {
    description: 'twice a week (Tuesdays and Fridays)',
    rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [2, 5] },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-01-17'],
    expected: [
      '2026-01-02', // Fri
      '2026-01-06', // Tue
      '2026-01-09', // Fri
      '2026-01-13', // Tue
      '2026-01-16', // Fri
    ],
  },
  {
    description: 'trash: Mon/Wed/Fri',
    rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 3, 5] },
    startsOn: '2026-01-04',
    window: ['2026-01-04', '2026-01-17'],
    expected: ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16'],
  },
  {
    description: 'every other Monday',
    rule: { kind: 'weekly', everyNWeeks: 2, weekdays: [1] },
    startsOn: '2026-01-04', // a Sunday — start of the anchor week
    window: ['2026-01-04', '2026-02-28'],
    expected: ['2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16'],
  },
  {
    description: 'every other Mon+Wed, set up on the Wednesday, keeps the pair in one week',
    // The bug this fixture exists for: blocks used to start on the day the
    // chore was created, so "Monday" meant the Monday five days *after* the
    // Wednesday rather than the one two days before it, and the pair straddled
    // two calendar weeks with a nine-day gap between them.
    rule: { kind: 'weekly', everyNWeeks: 2, weekdays: [1, 3] },
    startsOn: '2026-07-29', // a Wednesday
    window: ['2026-07-29', '2026-08-31'],
    expected: ['2026-07-29', '2026-08-10', '2026-08-12', '2026-08-24', '2026-08-26'],
  },
  {
    description: 'the same rule set up on the Monday agrees with it',
    // Two people adding the same chore on different days must end up with the
    // same schedule, or "every other week" means whenever you happened to tap.
    rule: { kind: 'weekly', everyNWeeks: 2, weekdays: [1, 3] },
    startsOn: '2026-07-27', // the Monday of the same week
    window: ['2026-08-01', '2026-08-31'],
    expected: ['2026-08-10', '2026-08-12', '2026-08-24', '2026-08-26'],
  },
  {
    description: 'every 3 weeks on Saturday',
    rule: { kind: 'weekly', everyNWeeks: 3, weekdays: [6] },
    startsOn: '2026-01-04',
    window: ['2026-01-04', '2026-03-31'],
    expected: ['2026-01-10', '2026-01-31', '2026-02-21', '2026-03-14'],
  },
  {
    description: 'weekly on Sunday, with Monday-start weeks, still lands on Sundays',
    rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [0] },
    startsOn: '2026-01-01',
    cal: MONDAY_WEEKS,
    window: ['2026-01-01', '2026-01-31'],
    expected: ['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25'],
  },

  // ── Weekly, floating ─────────────────────────────────────────────────────
  {
    description: '3 times a week, any days — three distinct slots per week',
    rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
    startsOn: '2026-01-04', // Sunday, aligned to the week start
    window: ['2026-01-04', '2026-01-17'],
    expected: [
      '2026-01-04',
      '2026-01-04',
      '2026-01-04', // week of Jan 4: slots 0,1,2
      '2026-01-11',
      '2026-01-11',
      '2026-01-11', // week of Jan 11
    ],
  },
  {
    description: 'once a week, any day',
    rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 1 },
    startsOn: '2026-01-04',
    window: ['2026-01-04', '2026-01-24'],
    expected: ['2026-01-04', '2026-01-11', '2026-01-18'],
  },
  {
    description: 'twice every other week',
    rule: { kind: 'weeklyFloating', everyNWeeks: 2, timesPerPeriod: 2 },
    startsOn: '2026-01-04',
    window: ['2026-01-04', '2026-02-14'],
    expected: ['2026-01-04', '2026-01-04', '2026-01-18', '2026-01-18', '2026-02-01', '2026-02-01'],
  },

  // ── Monthly by day-of-month ──────────────────────────────────────────────
  {
    description: 'once a month on the 15th',
    rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 15, overflow: 'clamp' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-04-30'],
    expected: ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'],
  },
  {
    description: 'THE FEBRUARY CASE — the 31st, clamped, never skips a month',
    rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-06-30'],
    expected: [
      '2026-01-31',
      '2026-02-28', // clamped — the prototype stopped recurring entirely here
      '2026-03-31',
      '2026-04-30', // clamped
      '2026-05-31',
      '2026-06-30', // clamped
    ],
  },
  {
    description: 'the 31st, clamped, in a leap year gives Feb 29',
    rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
    startsOn: '2028-01-01',
    window: ['2028-01-01', '2028-03-31'],
    expected: ['2028-01-31', '2028-02-29', '2028-03-31'],
  },
  {
    description: 'the 31st, skip mode, omits short months without shifting the rest',
    rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'skip' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-06-30'],
    expected: ['2026-01-31', '2026-03-31', '2026-05-31'],
  },
  {
    description: 'every other month on the 31st, clamped',
    rule: { kind: 'monthlyByDay', everyNMonths: 2, dayOfMonth: 31, overflow: 'clamp' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-08-31'],
    expected: ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'],
  },
  {
    description: 'every 3 months on the 1st (quarterly)',
    rule: { kind: 'monthlyByDay', everyNMonths: 3, dayOfMonth: 1, overflow: 'clamp' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-12-31'],
    expected: ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'],
  },

  // ── Monthly by Nth weekday ───────────────────────────────────────────────
  {
    description: 'the 2nd Saturday of every month',
    rule: { kind: 'monthlyByWeekday', everyNMonths: 1, nth: 2, weekday: 6 },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-04-30'],
    expected: ['2026-01-10', '2026-02-14', '2026-03-14', '2026-04-11'],
  },
  {
    description: 'the last Friday of every month',
    rule: { kind: 'monthlyByWeekday', everyNMonths: 1, nth: -1, weekday: 5 },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-04-30'],
    expected: ['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24'],
  },
  {
    description: 'the 1st Monday of every 3rd month',
    rule: { kind: 'monthlyByWeekday', everyNMonths: 3, nth: 1, weekday: 1 },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-12-31'],
    expected: ['2026-01-05', '2026-04-06', '2026-07-06', '2026-10-05'],
  },

  // ── Monthly, floating ────────────────────────────────────────────────────
  {
    description: 'twice a month, any days',
    rule: { kind: 'monthlyFloating', everyNMonths: 1, timesPerPeriod: 2 },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-03-31'],
    expected: ['2026-01-01', '2026-01-01', '2026-02-01', '2026-02-01', '2026-03-01', '2026-03-01'],
  },
  {
    description: 'once every other month, any day',
    rule: { kind: 'monthlyFloating', everyNMonths: 2, timesPerPeriod: 1 },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-06-30'],
    expected: ['2026-01-01', '2026-03-01', '2026-05-01'],
  },

  // ── One-time ─────────────────────────────────────────────────────────────
  {
    description: 'one-time chore on a specific day',
    rule: { kind: 'once', dueOn: civilDate('2026-03-14'), granularity: 'day' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-06-30'],
    expected: ['2026-03-14'],
  },
  {
    description: 'one-time chore outside the window produces nothing',
    rule: { kind: 'once', dueOn: civilDate('2026-09-01'), granularity: 'day' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-06-30'],
    expected: [],
  },
  {
    description: 'one-time chore does NOT repeat — the prototype showed it forever',
    rule: { kind: 'once', dueOn: civilDate('2026-01-05'), granularity: 'day' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-03-31'],
    expected: ['2026-01-05'],
  },
  {
    description: 'unscheduled ("someday") never appears on an agenda',
    rule: { kind: 'unscheduled' },
    startsOn: '2026-01-01',
    window: ['2026-01-01', '2026-12-31'],
    expected: [],
  },

  // ── Bounds ───────────────────────────────────────────────────────────────
  {
    description: 'endsOn stops the sequence',
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: '2026-01-01',
    endsOn: '2026-01-03',
    window: ['2026-01-01', '2026-01-10'],
    expected: ['2026-01-01', '2026-01-02', '2026-01-03'],
  },
  {
    description: 'startsOn clips occurrences before the chore existed',
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: '2026-01-05',
    window: ['2026-01-01', '2026-01-07'],
    expected: ['2026-01-05', '2026-01-06', '2026-01-07'],
  },
];

describe('golden fixtures', () => {
  it.each(CASES.map((c) => [c.description, c] as const))('%s', (_description, testCase) => {
    const schedule: Schedule = {
      rule: testCase.rule,
      startsOn: civilDate(testCase.startsOn),
      endsOn: testCase.endsOn ? civilDate(testCase.endsOn) : null,
      timeOfDay: null,
    };
    const occurrences = expandOccurrences('chore', schedule, testCase.cal ?? SUNDAY_WEEKS, {
      start: civilDate(testCase.window[0]),
      end: civilDate(testCase.window[1]),
    });
    expect(occurrences.map((o) => o.dueOn as string)).toEqual([...testCase.expected]);
  });

  it('covers every recurrence kind', () => {
    const covered = new Set(CASES.map((c) => c.rule.kind));
    expect([...covered].sort()).toEqual([
      'daily',
      'monthlyByDay',
      'monthlyByWeekday',
      'monthlyFloating',
      'once',
      'unscheduled',
      'weekly',
      'weeklyFloating',
    ]);
  });
});

describe('the February regression, stated plainly', () => {
  // Called out separately because it is the single bug that killed the
  // previous implementation. See docs/POSTMORTEM-SWIFT.md #3.
  it('a monthly chore on the 31st still recurs after February', () => {
    const schedule: Schedule = {
      rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
      startsOn: civilDate('2026-01-01'),
      endsOn: null,
      timeOfDay: null,
    };
    // Twenty years. The prototype produced exactly one occurrence and stopped.
    let total = 0;
    for (let year = 2026; year < 2046; year += 1) {
      const occurrences = expandOccurrences('chore', schedule, SUNDAY_WEEKS, {
        start: civilDate(`${year}-01-01`),
        end: civilDate(`${year}-12-31`),
      });
      expect(occurrences).toHaveLength(12);
      total += occurrences.length;
    }
    expect(total).toBe(240);
  });

  it('lands on the last day of every short month', () => {
    const schedule: Schedule = {
      rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
      startsOn: civilDate('2026-01-01'),
      endsOn: null,
      timeOfDay: null,
    };
    const dates = expandOccurrences('chore', schedule, SUNDAY_WEEKS, {
      start: civilDate('2028-01-01'),
      end: civilDate('2028-12-31'),
    }).map((o) => o.dueOn as string);

    expect(dates).toEqual([
      '2028-01-31',
      '2028-02-29', // leap
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
      '2028-07-31',
      '2028-08-31',
      '2028-09-30',
      '2028-10-31',
      '2028-11-30',
      '2028-12-31',
    ]);
  });
});
