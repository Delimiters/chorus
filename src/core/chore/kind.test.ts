import { civilDate } from '../civil/date';
import type { RecurrenceRule, Schedule } from '../recurrence/types';
import { isRecurring, kindOf } from './kind';

const schedule = (rule: RecurrenceRule): Schedule => ({
  rule,
  startsOn: civilDate('2026-09-01'),
  endsOn: null,
  timesOfDay: [],
});

describe('what kind of thing this is', () => {
  it('calls a repeating schedule a chore', () => {
    expect(kindOf(schedule({ kind: 'daily', everyNDays: 3 }))).toBe('chore');
    expect(kindOf(schedule({ kind: 'weekly', everyNWeeks: 1, weekdays: [2] }))).toBe('chore');
    expect(kindOf(schedule({ kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 }))).toBe(
      'chore',
    );
  });

  it('calls a one-time schedule a task', () => {
    expect(
      kindOf(schedule({ kind: 'once', dueOn: civilDate('2026-09-05'), granularity: 'day' })),
    ).toBe('task');
  });

  it('calls an undated one a task too', () => {
    /*
     * The bug in the first version, which compared against `'once'` inline and
     * nothing else. Something with no date at all — "pull out beanie babies to
     * display" — is a one-off nobody has decided about, not a recurring
     * commitment, and calling it recurring pushed it *down* the ranking below
     * the litter box.
     */
    expect(kindOf(schedule({ kind: 'unscheduled' }))).toBe('task');
  });

  it('agrees with itself', () => {
    // `isRecurring` is the same question asked the other way round; two
    // implementations of one rule is how they drift.
    const daily = schedule({ kind: 'daily', everyNDays: 1 });
    const once = schedule({ kind: 'once', dueOn: civilDate('2026-09-05'), granularity: 'day' });

    expect(isRecurring(daily)).toBe(true);
    expect(isRecurring(once)).toBe(false);
  });
});
