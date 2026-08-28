import { civilDate } from '../civil/date';
import type { RecurrenceRule, Schedule } from '../recurrence/types';
import { isRecurring, kindOf, splitByKind } from './kind';

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

describe('splitting a list', () => {
  const item = (id: string, rule: RecurrenceRule) => ({ id, schedule: schedule(rule) });

  const daily = (id: string) => item(id, { kind: 'daily', everyNDays: 1 });
  const oneOff = (id: string) =>
    item(id, { kind: 'once', dueOn: civilDate('2026-09-05'), granularity: 'day' });

  it('keeps each side in the order it arrived', () => {
    /*
     * A partition, not a sort. Whatever ordering the caller established —
     * urgency, priority, the plan's own positions — has to survive being
     * separated, and the ids here are interleaved so a re-sort would show.
     */
    const { chores, tasks } = splitByKind(
      [daily('c1'), oneOff('t1'), daily('c2'), oneOff('t2')],
      (i) => i.schedule,
    );

    expect(chores.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('handles a list that is all one kind', () => {
    const { chores, tasks } = splitByKind([daily('a'), daily('b')], (i) => i.schedule);
    expect(chores).toHaveLength(2);
    expect(tasks).toHaveLength(0);
  });

  it('loses nothing', () => {
    const items = [daily('a'), oneOff('b'), item('c', { kind: 'unscheduled' })];
    const { chores, tasks } = splitByKind(items, (i) => i.schedule);

    // Identity, not cardinality: two lengths summing to three also holds for an
    // implementation that files one item twice and drops another.
    expect([...chores, ...tasks].map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
  });
});
