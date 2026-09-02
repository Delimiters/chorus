/**
 * Completion-anchored intervals, tested through the projector.
 *
 * Deliberately not against `anchorToCompletion` in isolation: the thing that
 * matters is what the app renders, and the last two engine-adjacent bugs here
 * were correct pure functions composed wrongly one layer up. These go through
 * `projectOccurrences` with real schedules and real completions.
 */

import { addDays, civilDate } from '../civil/date';
import type { CalendarConfig, CivilDate } from '../civil/types';
import { anchorToCompletion } from './anchor';
import { projectOccurrences } from './project';
import type { ChoreInput, CompletionInput } from './types';

const d = (s: string): CivilDate => civilDate(s);
const CAL: CalendarConfig = { weekStartsOn: 1 };
const TODAY = d('2026-09-10');

const every = (days: number, startsOn: string): ChoreInput => ({
  id: 'plants',
  title: 'Water the plants',
  schedule: {
    rule: { kind: 'daily', everyNDays: days },
    startsOn: d(startsOn),
    endsOn: null,
    timesOfDay: [],
  },
  assignment: { kind: 'anyone' },
  archived: false,
});

const weekly = (startsOn: string): ChoreInput => ({
  id: 'bins',
  title: 'Take the bins out',
  schedule: {
    // 2026-09-01 is a Tuesday; weekday 2 is Tuesday with a Monday week start.
    rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [2] },
    startsOn: d(startsOn),
    endsOn: null,
    timesOfDay: [],
  },
  assignment: { kind: 'anyone' },
  archived: false,
});

const done = (occurrenceKey: string, completedOn: string): CompletionInput => ({
  choreId: 'plants',
  occurrenceKey,
  completedOn: d(completedOn),
  completedBy: 'user-me',
});

/** A completion addressed at a due date, by the key that date produces. */
const done2 = (dueOn: string, completedOn: string): CompletionInput => ({
  choreId: 'plants',
  occurrenceKey: `v1:plants:${dueOn}:0:-`,
  completedOn: d(completedOn),
  completedBy: 'user-me',
});

function project(chores: ChoreInput[], completions: CompletionInput[], today = TODAY) {
  return projectOccurrences(
    { chores, completions, exceptions: [], memberIds: ['user-me'], today },
    CAL,
    { start: d('2026-09-01'), end: d('2026-09-30') },
  );
}

const dates = (occurrences: readonly { dueOn: CivilDate }[]) => occurrences.map((o) => o.dueOn);

describe('an interval chore nobody has done', () => {
  it('runs on the plain grid', () => {
    // The control. Without it, "the dates changed" could not be told apart
    // from "the dates were always going to be these".
    const out = project([every(6, '2026-09-02')], []);
    expect(dates(out).slice(0, 4)).toEqual([
      d('2026-09-02'),
      d('2026-09-08'),
      d('2026-09-14'),
      d('2026-09-20'),
    ]);
  });
});

describe('doing it late', () => {
  it('restarts the clock from when it was done', () => {
    /*
     * Jake's case, exactly: every 6 days, done 3 days late. The grid would say
     * the 8th and then the 14th; done on the 5th, the next is the 11th.
     *
     * This is the assertion the whole change exists for.
     */
    const chore = every(6, '2026-09-02');
    const first = project([chore], [])[0];
    const out = project([chore], [done(first?.occurrenceKey ?? '', '2026-09-05')]);

    expect(dates(out)).toContain(d('2026-09-02'));
    expect(dates(out)).toContain(d('2026-09-11'));
    // The fixed grid's next date must be gone, or nothing has actually moved.
    expect(dates(out)).not.toContain(d('2026-09-08'));
  });

  it('keeps the completed occurrence, still marked done', () => {
    /*
     * The failure mode of a naive re-anchor. Occurrence keys come from the due
     * date, so moving the whole grid orphans the completion — the row you just
     * ticked disappears from Done and comes back as due.
     */
    const chore = every(6, '2026-09-02');
    const first = project([chore], [])[0];
    const out = project([chore], [done(first?.occurrenceKey ?? '', '2026-09-05')]);

    const completed = out.find((o) => o.dueOn === d('2026-09-02'));
    expect(completed?.status).toBe('completed');
    expect(completed?.completedOn).toBe(d('2026-09-05'));
  });

  it('carries on at the interval from the new anchor', () => {
    const chore = every(6, '2026-09-02');
    const first = project([chore], [])[0];
    const out = dates(project([chore], [done(first?.occurrenceKey ?? '', '2026-09-05')]));

    expect(out).toContain(d('2026-09-17'));
    expect(out).toContain(d('2026-09-23'));
  });
});

describe('doing it late more than once', () => {
  it('restarts the clock every time, not just the first', () => {
    /*
     * The defect a review caught, and the one that mattered most: the first
     * version scanned the *fixed* grid for completions, so once a chore had
     * re-anchored, its real dates no longer appeared there and no later
     * completion was ever found. Every chore re-anchored exactly once in its
     * life and then reverted — the "no amount of doing it ever catches up"
     * condition this whole module exists to remove.
     *
     * Every six days from the 2nd. Done three days late on the 5th, so the
     * next is the 11th. Done three days late again on the 14th, so the next
     * must be the 20th — and used to stay at the 17th.
     */
    const chore = every(6, '2026-09-02');
    const first = project([chore], [])[0];
    const c1 = done(first?.occurrenceKey ?? '', '2026-09-05');

    const afterOne = project([chore], [c1]);
    expect(dates(afterOne)).toContain(d('2026-09-11'));

    const second = afterOne.find((o) => o.dueOn === d('2026-09-11'));
    const c2 = done(second?.occurrenceKey ?? '', '2026-09-14');
    const afterTwo = dates(project([chore], [c1, c2]));

    expect(afterTwo).toContain(d('2026-09-20'));
    expect(afterTwo).not.toContain(d('2026-09-17'));
  });

  it('keeps both completed occurrences marked done', () => {
    const chore = every(6, '2026-09-02');
    const first = project([chore], [])[0];
    const c1 = done(first?.occurrenceKey ?? '', '2026-09-05');
    const second = project([chore], [c1]).find((o) => o.dueOn === d('2026-09-11'));
    const c2 = done(second?.occurrenceKey ?? '', '2026-09-14');

    const out = project([chore], [c1, c2]);
    expect(out.find((o) => o.dueOn === d('2026-09-02'))?.status).toBe('completed');
    expect(out.find((o) => o.dueOn === d('2026-09-11'))?.status).toBe('completed');
  });

  it('walks a long chain without losing the thread', () => {
    // Five completions in a row, each three days late. Nothing here should
    // depend on how many have happened.
    const chore = every(6, '2026-09-02');
    const completions: CompletionInput[] = [];
    let series = project([chore], completions);

    for (let i = 0; i < 5; i += 1) {
      const next = series.find((o) => o.status !== 'completed');
      if (next === undefined) break;
      completions.push(done(next.occurrenceKey, addDays(next.dueOn, 3)));
      series = project([chore], completions);
    }

    /*
     * Four, not five: the chain runs 02 → 11 → 20 → 29 and the next lands past
     * the window. Asserting a fixed five would have been asserting the window
     * size rather than the behaviour.
     *
     * What matters is that *every* completion still resolves to a completed
     * occurrence — none was orphaned by a later re-anchor moving the dates out
     * from under its key.
     */
    expect(completions.length).toBeGreaterThanOrEqual(4);
    expect(series.filter((o) => o.status === 'completed')).toHaveLength(completions.length);
    expect(dates(series)).toEqual(
      expect.arrayContaining([d('2026-09-11'), d('2026-09-20'), d('2026-09-29')]),
    );
  });
});

describe('an exception in the re-anchored gap', () => {
  it('keeps a rescheduled occurrence rather than dropping it', () => {
    /*
     * Re-anchoring removes the fixed-grid dates between the completion and the
     * new one. A row somebody had explicitly *moved* used to vanish with them,
     * silently — the disappearing-row complaint, from a different direction.
     */
    const chore = every(6, '2026-09-02');
    const plain = project([chore], []);
    const first = plain[0];
    const eighth = plain.find((o) => o.dueOn === d('2026-09-08'));

    const out = projectOccurrences(
      {
        chores: [chore],
        completions: [done(first?.occurrenceKey ?? '', '2026-09-05')],
        exceptions: [
          {
            choreId: 'plants',
            occurrenceKey: eighth?.occurrenceKey ?? '',
            kind: 'reschedule',
            movedTo: d('2026-09-09'),
          },
        ],
        memberIds: ['user-me'],
        today: TODAY,
      },
      CAL,
      { start: d('2026-09-01'), end: d('2026-09-30') },
    );

    expect(dates(out)).toContain(d('2026-09-09'));
  });
});

describe('doing it early', () => {
  it('still moves the next one forward', () => {
    const chore = every(6, '2026-09-02');
    const second = project([chore], []).find((o) => o.dueOn === d('2026-09-08'));
    const out = dates(project([chore], [done(second?.occurrenceKey ?? '', '2026-09-06')]));

    expect(out).toContain(d('2026-09-12'));
    expect(out).not.toContain(d('2026-09-14'));
  });

  it('never produces an occurrence on or before the one just completed', () => {
    /*
     * The floor, with a fixture that actually needs it.
     *
     * Every 2 days from the 2nd, and the occurrence due on the 8th is done six
     * days early, on the 2nd. Counting the interval from the completion alone
     * gives the 4th — which is *behind* the one just ticked, so the grid would
     * re-emit the 4th and the 6th, duplicating dates that are already history
     * and colliding with their keys.
     *
     * The first version of this test completed a 30-day chore on its own due
     * date, where the floor never binds; it passed with the floor deleted.
     */
    const chore = every(2, '2026-09-02');
    const eighth = project([chore], []).find((o) => o.dueOn === d('2026-09-08'));
    const out = project([chore], [done(eighth?.occurrenceKey ?? '', '2026-09-02')]);

    const all = dates(out);
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((date) => date > d('2026-09-08')).length).toBeGreaterThan(0);
    // Nothing new may land at or before the completed occurrence.
    expect(all.filter((date) => date === d('2026-09-04')).length).toBe(1);
  });
});

describe('calendar rules are left alone', () => {
  it('does not walk bin day around the week', () => {
    /*
     * The distinction the whole design rests on. "Every Tuesday" is a fact
     * about Tuesday; complete it on Wednesday and completion-anchoring would
     * move bin day to Wednesday, and then to Thursday, forever.
     *
     * 2026-09-01 and 09-08 are Tuesdays. Completing the first on the Wednesday
     * must leave the second exactly where it was.
     */
    const chore = weekly('2026-09-01');
    const first = projectOccurrences(
      { chores: [chore], completions: [], exceptions: [], memberIds: ['user-me'], today: TODAY },
      CAL,
      { start: d('2026-09-01'), end: d('2026-09-30') },
    )[0];

    const out = projectOccurrences(
      {
        chores: [chore],
        completions: [
          {
            choreId: 'bins',
            occurrenceKey: first?.occurrenceKey ?? '',
            completedOn: d('2026-09-02'),
            completedBy: 'user-me',
          },
        ],
        exceptions: [],
        memberIds: ['user-me'],
        today: TODAY,
      },
      CAL,
      { start: d('2026-09-01'), end: d('2026-09-30') },
    );

    expect(dates(out)).toEqual([
      d('2026-09-01'),
      d('2026-09-08'),
      d('2026-09-15'),
      d('2026-09-22'),
      d('2026-09-29'),
    ]);
  });
});

describe('rotation survives the re-anchor', () => {
  it('does not hand the chore back to whoever had the first turn', () => {
    /*
     * A re-expansion restarts `occurrenceIndex` at zero unless it is carried,
     * and occurrence-cadence rotation counts turns with exactly that. Without
     * the offset, completing anything would reset the rota — so one person
     * would do it forever.
     */
    const rotating: ChoreInput = {
      ...every(2, '2026-09-02'),
      assignment: {
        kind: 'rotate',
        cadence: { unit: 'occurrence', every: 1 },
        segments: [{ effectiveFrom: d('2026-09-02'), memberIds: ['alice', 'bob'], offset: 0 }],
      },
    };

    const plain = projectOccurrences(
      {
        chores: [rotating],
        completions: [],
        exceptions: [],
        memberIds: ['alice', 'bob'],
        today: TODAY,
      },
      CAL,
      { start: d('2026-09-01'), end: d('2026-09-30') },
    );
    const first = plain[0];

    const out = projectOccurrences(
      {
        chores: [rotating],
        completions: [
          {
            choreId: 'plants',
            occurrenceKey: first?.occurrenceKey ?? '',
            completedOn: d('2026-09-02'),
            completedBy: 'alice',
          },
        ],
        exceptions: [],
        memberIds: ['alice', 'bob'],
        today: TODAY,
      },
      CAL,
      { start: d('2026-09-01'), end: d('2026-09-30') },
    );

    // Alice did the first; the next one must not be hers again.
    const next = out.find((o) => o.dueOn > d('2026-09-02'));
    expect(next?.assignee).not.toEqual(first?.assignee);
  });
});

describe('the same chore looks the same from every window', () => {
  /*
   * The defect this guards is invisible to every other test here, because they
   * all use one window.
   *
   * `expand.ts` calls window composability "the property most likely to catch
   * an off-by-one anywhere in this file" and property-tests it — but anchoring
   * happens a layer *above* the expander, where no property reached. A review
   * measured a 24% disagreement rate between projecting a whole window and
   * projecting the same window in two halves, once an interval chore had a
   * completion: the completion was outside the second half's range, so that
   * half silently fell back to the fixed grid.
   *
   * Four screens project the same chores over different windows — Today,
   * Upcoming, Stats and the reminder planner. Disagreeing about dates means
   * disagreeing about occurrence *keys*, so a reminder could fire for something
   * Today does not show, and a completion written from one screen would not be
   * the row another screen generates.
   */
  const splitAt = (chore: ChoreInput, completions: CompletionInput[], cut: CivilDate) => {
    const whole = projectOccurrences(
      { chores: [chore], completions, exceptions: [], memberIds: ['user-me'], today: TODAY },
      CAL,
      { start: d('2026-09-01'), end: d('2026-11-30') },
    );
    const second = projectOccurrences(
      { chores: [chore], completions, exceptions: [], memberIds: ['user-me'], today: TODAY },
      CAL,
      { start: cut, end: d('2026-11-30') },
    );
    return {
      whole: whole.filter((o) => o.dueOn >= cut).map((o) => o.dueOn),
      second: second.map((o) => o.dueOn),
    };
  };

  it('agrees when the completion is far outside the later window', () => {
    // The exact case that failed: the anchoring completion is two months before
    // the second window even begins.
    const chore = every(6, '2026-09-02');
    const first = project([chore], [])[0];
    const completions = [done(first?.occurrenceKey ?? '', '2026-09-05')];

    const { whole, second } = splitAt(chore, completions, d('2026-11-01'));

    expect(second.length).toBeGreaterThan(0);
    expect(second).toEqual(whole);
  });

  it('agrees for a long interval, where the fallback was most visible', () => {
    const chore = every(30, '2026-09-02');
    const first = project([chore], [])[0];
    const completions = [done(first?.occurrenceKey ?? '', '2026-09-20')];

    const { whole, second } = splitAt(chore, completions, d('2026-11-01'));

    expect(second.length).toBeGreaterThan(0);
    expect(second).toEqual(whole);
  });

  it('agrees after several completions', () => {
    /*
     * Three days late, not two, and the difference is the whole test.
     *
     * At two days late over an interval of six, three completions accumulate
     * exactly six days of drift — so the re-anchored chain is congruent to the
     * fixed grid mod N and lands on identical dates. This passed against the
     * unfixed engine, which is the "documents the shape of a guarantee without
     * checking it" case AGENTS.md warns about. Three days late is not
     * congruent, and it fails without the fix.
     */
    const chore = every(6, '2026-09-02');
    const completions: CompletionInput[] = [];
    let series = project([chore], completions);
    for (let i = 0; i < 3; i += 1) {
      const next = series.find((o) => o.status !== 'completed');
      if (next === undefined) break;
      completions.push(done(next.occurrenceKey, addDays(next.dueOn, 3)));
      series = project([chore], completions);
    }

    const { whole, second } = splitAt(chore, completions, d('2026-11-01'));

    expect(second.length).toBeGreaterThan(0);
    expect(second).toEqual(whole);
  });
});

describe('what re-anchoring must not disturb', () => {
  const rotating = (days: number, startsOn: string): ChoreInput => ({
    id: 'plants',
    title: 'Water the plants',
    schedule: {
      rule: { kind: 'daily', everyNDays: days },
      startsOn: d(startsOn),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: d(startsOn), memberIds: ['alice', 'bob'], offset: 0 }],
    },
    archived: false,
  });

  const turns = (chore: ChoreInput, completions: CompletionInput[], today = TODAY) =>
    projectOccurrences(
      { chores: [chore], completions, exceptions: [], memberIds: ['alice', 'bob'], today },
      CAL,
      { start: d('2026-09-02'), end: d('2026-09-20') },
    ).map(
      (o) =>
        `${o.dueOn}#${o.occurrenceIndex}:${o.assignee.kind === 'member' ? o.assignee.memberId : '?'}`,
    );

  it('does not hand a rotating chore back to the person who just did it', () => {
    /*
     * `occurrenceIndex` is what an occurrence-cadence rotation counts turns
     * with, so it has to increase by one along the chain. Deriving it from the
     * date's distance along the original grid gave 0, 2, 3, 4 for a chore done
     * one day late — index 1 never existed, bob's turn was deleted, and alice
     * got it twice running. Nothing on screen says "your turn was skipped".
     */
    const chore = rotating(2, '2026-09-02');
    const out = turns(chore, [done2('2026-09-02', '2026-09-03')]);

    expect(out.slice(0, 4)).toEqual([
      '2026-09-02#0:alice',
      '2026-09-05#1:bob',
      '2026-09-07#2:alice',
      '2026-09-09#3:bob',
    ]);
  });

  it('gives the same turn to the same person from a later window', () => {
    // The index has to be window-independent as well as monotonic: a rotation
    // that depends on how far the screen looks ahead is a rotation two people
    // can read differently on two phones.
    const chore = rotating(2, '2026-09-02');
    const completions = [done2('2026-09-02', '2026-09-03')];

    const whole = turns(chore, completions);
    const later = projectOccurrences(
      { chores: [chore], completions, exceptions: [], memberIds: ['alice', 'bob'], today: TODAY },
      CAL,
      { start: d('2026-09-11'), end: d('2026-09-20') },
    ).map(
      (o) =>
        `${o.dueOn}#${o.occurrenceIndex}:${o.assignee.kind === 'member' ? o.assignee.memberId : '?'}`,
    );

    expect(later.length).toBeGreaterThan(0);
    expect(later).toEqual(whole.filter((t) => t >= '2026-09-11'));
  });

  it('keeps one person&apos;s everyone chore off the other person&apos;s dates', () => {
    /*
     * `everyone` is "one job *each*, done separately". Grouping completions by
     * chore alone re-anchored the whole fan-out, so Emily doing her own laundry
     * slid mine three days later — I did nothing and my schedule moved.
     */
    const chore: ChoreInput = {
      id: 'plants',
      title: 'Laundry',
      schedule: {
        rule: { kind: 'daily', everyNDays: 6 },
        startsOn: d('2026-09-02'),
        endsOn: null,
        timesOfDay: [],
      },
      assignment: { kind: 'everyone' },
      archived: false,
    };
    const out = projectOccurrences(
      {
        chores: [chore],
        completions: [
          {
            choreId: 'plants',
            occurrenceKey: 'v1:plants:2026-09-02:0:alice',
            completedOn: d('2026-09-05'),
            completedBy: 'alice',
          },
        ],
        exceptions: [],
        memberIds: ['alice', 'bob'],
        today: TODAY,
      },
      CAL,
      { start: d('2026-09-02'), end: d('2026-09-20') },
    );

    // Alice re-anchors to her completion; bob stays on the grid he was always on.
    expect(dates(out.filter((o) => o.subject === 'bob'))).toEqual([
      d('2026-09-02'),
      d('2026-09-08'),
      d('2026-09-14'),
      d('2026-09-20'),
    ]);
    expect(dates(out.filter((o) => o.subject === 'alice'))).toEqual([
      d('2026-09-02'),
      d('2026-09-11'),
      d('2026-09-17'),
    ]);
  });

  it('ignores a completion of a date the chain never had', () => {
    /*
     * A stale client ticks the *fixed grid* date, which this chore no longer
     * falls on. Trusting it dragged the whole series onto a phase nothing was
     * ever due on, and the tick itself still vanished.
     */
    const chore = every(6, '2026-09-02');
    const out = project(
      [chore],
      [done2('2026-09-02', '2026-09-05'), done2('2026-09-14', '2026-09-14')],
    );

    expect(dates(out).slice(0, 3)).toEqual([d('2026-09-02'), d('2026-09-11'), d('2026-09-17')]);
  });
});

describe('the cost of a long history', () => {
  it('does not re-expand the window once per completion', () => {
    /*
     * Counted rather than timed, so it cannot flake on a slow runner.
     *
     * `expandFrom` materialises the whole window on every call, so expanding
     * inside the per-completion loop is O(completions × window) — measured at
     * 537ms for a two-year-old daily chore over a 21-day window, on the JS
     * thread, inside a `useMemo`, recomputed on every optimistic tick. Segments
     * that end before the window are counted arithmetically instead, which is
     * what makes passing *every* completion affordable in the first place.
     */
    const startsOn = d('2024-09-01');
    const schedule = {
      rule: { kind: 'daily' as const, everyNDays: 1 },
      startsOn,
      endsOn: null,
      timesOfDay: [],
    };

    const completions = Array.from({ length: 700 }, (_unused, i) => {
      const dueOn = addDays(startsOn, i);
      return { occurrenceKey: `v1:plants:${dueOn}:0:-`, completedOn: dueOn };
    });

    let calls = 0;
    const windowStart = d('2026-08-15');
    anchorToCompletion(
      schedule,
      [],
      completions,
      () => {
        calls += 1;
        return [];
      },
      () => false,
      windowStart,
    );

    // Every one of the 700 completions predates the window, so only the final
    // open-ended segment needs expanding at all.
    expect(calls).toBe(1);
  });
});
