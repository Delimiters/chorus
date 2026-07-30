/**
 * Tests for the agenda transformations.
 *
 * The collapse rule replaced a fixed day-count horizon, and its whole value is
 * that it behaves correctly at every cadence — so it is tested at every cadence
 * rather than at one.
 */

import { addDays, civilDate } from '../civil/date';
import type { CalendarConfig, CivilDate } from '../civil/types';
import type { Schedule } from '../recurrence/types';
import { buildTodayView, collapseSupersededMisses, groupFloating, isFloatingItem } from './agenda';
import { projectOccurrences } from './project';
import type { ChoreInput, CompletionInput, ProjectionInput } from './types';

const CAL: CalendarConfig = { weekStartsOn: 0 };
const ME = 'me';
const THEM = 'them';
const d = (s: string): CivilDate => civilDate(s);

function project(
  chores: ChoreInput[],
  today: CivilDate,
  window: { start: CivilDate; end: CivilDate },
  completions: CompletionInput[] = [],
) {
  const input: ProjectionInput = {
    chores,
    completions,
    exceptions: [],
    memberIds: [ME, THEM],
    today,
  };
  return projectOccurrences(input, CAL, window);
}

const chore = (over: Partial<ChoreInput> & { schedule: Schedule }): ChoreInput => ({
  id: 'chore',
  title: 'A chore',
  assignment: { kind: 'anyone' },
  archived: false,
  ...over,
});

const daily = (startsOn: string): Schedule => ({
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: d(startsOn),
  endsOn: null,
  timeOfDay: null,
});

const weeklyOn = (startsOn: string, weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6): Schedule => ({
  rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [weekday] },
  startsOn: d(startsOn),
  endsOn: null,
  timeOfDay: null,
});

describe('collapsing superseded misses', () => {
  it('a daily chore missed yesterday shows only today', () => {
    // The point of the rule: yesterday's dishes are not a separate debt.
    const today = d('2026-01-10');
    const items = collapseSupersededMisses(
      project([chore({ schedule: daily('2026-01-01') })], today, {
        start: d('2026-01-01'),
        end: d('2026-01-10'),
      }),
      today,
    );
    const outstanding = items.filter((i) => i.status === 'due' || i.status === 'overdue');
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]?.dueOn).toBe('2026-01-10');
    expect(outstanding[0]?.status).toBe('due');
  });

  it('records how many were missed before the survivor', () => {
    const today = d('2026-01-10');
    const items = collapseSupersededMisses(
      project([chore({ schedule: daily('2026-01-01') })], today, {
        start: d('2026-01-01'),
        end: d('2026-01-10'),
      }),
      today,
    );
    // Nine earlier days went by undone.
    expect(items[0]?.missedBefore).toBe(9);
  });

  it('a weekly chore missed on Sunday stays overdue all week', () => {
    // 2026-01-04 is a Sunday. Today is Wednesday the 7th.
    const today = d('2026-01-07');
    const items = collapseSupersededMisses(
      project([chore({ schedule: weeklyOn('2026-01-04', 0) })], today, {
        start: d('2026-01-04'),
        end: d('2026-01-07'),
      }),
      today,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('overdue');
    expect(items[0]?.dueOn).toBe('2026-01-04');
    expect(items[0]?.daysOverdue).toBe(3);
  });

  it('and is replaced by the next one when it comes round again', () => {
    const today = d('2026-01-11'); // the following Sunday
    const items = collapseSupersededMisses(
      project([chore({ schedule: weeklyOn('2026-01-04', 0) })], today, {
        start: d('2026-01-04'),
        end: d('2026-01-11'),
      }),
      today,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.dueOn).toBe('2026-01-11');
    expect(items[0]?.status).toBe('due');
    expect(items[0]?.missedBefore).toBe(1);
  });

  it('a one-time chore never expires', () => {
    // No later occurrence exists to supersede it, so it simply stays.
    const today = d('2026-06-01');
    const schedule: Schedule = {
      rule: { kind: 'once', dueOn: d('2026-01-05'), granularity: 'day' },
      startsOn: d('2026-01-01'),
      endsOn: null,
      timeOfDay: null,
    };
    const items = collapseSupersededMisses(
      project([chore({ schedule })], today, { start: d('2026-01-01'), end: d('2026-06-01') }),
      today,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('overdue');
    expect(items[0]?.daysOverdue).toBe(147);
  });

  it('never shows more than one outstanding row per recurring chore', () => {
    // The wall-of-guilt guard: whatever the cadence, one row.
    const today = d('2026-03-01');
    for (const schedule of [daily('2026-01-01'), weeklyOn('2026-01-04', 0)]) {
      const items = collapseSupersededMisses(
        project([chore({ schedule })], today, { start: d('2026-01-20'), end: d('2026-03-01') }),
        today,
      );
      const outstanding = items.filter((i) => i.status === 'due' || i.status === 'overdue');
      expect(outstanding).toHaveLength(1);
    }
  });

  it('leaves future occurrences alone', () => {
    const today = d('2026-01-05');
    const items = collapseSupersededMisses(
      project([chore({ schedule: daily('2026-01-01') })], today, {
        start: d('2026-01-01'),
        end: d('2026-01-09'),
      }),
      today,
    );
    // Today's plus four upcoming; only the past collapsed.
    expect(items.filter((i) => i.status === 'upcoming')).toHaveLength(4);
  });

  it('keeps what was completed today, so ticking something off does not hide it', () => {
    // The bug this guards: an earlier version considered only outstanding
    // occurrences, so completing today's dishes made YESTERDAY'S become "the
    // latest outstanding" and reappear on the list. What supersedes an older
    // occurrence is the existence of a newer one, not whether it is done.
    const today = d('2026-01-10');
    const window = { start: d('2026-01-01'), end: d('2026-01-10') };
    const schedule = daily('2026-01-01');

    const todays = project([chore({ schedule })], today, window).find((o) => o.dueOn === today);
    const completions: CompletionInput[] = [
      {
        choreId: 'chore',
        occurrenceKey: todays?.occurrenceKey as string,
        completedOn: today,
        completedBy: ME,
      },
    ];

    const items = collapseSupersededMisses(
      project([chore({ schedule })], today, window, completions),
      today,
    );

    // Exactly one row: today's, now done. Yesterday's stays superseded.
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('completed');
    expect(items[0]?.dueOn).toBe('2026-01-10');
  });

  it('drops history completed on an earlier day', () => {
    // Completed last week is not today's business; it belongs in the chore's
    // detail view, not on the agenda.
    const today = d('2026-01-10');
    const window = { start: d('2026-01-01'), end: d('2026-01-10') };
    const schedule = daily('2026-01-01');

    const all = project([chore({ schedule })], today, window);
    const completions: CompletionInput[] = all.slice(0, 3).map((o) => ({
      choreId: o.choreId,
      occurrenceKey: o.occurrenceKey,
      completedOn: o.dueOn,
      completedBy: ME,
    }));

    const items = collapseSupersededMisses(
      project([chore({ schedule })], today, window, completions),
      today,
    );
    expect(items.filter((i) => i.status === 'completed')).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(items[0]?.dueOn).toBe('2026-01-10');
  });

  it('collapses each person separately for a fan-out chore', () => {
    const today = d('2026-01-10');
    const items = collapseSupersededMisses(
      project([chore({ schedule: daily('2026-01-01'), assignment: { kind: 'everyone' } })], today, {
        start: d('2026-01-01'),
        end: d('2026-01-10'),
      }),
      today,
    );
    const outstanding = items.filter((i) => i.status === 'due' || i.status === 'overdue');
    // One survivor each — your laundry and their laundry are different work.
    expect(outstanding).toHaveLength(2);
    expect(new Set(outstanding.map((i) => i.subject)).size).toBe(2);
  });

  it('keeps concurrent floating slots, which do not supersede each other', () => {
    // Three slots share a due date; they are three jobs, not one superseding two.
    const today = d('2026-01-07');
    const schedule: Schedule = {
      rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
      startsOn: d('2026-01-04'),
      endsOn: null,
      timeOfDay: null,
    };
    const items = collapseSupersededMisses(
      project([chore({ schedule })], today, { start: d('2026-01-04'), end: d('2026-01-10') }),
      today,
    );
    expect(items.filter((i) => i.status === 'due')).toHaveLength(3);
  });
});

describe('floating groups', () => {
  const floatingSchedule: Schedule = {
    rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
    startsOn: d('2026-01-04'),
    endsOn: null,
    timeOfDay: null,
  };

  const build = (completions: CompletionInput[] = []) => {
    const today = d('2026-01-07');
    return collapseSupersededMisses(
      project(
        [chore({ title: 'Water the plants', schedule: floatingSchedule })],
        today,
        { start: d('2026-01-04'), end: d('2026-01-10') },
        completions,
      ),
      today,
    );
  };

  it('collapses the slots into a single row with a count', () => {
    const { floating, dated } = groupFloating(build());
    expect(dated).toHaveLength(0);
    expect(floating).toHaveLength(1);
    expect(floating[0]).toMatchObject({
      choreTitle: 'Water the plants',
      total: 3,
      done: 0,
    });
  });

  it('counts completions and points at the next slot', () => {
    const all = build();
    const completions: CompletionInput[] = [
      {
        choreId: 'chore',
        occurrenceKey: all[0]?.occurrenceKey as string,
        completedOn: d('2026-01-05'),
        completedBy: ME,
      },
    ];
    const { floating } = groupFloating(build(completions));
    expect(floating[0]?.done).toBe(1);
    expect(floating[0]?.total).toBe(3);
    // Ticking the row acts on the first slot that is not yet done.
    expect(floating[0]?.nextSlot?.slot).toBe(1);
  });

  it('reports no next slot once the period is finished', () => {
    const all = build();
    const completions: CompletionInput[] = all.map((o) => ({
      choreId: 'chore',
      occurrenceKey: o.occurrenceKey,
      completedOn: d('2026-01-05'),
      completedBy: ME,
    }));
    const { floating } = groupFloating(build(completions));
    expect(floating[0]?.done).toBe(3);
    expect(floating[0]?.nextSlot).toBeNull();
  });

  it('exposes the window, so the row can say "any day this week"', () => {
    const { floating } = groupFloating(build());
    expect(floating[0]?.flexibleFrom).toBe('2026-01-04');
    expect(floating[0]?.flexibleUntil).toBe('2026-01-10');
  });

  it('separates dated chores from floating ones', () => {
    const today = d('2026-01-07');
    const items = collapseSupersededMisses(
      project(
        [
          chore({ id: 'f', title: 'Plants', schedule: floatingSchedule }),
          chore({ id: 'd', title: 'Dishes', schedule: daily('2026-01-04') }),
        ],
        today,
        { start: d('2026-01-04'), end: d('2026-01-10') },
      ),
      today,
    );
    const { floating, dated } = groupFloating(items);
    expect(floating.map((g) => g.choreTitle)).toEqual(['Plants']);
    expect(dated.every((i) => i.choreTitle === 'Dishes')).toBe(true);
  });

  it('identifies a floating occurrence by its window, not its rule', () => {
    const items = build();
    expect(isFloatingItem(items[0] as (typeof items)[number])).toBe(true);
  });
});

describe('the Today view', () => {
  const today = d('2026-01-07');

  const twoChores = (): ChoreInput[] => [
    {
      id: 'mine',
      title: 'Mine',
      schedule: daily('2026-01-07'),
      assignment: { kind: 'fixed', memberId: ME },
      archived: false,
    },
    {
      id: 'theirs',
      title: 'Theirs',
      schedule: daily('2026-01-07'),
      assignment: { kind: 'fixed', memberId: THEM },
      archived: false,
    },
  ];

  it('puts yours first and theirs below', () => {
    const view = buildTodayView(
      collapseSupersededMisses(project(twoChores(), today, { start: today, end: today }), today),
      today,
      ME,
    );
    expect(view.mine.map((i) => i.choreTitle)).toEqual(['Mine']);
    expect(view.theirs.map((i) => i.choreTitle)).toEqual(['Theirs']);
  });

  it('counts an unassigned chore as yours, since anyone can do it', () => {
    const chores: ChoreInput[] = [
      {
        ...twoChores()[0],
        id: 'any',
        title: 'Anyone',
        assignment: { kind: 'anyone' },
      } as ChoreInput,
    ];
    const view = buildTodayView(
      collapseSupersededMisses(project(chores, today, { start: today, end: today }), today),
      today,
      ME,
    );
    expect(view.mine).toHaveLength(1);
    expect(view.theirs).toHaveLength(0);
  });

  it('keeps what was completed today, so you can see what your housemate did', () => {
    const chores = twoChores();
    const all = project(chores, today, { start: today, end: today });
    const completions: CompletionInput[] = [
      {
        choreId: 'theirs',
        occurrenceKey: all.find((o) => o.choreId === 'theirs')?.occurrenceKey as string,
        completedOn: today,
        completedBy: THEM,
      },
    ];
    const view = buildTodayView(
      collapseSupersededMisses(
        project(chores, today, { start: today, end: today }, completions),
        today,
      ),
      today,
      ME,
    );
    expect(view.done.map((i) => i.choreTitle)).toEqual(['Theirs']);
    expect(view.done[0]?.completedBy).toBe(THEM);
    // And it is no longer outstanding for anybody.
    expect(view.theirs).toHaveLength(0);
  });

  it('counts outstanding work including unfinished floating groups', () => {
    const chores: ChoreInput[] = [
      {
        id: 'f',
        title: 'Plants',
        schedule: {
          rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
          startsOn: d('2026-01-04'),
          endsOn: null,
          timeOfDay: null,
        },
        assignment: { kind: 'anyone' },
        archived: false,
      },
      ...twoChores(),
    ];
    const view = buildTodayView(
      collapseSupersededMisses(
        project(chores, today, { start: d('2026-01-04'), end: d('2026-01-10') }),
        today,
      ),
      today,
      ME,
    );
    // Two dated rows plus one floating group that still has slots left.
    expect(view.outstandingCount).toBe(3);
    expect(view.floating).toHaveLength(1);
  });

  it('is empty when there is genuinely nothing to do', () => {
    const view = buildTodayView([], today, ME);
    expect(view.mine).toEqual([]);
    expect(view.theirs).toEqual([]);
    expect(view.floating).toEqual([]);
    expect(view.outstandingCount).toBe(0);
  });
});

describe('overdue days', () => {
  it('a floating chore is never shown overdue, because the next period supersedes it', () => {
    // Worth stating explicitly, because it follows from the rule rather than
    // from any special case: floating periods are contiguous, so a missed week
    // is always replaced by the current one. "You didn't water the plants last
    // week" becomes "water the plants this week", which is the intent.
    const today = d('2026-01-14');
    const schedule: Schedule = {
      rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 1 },
      startsOn: d('2026-01-04'),
      endsOn: null,
      timeOfDay: null,
    };
    const items = collapseSupersededMisses(
      project([chore({ schedule })], today, { start: d('2026-01-04'), end: d('2026-01-14') }),
      today,
    );

    const outstanding = items.filter((i) => i.status === 'due' || i.status === 'overdue');
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]?.status).toBe('due');
    // The current week, not the missed one.
    expect(outstanding[0]?.dueOn).toBe('2026-01-11');
    // But the miss is still acknowledged quietly.
    expect(outstanding[0]?.missedBefore).toBe(1);
  });

  it('counts overdue days from the end of the flexible window', () => {
    // For an anchored chore the window is a single day, so this is just "days
    // since it was due" — but the calculation must come from flexibleUntil, or
    // a floating chore would read late partway through its own period.
    const today = d('2026-01-09');
    const items = collapseSupersededMisses(
      project([chore({ schedule: weeklyOn('2026-01-04', 0) })], today, {
        start: d('2026-01-04'),
        end: today,
      }),
      today,
    );
    expect(items[0]?.status).toBe('overdue');
    expect(items[0]?.daysOverdue).toBe(5);
  });

  it('is zero for anything not overdue', () => {
    const today = d('2026-01-07');
    const items = collapseSupersededMisses(
      project([chore({ schedule: daily('2026-01-07') })], today, {
        start: today,
        end: addDays(today, 3),
      }),
      today,
    );
    expect(items.every((i) => i.daysOverdue === 0)).toBe(true);
  });
});
