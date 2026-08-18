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
import {
  buildTodayView,
  collapseSupersededMisses,
  groupFloating,
  isFloatingItem,
  toAgendaItems,
} from './agenda';
import { projectOccurrences } from './project';
import type { ChoreInput, CompletionInput, ExceptionInput, ProjectionInput } from './types';

const CAL: CalendarConfig = { weekStartsOn: 0 };
const ME = 'me';
const THEM = 'them';
const d = (s: string): CivilDate => civilDate(s);

function project(
  chores: ChoreInput[],
  today: CivilDate,
  window: { start: CivilDate; end: CivilDate },
  completions: CompletionInput[] = [],
  exceptions: ExceptionInput[] = [],
) {
  const input: ProjectionInput = {
    chores,
    completions,
    exceptions,
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
  timesOfDay: [],
});

const weeklyOn = (startsOn: string, weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6): Schedule => ({
  rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [weekday] },
  startsOn: d(startsOn),
  endsOn: null,
  timesOfDay: [],
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
      timesOfDay: [],
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

  /**
   * Exceptions were entirely absent from this file, which mattered: skips and
   * reschedules are two of the three things the app actually stores, and both
   * change which occurrence the collapse rule should treat as the survivor.
   */
  describe('with exceptions', () => {
    const today = d('2026-01-10');
    const window = { start: d('2026-01-01'), end: d('2026-01-10') };
    const schedule = daily('2026-01-01');
    const keyFor = (dueOn: CivilDate): string =>
      project([chore({ schedule })], today, window).find((o) => o.dueOn === dueOn)
        ?.occurrenceKey as string;

    it('a skipped occurrence still supersedes the misses before it', () => {
      // Skipping today means "not this time", not "give me yesterday's back".
      const items = collapseSupersededMisses(
        project(
          [chore({ schedule })],
          today,
          window,
          [],
          [{ choreId: 'chore', occurrenceKey: keyFor(today), kind: 'skip', movedTo: null }],
        ),
        today,
      );
      expect(items.filter((i) => i.status === 'due' || i.status === 'overdue')).toHaveLength(0);
      // And yesterday's did not crawl back onto the list.
      expect(items.every((i) => i.dueOn === today)).toBe(true);
    });

    it('counts a skipped earlier occurrence as handled, not as missed', () => {
      const items = collapseSupersededMisses(
        project(
          [chore({ schedule })],
          today,
          window,
          [],
          [
            {
              choreId: 'chore',
              occurrenceKey: keyFor(d('2026-01-09')),
              kind: 'skip',
              movedTo: null,
            },
          ],
        ),
        today,
      );
      const survivor = items.find((i) => i.dueOn === today);
      // Eight genuinely missed days, not nine — the skipped one was a decision.
      expect(survivor?.missedBefore).toBe(8);
    });

    it('an occurrence rescheduled past the end of the window still supersedes', () => {
      // The window ends today, so the moved occurrence falls outside it — the
      // projector emits it anyway, marked `displaced`, precisely so this works.
      // Without that, yesterday's became "the latest one at or before today"
      // and came back as overdue.
      const items = collapseSupersededMisses(
        project(
          [chore({ schedule })],
          today,
          window,
          [],
          [
            {
              choreId: 'chore',
              occurrenceKey: keyFor(today),
              kind: 'reschedule',
              movedTo: d('2026-01-14'),
            },
          ],
        ),
        today,
      );
      expect(items.filter((i) => i.status === 'due' || i.status === 'overdue')).toHaveLength(0);
      // And the displaced occurrence is not rendered either — its date is
      // outside what the caller asked for.
      expect(items).toHaveLength(0);
    });

    it('an occurrence rescheduled within the window shows on its new date', () => {
      const items = collapseSupersededMisses(
        project(
          [chore({ schedule })],
          today,
          { start: d('2026-01-01'), end: d('2026-01-20') },
          [],
          [
            {
              choreId: 'chore',
              occurrenceKey: keyFor(today),
              kind: 'reschedule',
              movedTo: d('2026-01-14'),
            },
          ],
        ),
        today,
      );
      // It moved off today, and — the point of the test — yesterday's did not
      // take its place. A newer occurrence supersedes by existing, not by
      // staying where the rule put it.
      expect(items.filter((i) => i.status === 'due' || i.status === 'overdue')).toHaveLength(0);
      expect(items.find((i) => i.rescheduled)?.dueOn).toBe('2026-01-14');
    });

    it('an occurrence rescheduled onto today becomes the survivor', () => {
      const moved = collapseSupersededMisses(
        project(
          [chore({ schedule })],
          today,
          window,
          [],
          [
            {
              choreId: 'chore',
              occurrenceKey: keyFor(d('2026-01-03')),
              kind: 'reschedule',
              movedTo: today,
            },
          ],
        ),
        today,
      );
      const outstanding = moved.filter((i) => i.status === 'due' || i.status === 'overdue');
      // Both today's own occurrence and the one moved onto today are real work.
      expect(outstanding).toHaveLength(2);
      expect(outstanding.every((i) => i.dueOn === today)).toBe(true);
    });
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
      timesOfDay: [],
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
    timesOfDay: [],
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
          timesOfDay: [],
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

  /**
   * These are the tests that matter for floating chores, because zero
   * completions is the one input on which a correct implementation and a broken
   * one agree. The screen previously grouped *after* filtering out completed
   * slots, so every floating row read "0 of N" and a finished chore fell out of
   * its group into N identical Done rows. With no completions, neither showed.
   */
  const plants: ChoreInput = {
    id: 'f',
    title: 'Plants',
    schedule: {
      rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
      startsOn: d('2026-01-04'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'anyone' },
    archived: false,
  };
  const week = { start: d('2026-01-04'), end: d('2026-01-10') };

  /** Completes the first `n` slots of the floating chore, today. */
  const completeSlots = (n: number): CompletionInput[] =>
    project([plants], today, week)
      .filter((o) => o.choreId === 'f')
      .sort((a, b) => a.slot - b.slot)
      .slice(0, n)
      .map((o) => ({
        choreId: o.choreId,
        occurrenceKey: o.occurrenceKey,
        completedOn: today,
        completedBy: ME,
      }));

  const plantsView = (n: number) =>
    buildTodayView(
      collapseSupersededMisses(project([plants], today, week, completeSlots(n)), today),
      today,
      ME,
    );

  it('counts completed slots against a floating chore, not away from it', () => {
    const group = plantsView(1).floating[0];
    expect(group?.total).toBe(3);
    expect(group?.done).toBe(1);
    expect(group?.nextSlot).not.toBeNull();
  });

  it('keeps a finished floating chore as one row rather than three done rows', () => {
    const view = plantsView(3);
    expect(view.floating).toHaveLength(1);
    expect(view.floating[0]?.done).toBe(3);
    expect(view.floating[0]?.nextSlot).toBeNull();
    // The point of the grouping: not three identical "Plants" rows in Done.
    expect(view.done).toEqual([]);
  });

  it('stops counting a finished floating chore as outstanding', () => {
    expect(plantsView(2).outstandingCount).toBe(1);
    expect(plantsView(3).outstandingCount).toBe(0);
  });

  it('counts each completed slot in the day total, since each was a job done', () => {
    expect(plantsView(0).doneCount).toBe(0);
    expect(plantsView(2).doneCount).toBe(2);
  });

  /**
   * Found by driving the app, not by a test: skipping a chore made it vanish
   * from Today, and Upcoming only lists from today forward — so the skipped
   * occurrence existed in the database with no screen able to show it, and the
   * "Un-skip it" action could never be reached. An undoable action whose undo
   * is unreachable is a one-way door with a handle painted on.
   */
  describe('skipped occurrences stay reachable', () => {
    const window = { start: d('2026-01-04'), end: d('2026-01-10') };
    const schedule = weeklyOn('2026-01-04', 0); // Sunday the 4th

    const skipOf = (dueOn: CivilDate): ExceptionInput => ({
      choreId: 'chore',
      occurrenceKey: project([chore({ schedule })], today, window).find((o) => o.dueOn === dueOn)
        ?.occurrenceKey as string,
      kind: 'skip',
      movedTo: null,
    });

    it('lists a skipped occurrence so its undo can be reached', () => {
      const view = buildTodayView(
        collapseSupersededMisses(
          project([chore({ schedule })], today, window, [], [skipOf(d('2026-01-04'))]),
          today,
        ),
        today,
        ME,
      );

      expect(view.skipped.map((i) => i.dueOn)).toEqual(['2026-01-04']);
      // And it is not counted as work still to do.
      expect(view.mine).toEqual([]);
      expect(view.theirs).toEqual([]);
      expect(view.outstandingCount).toBe(0);
    });

    it('does not count a skip as done', () => {
      const view = buildTodayView(
        collapseSupersededMisses(
          project([chore({ schedule })], today, window, [], [skipOf(d('2026-01-04'))]),
          today,
        ),
        today,
        ME,
      );
      // Skipping is a decision, not an achievement; the day's tally must not
      // claim otherwise.
      expect(view.done).toEqual([]);
      expect(view.doneCount).toBe(0);
    });

    it('says nothing when nothing was skipped', () => {
      const view = buildTodayView(
        collapseSupersededMisses(project([chore({ schedule })], today, window), today),
        today,
        ME,
      );
      expect(view.skipped).toEqual([]);
    });
  });

  it('is empty when there is genuinely nothing to do', () => {
    const view = buildTodayView([], today, ME);
    expect(view.mine).toEqual([]);
    expect(view.theirs).toEqual([]);
    expect(view.floating).toEqual([]);
    expect(view.outstandingCount).toBe(0);
  });
});

describe('several floating chores at once', () => {
  it('orders the band alphabetically, so the rows do not shuffle between renders', () => {
    const today = d('2026-01-07');
    const floatingEvery = (id: string, title: string, times: number): ChoreInput =>
      chore({
        id,
        title,
        schedule: {
          rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: times },
          startsOn: d('2026-01-04'),
          endsOn: null,
          timesOfDay: [],
        },
      });

    const { floating } = groupFloating(
      collapseSupersededMisses(
        project([floatingEvery('z', 'Vacuum', 2), floatingEvery('a', 'Plants', 3)], today, {
          start: d('2026-01-04'),
          end: d('2026-01-10'),
        }),
        today,
      ),
    );

    // By title, not by insertion order or id — the projector's order is an
    // implementation detail and must not leak into the screen.
    expect(floating.map((g) => g.choreTitle)).toEqual(['Plants', 'Vacuum']);
    expect(floating.map((g) => g.total)).toEqual([3, 2]);
  });
});

describe('uncollapsed agenda items', () => {
  const today = d('2026-01-10');
  const window = { start: d('2026-01-01'), end: d('2026-01-10') };

  it('keeps every occurrence, including the ones the collapse rule would drop', () => {
    // What the calendar wants: a record of what the schedule said on each day.
    // Collapsing here erased every superseded past dot from the month grid.
    const projected = project([chore({ schedule: daily('2026-01-01') })], today, window);
    const items = toAgendaItems(projected, today);

    expect(items).toHaveLength(projected.length);
    expect(items).toHaveLength(10);
    // Whereas the agenda keeps exactly one.
    expect(collapseSupersededMisses(projected, today)).toHaveLength(1);
  });

  it('marks nothing as missed, because nothing here supersedes anything', () => {
    const items = toAgendaItems(
      project([chore({ schedule: daily('2026-01-01') })], today, window),
      today,
    );
    expect(items.every((i) => i.missedBefore === 0)).toBe(true);
  });

  it('still derives days overdue, which is a property of the occurrence', () => {
    const items = toAgendaItems(
      project([chore({ schedule: weeklyOn('2026-01-04', 0) })], d('2026-01-07'), {
        start: d('2026-01-04'),
        end: d('2026-01-07'),
      }),
      d('2026-01-07'),
    );
    expect(items[0]?.daysOverdue).toBe(3);
  });

  it('sorts by date, then title, then slot', () => {
    const items = toAgendaItems(
      project(
        [
          chore({ id: 'b', title: 'Zebra', schedule: daily('2026-01-09') }),
          chore({ id: 'a', title: 'Apple', schedule: daily('2026-01-09') }),
        ],
        today,
        { start: d('2026-01-09'), end: d('2026-01-10') },
      ),
      today,
    );
    expect(items.map((i) => `${i.dueOn} ${i.choreTitle}`)).toEqual([
      '2026-01-09 Apple',
      '2026-01-09 Zebra',
      '2026-01-10 Apple',
      '2026-01-10 Zebra',
    ]);
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
      timesOfDay: [],
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

describe('a dated chore asked to appear early', () => {
  /*
   * `isFloatingItem` asks whether the completion window is wider than a day,
   * because that is what separates "three times this week" from a chore due on
   * a date. Bringing a deadline forward by widening that window therefore filed
   * every such chore into the floating band — a different kind of thing, drawn
   * with progress pips, and sorted apart from everything else.
   *
   * Visibility is now its own field, and the completion window says what it
   * always said.
   */
  const early = project(
    [
      {
        id: 'patio',
        title: 'Set up new patio set',
        schedule: {
          rule: {
            kind: 'once',
            dueOn: d('2026-08-31'),
            granularity: 'month',
            showFrom: d('2026-08-17'),
          },
          startsOn: d('2026-08-31'),
          endsOn: null,
          timesOfDay: [],
        },
        assignment: { kind: 'anyone' },
        archived: false,
      } as ChoreInput,
    ],
    d('2026-08-17'),
    { start: d('2026-08-01'), end: d('2026-09-30') },
  );

  it('is not a floating chore', () => {
    expect(early[0]).toBeDefined();
    expect(isFloatingItem(early[0]!)).toBe(false);
  });

  it('is still due, which is the point of asking', () => {
    expect(early[0]?.status).toBe('due');
  });

  it('lands in the ordinary lists rather than the floating band', () => {
    const view = buildTodayView(toAgendaItems(early, d('2026-08-17')), d('2026-08-17'), ME);
    expect(view.mine.map((i) => i.choreId)).toEqual(['patio']);
    expect(view.floating).toEqual([]);
  });
});

describe('how many times in a row it was missed', () => {
  /*
   * Reported from the phone, on real data: a daily chore done on the 14th and
   * the 17th but not the 15th or 16th said "missed last 2 times" — while the
   * last time was the 17th, and it was done.
   *
   * "Missed last N times" is a claim about the most recent N occurrences, so
   * counting every unfinished one in the window made it false whenever a
   * completed occurrence sat in between.
   */
  const today = d('2026-01-10');
  const window = { start: d('2026-01-01'), end: d('2026-01-10') };
  const schedule = daily('2026-01-06');

  const survivorAfter = (completedOn: readonly CivilDate[]) => {
    const all = project([chore({ schedule })], today, window);
    const completions: CompletionInput[] = all
      .filter((o) => completedOn.includes(o.dueOn))
      .map((o) => ({
        choreId: o.choreId,
        occurrenceKey: o.occurrenceKey,
        completedOn: o.dueOn,
        completedBy: ME,
      }));
    const items = collapseSupersededMisses(
      project([chore({ schedule })], today, window, completions),
      today,
    );
    return items.find((i) => i.dueOn === today);
  };

  it('counts an unbroken run', () => {
    // 6th done, then 7th, 8th and 9th missed.
    expect(survivorAfter([d('2026-01-06')])?.missedBefore).toBe(3);
  });

  it('stops at the last time it was done', () => {
    // The bug, in the shape it was reported: done on the 6th and the 9th,
    // missed the 7th and 8th. The last time was the 9th and it was done.
    expect(survivorAfter([d('2026-01-06'), d('2026-01-09')])?.missedBefore).toBe(0);
  });

  it('counts only back to the last completion, not to the start of the window', () => {
    // Done on the 7th, missed the 8th and 9th: two, not three.
    expect(survivorAfter([d('2026-01-07')])?.missedBefore).toBe(2);
  });

  it('drops the count when a missed day is ticked off later', () => {
    // Doing it late is doing it. Ticking the 9th off afterwards ends the run
    // there, so the row stops claiming a miss for a job that got done.
    const before = survivorAfter([])?.missedBefore;
    const after = survivorAfter([d('2026-01-09')])?.missedBefore;
    expect(before).toBe(4);
    expect(after).toBe(0);
  });
});
