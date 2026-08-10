import fc from 'fast-check';

import { civilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import type { ProjectedOccurrence } from '../occurrence/types';
import { currentStreak, summarise } from './summarise';

const ME = 'me';
const THEM = 'them';
const TODAY = civilDate('2026-03-15');

const occ = (over: Partial<ProjectedOccurrence> = {}): ProjectedOccurrence =>
  ({
    choreId: 'dishes',
    choreTitle: 'Dishes',
    occurrenceKey: `v1:dishes:${over.dueOn ?? '2026-03-01'}:0:-`,
    dueOn: civilDate('2026-03-01'),
    flexibleFrom: over.dueOn ?? civilDate('2026-03-01'),
    flexibleUntil: over.dueOn ?? civilDate('2026-03-01'),
    periodKey: '2026-03-01',
    slot: 0,
    subject: null,
    occurrenceIndex: 0,
    status: 'completed',
    assignee: { kind: 'member', memberId: ME, turn: 0 },
    timesOfDay: [],
    completedOn: civilDate('2026-03-01'),
    completedBy: ME,
    daysLate: 0,
    rescheduled: false,
    originalDueOn: null,
    displaced: false,
    ...over,
  }) as ProjectedOccurrence;

const run = (occurrences: ProjectedOccurrence[], today: CivilDate = TODAY) =>
  summarise({ occurrences, from: civilDate('2026-03-01'), to: civilDate('2026-03-31'), today });

describe('summarise', () => {
  it('counts everything the schedule produced, not only what is left', () => {
    const result = run([
      occ({ status: 'completed' }),
      occ({ status: 'skipped', dueOn: civilDate('2026-03-02') }),
      occ({ status: 'overdue', dueOn: civilDate('2026-03-03'), completedOn: null }),
      occ({ status: 'upcoming', dueOn: civilDate('2026-03-20'), completedOn: null }),
    ]);
    expect(result.expected).toBe(4);
    expect(result.completed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.missed).toBe(1);
  });

  it('does not call something missed when it is simply not due yet', () => {
    // A window running into the future would otherwise count tomorrow's chore
    // as a failure the moment it was created.
    const result = run([
      occ({ status: 'due', dueOn: civilDate('2026-03-20'), completedOn: null }),
      occ({ status: 'due', dueOn: TODAY, completedOn: null }),
    ]);
    expect(result.missed).toBe(0);
  });

  it('ignores occurrences rescheduled out of the window', () => {
    // `displaced` exists so supersession can see them; their date is outside
    // what was asked for, so counting them would double-count the move.
    const result = run([occ({ displaced: true })]);
    expect(result.expected).toBe(0);
  });

  describe('lateness', () => {
    it('averages only the late ones', () => {
      // Averaging the on-time zeros in makes a household that is punctual
      // about most things and a week late on one look identical to one that is
      // two days late on everything — and the second is worth noticing.
      const result = run([
        occ({ daysLate: 0 }),
        occ({ daysLate: 0, dueOn: civilDate('2026-03-02') }),
        occ({ daysLate: 6, dueOn: civilDate('2026-03-03') }),
      ]);
      expect(result.onTime).toBe(2);
      expect(result.averageDaysLate).toBe(6);
    });

    it('is zero rather than NaN when nothing was late', () => {
      expect(run([occ({ daysLate: 0 })]).averageDaysLate).toBe(0);
    });

    it('never reports more on time than completed', () => {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 20 }), (lateness) => {
          const result = run(
            lateness.map((daysLate, i) =>
              occ({ daysLate, dueOn: civilDate('2026-03-01'), occurrenceKey: `k${i}` }),
            ),
          );
          expect(result.onTime).toBeLessThanOrEqual(result.completed);
        }),
      );
    });
  });

  describe('per person', () => {
    it('splits completions by who did them', () => {
      const result = run([
        occ({ completedBy: ME }),
        occ({ completedBy: THEM, dueOn: civilDate('2026-03-02') }),
        occ({ completedBy: THEM, dueOn: civilDate('2026-03-03') }),
      ]);
      expect(result.byPerson).toEqual([
        { memberId: THEM, completed: 2, onTime: 2 },
        { memberId: ME, completed: 1, onTime: 1 },
      ]);
    });

    it('keeps a completion whose author deleted their account', () => {
      // It still happened, and it is the household's history. Dropping it
      // would quietly reduce the totals every time somebody left.
      const result = run([occ({ completedBy: null })]);
      expect(result.completed).toBe(1);
      expect(result.byPerson).toEqual([{ memberId: null, completed: 1, onTime: 1 }]);
    });

    it('orders by count, then by id, so the order never depends on input order', () => {
      const forward = run([
        occ({ completedBy: ME }),
        occ({ completedBy: THEM, dueOn: civilDate('2026-03-02') }),
      ]);
      const backward = run([
        occ({ completedBy: THEM, dueOn: civilDate('2026-03-02') }),
        occ({ completedBy: ME }),
      ]);
      expect(backward.byPerson).toEqual(forward.byPerson);
    });
  });

  it('reports expected versus actual per chore, which is the whole point', () => {
    // Answerable only because occurrences are computed: the expander is
    // replayed over the window and compared against what was recorded.
    const result = run([
      occ({ choreId: 'bins', choreTitle: 'Bins', status: 'completed' }),
      occ({
        choreId: 'bins',
        choreTitle: 'Bins',
        status: 'overdue',
        dueOn: civilDate('2026-03-08'),
        completedOn: null,
      }),
    ]);
    expect(result.byChore).toEqual([
      { choreId: 'bins', choreTitle: 'Bins', expected: 2, completed: 1, skipped: 0, missed: 1 },
    ]);
  });

  it('breaks a tie between chores by title, so the order is never input order', () => {
    // Two chores due the same number of times is the common case in a small
    // household, and without the tiebreaker the list would reshuffle itself
    // between renders depending on which occurrence arrived first.
    const forward = run([
      occ({ choreId: 'bins', choreTitle: 'Bins' }),
      occ({ choreId: 'attic', choreTitle: 'Attic', dueOn: civilDate('2026-03-02') }),
    ]);
    const backward = run([
      occ({ choreId: 'attic', choreTitle: 'Attic', dueOn: civilDate('2026-03-02') }),
      occ({ choreId: 'bins', choreTitle: 'Bins' }),
    ]);
    expect(forward.byChore.map((c) => c.choreTitle)).toEqual(['Attic', 'Bins']);
    expect(backward.byChore).toEqual(forward.byChore);
  });

  it('adds up: completed, skipped and missed never exceed expected', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<ProjectedOccurrence['status']>(
            'completed',
            'skipped',
            'overdue',
            'due',
            'upcoming',
          ),
          { maxLength: 30 },
        ),
        (statuses) => {
          const result = run(
            statuses.map((status, i) =>
              occ({
                status,
                occurrenceKey: `k${i}`,
                dueOn: civilDate('2026-03-02'),
                completedOn: status === 'completed' ? civilDate('2026-03-02') : null,
              }),
            ),
          );
          expect(result.completed + result.skipped + result.missed).toBeLessThanOrEqual(
            result.expected,
          );
        },
      ),
    );
  });
});

describe('currentStreak', () => {
  it('counts days, not chores', () => {
    // Four chores on one Tuesday is one day of the streak.
    const day = civilDate('2026-03-15');
    expect(
      currentStreak(
        [occ({ completedOn: day }), occ({ completedOn: day }), occ({ completedOn: day })],
        TODAY,
      ),
    ).toBe(1);
  });

  it('counts consecutive days back from today', () => {
    expect(
      currentStreak(
        [
          occ({ completedOn: civilDate('2026-03-13') }),
          occ({ completedOn: civilDate('2026-03-14') }),
          occ({ completedOn: civilDate('2026-03-15') }),
        ],
        TODAY,
      ),
    ).toBe(3);
  });

  it('breaks on a gap', () => {
    expect(
      currentStreak(
        [
          occ({ completedOn: civilDate('2026-03-11') }),
          occ({ completedOn: civilDate('2026-03-14') }),
          occ({ completedOn: civilDate('2026-03-15') }),
        ],
        TODAY,
      ),
    ).toBe(2);
  });

  it('allows one day of grace, because a morning is not a broken streak', () => {
    expect(currentStreak([occ({ completedOn: civilDate('2026-03-14') })], TODAY)).toBe(1);
  });

  it('reports nothing for a streak that ended weeks ago', () => {
    // Otherwise a household that stopped in February would still be told it
    // has a streak, which is flattering and false.
    expect(currentStreak([occ({ completedOn: civilDate('2026-02-01') })], TODAY)).toBe(0);
  });

  it('is zero when nothing has been completed', () => {
    expect(currentStreak([occ({ status: 'due', completedOn: null })], TODAY)).toBe(0);
  });
});
