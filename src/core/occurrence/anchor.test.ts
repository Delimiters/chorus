/**
 * Completion-anchored intervals, tested through the projector.
 *
 * Deliberately not against `anchorToCompletion` in isolation: the thing that
 * matters is what the app renders, and the last two engine-adjacent bugs here
 * were correct pure functions composed wrongly one layer up. These go through
 * `projectOccurrences` with real schedules and real completions.
 */

import { civilDate } from '../civil/date';
import type { CalendarConfig, CivilDate } from '../civil/types';
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
