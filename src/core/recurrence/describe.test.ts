import { civilDate } from '../civil/date';
import { describeRule, describeSchedule, ordinal, weekdayName, weekdayShortName } from './describe';
import type { RecurrenceRule, Schedule } from './types';

const schedule = (rule: RecurrenceRule, endsOn: string | null = null): Schedule => ({
  rule,
  startsOn: civilDate('2026-01-01'),
  endsOn: endsOn ? civilDate(endsOn) : null,
  timeOfDay: null,
});

describe('ordinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [31, '31st'],
  ])('%i -> %s', (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });
});

describe('weekday names', () => {
  it('names every day', () => {
    expect(weekdayName(0)).toBe('Sunday');
    expect(weekdayName(6)).toBe('Saturday');
    expect(weekdayShortName(0)).toBe('Sun');
    expect(weekdayShortName(3)).toBe('Wed');
  });
});

describe('describeRule', () => {
  it.each<[string, RecurrenceRule]>([
    ['no schedule', { kind: 'unscheduled' }],
    ['every day', { kind: 'daily', everyNDays: 1 }],
    ['every other day', { kind: 'daily', everyNDays: 2 }],
    ['every 5 days', { kind: 'daily', everyNDays: 5 }],
    ['every Monday', { kind: 'weekly', everyNWeeks: 1, weekdays: [1] }],
    ['every Monday and Friday', { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 5] }],
    ['every Monday, Wednesday and Friday', { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 3, 5] }],
    ['every other Monday', { kind: 'weekly', everyNWeeks: 2, weekdays: [1] }],
    ['Saturday, every 3 weeks', { kind: 'weekly', everyNWeeks: 3, weekdays: [6] }],
    ['once a week, any day', { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 1 }],
    ['twice a week, any day', { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 2 }],
    ['3 times a week, any day', { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 }],
    [
      'twice every other week, any day',
      { kind: 'weeklyFloating', everyNWeeks: 2, timesPerPeriod: 2 },
    ],
    [
      'monthly on the 15th',
      { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 15, overflow: 'clamp' },
    ],
    [
      'monthly on the 31st (or the last day, in shorter months)',
      { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
    ],
    [
      'monthly on the 31st (skipping shorter months)',
      { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'skip' },
    ],
    [
      'every other month on the 1st',
      { kind: 'monthlyByDay', everyNMonths: 2, dayOfMonth: 1, overflow: 'clamp' },
    ],
    [
      'every 3 months on the 1st',
      { kind: 'monthlyByDay', everyNMonths: 3, dayOfMonth: 1, overflow: 'clamp' },
    ],
    [
      'monthly on the second Saturday',
      { kind: 'monthlyByWeekday', everyNMonths: 1, nth: 2, weekday: 6 },
    ],
    [
      'monthly on the last Friday',
      { kind: 'monthlyByWeekday', everyNMonths: 1, nth: -1, weekday: 5 },
    ],
    [
      'every 3 months on the first Monday',
      { kind: 'monthlyByWeekday', everyNMonths: 3, nth: 1, weekday: 1 },
    ],
    ['twice a month, any day', { kind: 'monthlyFloating', everyNMonths: 1, timesPerPeriod: 2 }],
    [
      'once every other month, any day',
      { kind: 'monthlyFloating', everyNMonths: 2, timesPerPeriod: 1 },
    ],
  ])('describes %s', (expected, rule) => {
    expect(describeRule(rule)).toBe(expected);
  });

  it('describes one-time chores by granularity', () => {
    const dueOn = civilDate('2026-03-14');
    expect(describeRule({ kind: 'once', dueOn, granularity: 'day' })).toBe(
      'once on March 14, 2026',
    );
    expect(describeRule({ kind: 'once', dueOn, granularity: 'week' })).toBe(
      'once in the week of March 14, 2026',
    );
    expect(describeRule({ kind: 'once', dueOn, granularity: 'month' })).toBe('once in March 2026');
  });

  it('only mentions overflow for days that can actually overflow', () => {
    const under = describeRule({
      kind: 'monthlyByDay',
      everyNMonths: 1,
      dayOfMonth: 28,
      overflow: 'clamp',
    });
    expect(under).toBe('monthly on the 28th');
    expect(under).not.toContain('shorter months');
  });
});

describe('describeSchedule', () => {
  it('capitalises the sentence', () => {
    expect(describeSchedule(schedule({ kind: 'daily', everyNDays: 1 }))).toBe('Every day');
  });

  it('appends the end date when bounded', () => {
    expect(
      describeSchedule(schedule({ kind: 'weekly', everyNWeeks: 2, weekdays: [1] }, '2027-03-01')),
    ).toBe('Every other Monday, until March 1, 2027');
  });

  it('omits the end date for one-time and unscheduled chores', () => {
    expect(describeSchedule(schedule({ kind: 'unscheduled' }, '2027-03-01'))).toBe('No schedule');
    expect(
      describeSchedule(
        schedule(
          { kind: 'once', dueOn: civilDate('2026-03-14'), granularity: 'day' },
          '2027-03-01',
        ),
      ),
    ).toBe('Once on March 14, 2026');
  });
});
