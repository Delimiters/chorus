import fc from 'fast-check';

import { arbSchedule } from '../__testing__/rules';
import {
  parseRecurrenceRule,
  parseSchedule,
  recurrenceRuleSchema,
  safeParseSchedule,
  willClamp,
} from './schema';

const validSchedule = (rule: unknown) => ({
  rule,
  startsOn: '2026-01-01',
  endsOn: null,
  timeOfDay: null,
});

describe('rule validation', () => {
  it('accepts every well-formed rule', () => {
    const rules: unknown[] = [
      { kind: 'unscheduled' },
      { kind: 'once', dueOn: '2026-03-14', granularity: 'day' },
      { kind: 'daily', everyNDays: 1 },
      { kind: 'weekly', everyNWeeks: 2, weekdays: [1, 3, 5] },
      { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
      { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
      { kind: 'monthlyByWeekday', everyNMonths: 3, nth: -1, weekday: 5 },
      { kind: 'monthlyFloating', everyNMonths: 2, timesPerPeriod: 2 },
    ];
    for (const rule of rules) {
      expect(() => parseRecurrenceRule(rule)).not.toThrow();
    }
  });

  it.each([
    ['unknown kind', { kind: 'yearly', everyNYears: 1 }],
    ['missing discriminator', { everyNDays: 1 }],
    ['zero interval', { kind: 'daily', everyNDays: 0 }],
    ['negative interval', { kind: 'daily', everyNDays: -1 }],
    ['fractional interval', { kind: 'daily', everyNDays: 1.5 }],
    ['empty weekday list', { kind: 'weekly', everyNWeeks: 1, weekdays: [] }],
    ['duplicate weekdays', { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 1] }],
    ['unsorted weekdays', { kind: 'weekly', everyNWeeks: 1, weekdays: [5, 1] }],
    ['weekday out of range', { kind: 'weekly', everyNWeeks: 1, weekdays: [7] }],
    [
      'day of month too high',
      { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 32, overflow: 'clamp' },
    ],
    [
      'day of month zero',
      { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 0, overflow: 'clamp' },
    ],
    [
      'bad overflow mode',
      { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 1, overflow: 'wrap' },
    ],
    ['nth out of range', { kind: 'monthlyByWeekday', everyNMonths: 1, nth: 5, weekday: 1 }],
    ['zero times per period', { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 0 }],
    ['impossible date', { kind: 'once', dueOn: '2026-02-30', granularity: 'day' }],
    ['malformed date', { kind: 'once', dueOn: '14/03/2026', granularity: 'day' }],
    ['bad granularity', { kind: 'once', dueOn: '2026-03-14', granularity: 'year' }],
  ])('rejects %s', (_label, rule) => {
    expect(recurrenceRuleSchema.safeParse(rule).success).toBe(false);
  });
});

describe('schedule validation', () => {
  it('defaults optional fields', () => {
    const parsed = parseSchedule({
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: '2026-01-01',
    });
    expect(parsed.endsOn).toBeNull();
    expect(parsed.timeOfDay).toBeNull();
  });

  it('accepts a valid reminder time', () => {
    const parsed = parseSchedule({
      ...validSchedule({ kind: 'daily', everyNDays: 1 }),
      timeOfDay: '07:30',
    });
    expect(parsed.timeOfDay).toBe('07:30');
  });

  it.each(['7:30', '25:00', '07:60', '0730', 'morning'])('rejects bad time %s', (timeOfDay) => {
    const result = safeParseSchedule({
      ...validSchedule({ kind: 'daily', everyNDays: 1 }),
      timeOfDay,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const result = safeParseSchedule({
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: '2026-06-01',
      endsOn: '2026-01-01',
      timeOfDay: null,
    });
    expect(result.success).toBe(false);
  });

  it('allows an end date equal to the start date', () => {
    const result = safeParseSchedule({
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: '2026-06-01',
      endsOn: '2026-06-01',
      timeOfDay: null,
    });
    expect(result.success).toBe(true);
  });

  it('reports errors rather than throwing in safe mode', () => {
    const result = safeParseSchedule({ rule: { kind: 'nope' }, startsOn: '2026-01-01' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it('throws in strict mode', () => {
    expect(() => parseSchedule({ rule: { kind: 'nope' }, startsOn: '2026-01-01' })).toThrow();
  });

  // Round-trip: anything the generators produce must survive validation, which
  // keeps the property tests honest about only exercising legal input.
  it('accepts every schedule the test generators produce', () => {
    fc.assert(
      fc.property(arbSchedule(), (schedule) => {
        const result = safeParseSchedule(JSON.parse(JSON.stringify(schedule)));
        expect(result.success).toBe(true);
      }),
    );
  });
});

describe('willClamp', () => {
  it('flags a monthly rule that will clamp in the given month', () => {
    const rule = {
      kind: 'monthlyByDay',
      everyNMonths: 1,
      dayOfMonth: 31,
      overflow: 'clamp',
    } as const;
    expect(willClamp(rule, 2026, 2)).toBe(true); // February
    expect(willClamp(rule, 2026, 1)).toBe(false); // January has 31 days
    expect(willClamp(rule, 2026, 4)).toBe(true); // April has 30
  });

  it('does not flag skip mode or other rule kinds', () => {
    expect(
      willClamp(
        { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'skip' },
        2026,
        2,
      ),
    ).toBe(false);
    expect(willClamp({ kind: 'daily', everyNDays: 1 }, 2026, 2)).toBe(false);
  });
});
