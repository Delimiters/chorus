import { civilDate } from '../civil/date';
import type { CalendarConfig, CivilDate } from '../civil/types';
import type { Schedule } from '../recurrence/types';
import type { Assignment } from '../rotation/types';
import {
  ProjectionWindowTooWideError,
  forMember,
  groupByDate,
  projectOccurrences,
  todayView,
} from './project';
import type { ChoreInput, CompletionInput, ExceptionInput, ProjectionInput } from './types';

const CAL: CalendarConfig = { weekStartsOn: 0 };
const TODAY = civilDate('2026-01-07'); // Wednesday
const d = (s: string): CivilDate => civilDate(s);

const daily = (startsOn = '2026-01-05'): Schedule => ({
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: civilDate(startsOn),
  endsOn: null,
  timesOfDay: [],
});

const chore = (over: Partial<ChoreInput> = {}): ChoreInput => ({
  id: 'chore-1',
  title: 'Dishes',
  schedule: daily(),
  assignment: { kind: 'anyone' },
  archived: false,
  ...over,
});

const input = (over: Partial<ProjectionInput> = {}): ProjectionInput => ({
  chores: [chore()],
  completions: [],
  exceptions: [],
  memberIds: ['alice', 'bob'],
  today: TODAY,
  ...over,
});

const WEEK = { start: d('2026-01-05'), end: d('2026-01-11') };

const project = (over: Partial<ProjectionInput> = {}, window = WEEK) =>
  projectOccurrences(input(over), CAL, window);

describe('basic projection', () => {
  it('expands a chore across the window', () => {
    const result = project();
    expect(result).toHaveLength(7);
    expect(result.map((o) => o.dueOn)).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-10',
      '2026-01-11',
    ]);
  });

  it('carries the chore title', () => {
    expect(project()[0]?.choreTitle).toBe('Dishes');
  });

  it('omits archived chores', () => {
    expect(project({ chores: [chore({ archived: true })] })).toEqual([]);
  });

  it('projects several chores together, sorted by date then title', () => {
    const result = project({
      chores: [chore({ id: 'b', title: 'Vacuum' }), chore({ id: 'a', title: 'Dishes' })],
    });
    expect(result.slice(0, 4).map((o) => `${o.dueOn} ${o.choreTitle}`)).toEqual([
      '2026-01-05 Dishes',
      '2026-01-05 Vacuum',
      '2026-01-06 Dishes',
      '2026-01-06 Vacuum',
    ]);
  });

  it('rejects a window too wide to pad', () => {
    expect(() => project({}, { start: d('2026-01-01'), end: d('2027-01-01') })).toThrow(
      ProjectionWindowTooWideError,
    );
  });
});

describe('derived status', () => {
  it('classifies past, present and future', () => {
    const byDate = new Map(project().map((o) => [o.dueOn, o.status]));
    expect(byDate.get(d('2026-01-05'))).toBe('overdue');
    expect(byDate.get(d('2026-01-06'))).toBe('overdue');
    expect(byDate.get(d('2026-01-07'))).toBe('due');
    expect(byDate.get(d('2026-01-08'))).toBe('upcoming');
  });

  it('marks completed occurrences regardless of date', () => {
    const first = project()[0];
    const completion: CompletionInput = {
      choreId: 'chore-1',
      occurrenceKey: first?.occurrenceKey as string,
      completedOn: d('2026-01-05'),
      completedBy: 'alice',
    };
    const result = project({ completions: [completion] });
    expect(result[0]?.status).toBe('completed');
    expect(result[0]?.completedBy).toBe('alice');
    expect(result[0]?.daysLate).toBe(0);
  });

  it('computes lateness rather than storing it', () => {
    const first = project()[0];
    const result = project({
      completions: [
        {
          choreId: 'chore-1',
          occurrenceKey: first?.occurrenceKey as string,
          completedOn: d('2026-01-09'), // due Jan 5
          completedBy: 'bob',
        },
      ],
    });
    expect(result[0]?.daysLate).toBe(4);
  });

  it('never reports negative lateness for an early completion', () => {
    const future = project().find((o) => o.dueOn === '2026-01-11');
    const result = project({
      completions: [
        {
          choreId: 'chore-1',
          occurrenceKey: future?.occurrenceKey as string,
          completedOn: d('2026-01-06'),
          completedBy: 'bob',
        },
      ],
    });
    expect(result.find((o) => o.dueOn === '2026-01-11')?.daysLate).toBe(0);
  });
});

describe('skip', () => {
  it('marks an occurrence skipped without removing it', () => {
    const target = project()[2]; // Jan 7
    const exception: ExceptionInput = {
      choreId: 'chore-1',
      occurrenceKey: target?.occurrenceKey as string,
      kind: 'skip',
      movedTo: null,
    };
    const result = project({ exceptions: [exception] });
    expect(result).toHaveLength(7);
    expect(result[2]?.status).toBe('skipped');
  });

  // The direct regression guard for prototype failure #1.
  it('leaves every other occurrence untouched', () => {
    const before = project();
    const exception: ExceptionInput = {
      choreId: 'chore-1',
      occurrenceKey: before[2]?.occurrenceKey as string,
      kind: 'skip',
      movedTo: null,
    };
    const after = project({ exceptions: [exception] });

    expect(after.map((o) => o.occurrenceKey)).toEqual(before.map((o) => o.occurrenceKey));
    expect(after.map((o) => o.dueOn)).toEqual(before.map((o) => o.dueOn));
    for (let i = 0; i < before.length; i += 1) {
      if (i === 2) continue;
      expect(after[i]?.status).toBe(before[i]?.status);
      expect(after[i]?.assignee).toEqual(before[i]?.assignee);
    }
  });

  it('hides skipped occurrences from the today view', () => {
    const target = project().find((o) => o.dueOn === '2026-01-07');
    const result = project({
      exceptions: [
        {
          choreId: 'chore-1',
          occurrenceKey: target?.occurrenceKey as string,
          kind: 'skip',
          movedTo: null,
        },
      ],
    });
    expect(todayView(result, TODAY).some((o) => o.dueOn === '2026-01-07')).toBe(false);
  });
});

describe('reschedule', () => {
  it('moves the occurrence and records where it came from', () => {
    const target = project()[2]; // Jan 7
    const result = project({
      exceptions: [
        {
          choreId: 'chore-1',
          occurrenceKey: target?.occurrenceKey as string,
          kind: 'reschedule',
          movedTo: d('2026-01-10'),
        },
      ],
    });

    const moved = result.filter((o) => o.occurrenceKey === target?.occurrenceKey);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.dueOn).toBe('2026-01-10');
    expect(moved[0]?.rescheduled).toBe(true);
    expect(moved[0]?.originalDueOn).toBe('2026-01-07');
    // Nothing left behind on the original date.
    expect(result.filter((o) => o.dueOn === '2026-01-07')).toHaveLength(0);
  });

  it('preserves occurrence identity, so a completion still matches', () => {
    const target = project()[2];
    const key = target?.occurrenceKey as string;
    const result = project({
      exceptions: [
        { choreId: 'chore-1', occurrenceKey: key, kind: 'reschedule', movedTo: d('2026-01-10') },
      ],
      completions: [
        {
          choreId: 'chore-1',
          occurrenceKey: key,
          completedOn: d('2026-01-10'),
          completedBy: 'bob',
        },
      ],
    });
    const moved = result.find((o) => o.occurrenceKey === key);
    expect(moved?.status).toBe('completed');
    expect(moved?.occurrenceIndex).toBe(target?.occurrenceIndex);
  });

  it('shows an occurrence rescheduled INTO the window from outside it', () => {
    // Expand a wider window to grab an occurrence outside the target week.
    const wide = project({}, { start: d('2026-01-05'), end: d('2026-01-25') });
    const outside = wide.find((o) => o.dueOn === '2026-01-20');
    expect(outside).toBeDefined();

    const result = project({
      exceptions: [
        {
          choreId: 'chore-1',
          occurrenceKey: outside?.occurrenceKey as string,
          kind: 'reschedule',
          movedTo: d('2026-01-08'),
        },
      ],
    });
    expect(result.filter((o) => o.dueOn === '2026-01-08')).toHaveLength(2);
  });

  it('marks an occurrence rescheduled OUT of the window as displaced', () => {
    // It is emitted rather than dropped, and this is deliberate. The agenda's
    // collapse rule has to know a newer occurrence exists, or the previous one
    // becomes "the latest at or before today" and resurfaces as overdue. The
    // flag is how a consumer tells "this is here for bookkeeping" from "this is
    // here to be rendered". See docs/RECURRENCE.md.
    const target = project()[2];
    const result = project({
      exceptions: [
        {
          choreId: 'chore-1',
          occurrenceKey: target?.occurrenceKey as string,
          kind: 'reschedule',
          movedTo: d('2026-02-15'),
        },
      ],
    });

    const moved = result.find((o) => o.occurrenceKey === target?.occurrenceKey);
    expect(moved?.displaced).toBe(true);
    expect(moved?.dueOn).toBe('2026-02-15');
    expect(moved?.originalDueOn).toBe(target?.dueOn);

    // Nothing else is displaced, and the window is otherwise unchanged.
    expect(result.filter((o) => !o.displaced)).toHaveLength(6);
  });

  it('does not mark an occurrence displaced when it merely moves within the window', () => {
    // The flag must be rare and precise: a routine reschedule is not displaced,
    // and treating it as one would hide the row the user just moved.
    const target = project()[2];
    const result = project({
      exceptions: [
        {
          choreId: 'chore-1',
          occurrenceKey: target?.occurrenceKey as string,
          kind: 'reschedule',
          movedTo: d('2026-01-08'),
        },
      ],
    });
    expect(result.every((o) => !o.displaced)).toBe(true);
  });
});

describe('assignment', () => {
  it('resolves anyone', () => {
    expect(project()[0]?.assignee).toEqual({ kind: 'anyone' });
  });

  it('resolves a fixed member', () => {
    const result = project({
      chores: [chore({ assignment: { kind: 'fixed', memberId: 'alice' } })],
    });
    expect(result[0]?.assignee).toEqual({ kind: 'member', memberId: 'alice', turn: 0 });
  });

  it('rotates day by day', () => {
    const assignment: Assignment = {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: d('2026-01-05'), memberIds: ['alice', 'bob'], offset: 0 }],
    };
    const result = project({ chores: [chore({ assignment })] });
    expect(result.map((o) => (o.assignee.kind === 'member' ? o.assignee.memberId : null))).toEqual([
      'alice',
      'bob',
      'alice',
      'bob',
      'alice',
      'bob',
      'alice',
    ]);
  });

  it('fans out everyone chores into one per member', () => {
    const result = project({
      chores: [chore({ assignment: { kind: 'everyone' }, title: 'Laundry' })],
    });
    expect(result).toHaveLength(14); // 7 days x 2 members

    const firstDay = result.filter((o) => o.dueOn === '2026-01-05');
    expect(firstDay).toHaveLength(2);
    expect(firstDay.map((o) => o.subject).sort()).toEqual(['alice', 'bob']);
    // Distinct keys, so each can be completed independently.
    expect(new Set(firstDay.map((o) => o.occurrenceKey)).size).toBe(2);
  });

  it('lets one member complete their own fan-out without affecting the other', () => {
    const all = project({ chores: [chore({ assignment: { kind: 'everyone' } })] });
    const alice = all.find((o) => o.dueOn === '2026-01-05' && o.subject === 'alice');

    const result = project({
      chores: [chore({ assignment: { kind: 'everyone' } })],
      completions: [
        {
          choreId: 'chore-1',
          occurrenceKey: alice?.occurrenceKey as string,
          completedOn: d('2026-01-05'),
          completedBy: 'alice',
        },
      ],
    });

    const firstDay = result.filter((o) => o.dueOn === '2026-01-05');
    expect(firstDay.find((o) => o.subject === 'alice')?.status).toBe('completed');
    expect(firstDay.find((o) => o.subject === 'bob')?.status).toBe('overdue');
  });
});

describe('views', () => {
  it('todayView returns due and overdue, excluding future and completed', () => {
    const view = todayView(project(), TODAY);
    expect(view.map((o) => o.dueOn)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });

  it('todayView can include what was completed today', () => {
    const target = project().find((o) => o.dueOn === '2026-01-07');
    const result = project({
      completions: [
        {
          choreId: 'chore-1',
          occurrenceKey: target?.occurrenceKey as string,
          completedOn: TODAY,
          completedBy: 'alice',
        },
      ],
    });
    expect(todayView(result, TODAY, { includeCompleted: true }).map((o) => o.dueOn)).toContain(
      '2026-01-07',
    );
    expect(todayView(result, TODAY).map((o) => o.dueOn)).not.toContain('2026-01-07');
  });

  it('forMember includes rotated-to-me plus anyone-can-do', () => {
    const assignment: Assignment = {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: d('2026-01-05'), memberIds: ['alice', 'bob'], offset: 0 }],
    };
    const result = project({
      chores: [
        chore({ id: 'rot', title: 'Trash', assignment }),
        chore({ id: 'any', title: 'Dishes', assignment: { kind: 'anyone' } }),
      ],
    });
    const mine = forMember(result, 'alice');
    // All 7 "anyone" occurrences, plus alice's 4 rotated turns.
    expect(mine.filter((o) => o.choreTitle === 'Dishes')).toHaveLength(7);
    expect(mine.filter((o) => o.choreTitle === 'Trash')).toHaveLength(4);
  });

  it('groupByDate buckets by due date', () => {
    const grouped = groupByDate(project());
    expect(grouped.size).toBe(7);
    expect(grouped.get(d('2026-01-07'))).toHaveLength(1);
  });
});

describe('the agenda, rendered as text', () => {
  // The Phase 2 demo criterion: a pure function turns fixtures into a week's
  // agenda including whose turn it is.
  it('renders a week including rotation', () => {
    const trash: Assignment = {
      kind: 'rotate',
      cadence: { unit: 'week', every: 1 },
      segments: [{ effectiveFrom: d('2026-01-04'), memberIds: ['alice', 'bob'], offset: 0 }],
    };
    const result = projectOccurrences(
      input({
        chores: [
          {
            id: 'trash',
            title: 'Take out trash',
            schedule: {
              rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 3, 5] },
              startsOn: d('2026-01-04'),
              endsOn: null,
              timesOfDay: [],
            },
            assignment: trash,
            archived: false,
          },
        ],
      }),
      CAL,
      { start: d('2026-01-04'), end: d('2026-01-17') },
    );

    const lines = result.map((o) => {
      const who = o.assignee.kind === 'member' ? o.assignee.memberId : 'anyone';
      return `${o.dueOn}  ${o.choreTitle}  (${who})`;
    });

    expect(lines).toEqual([
      '2026-01-05  Take out trash  (alice)',
      '2026-01-07  Take out trash  (alice)',
      '2026-01-09  Take out trash  (alice)',
      '2026-01-12  Take out trash  (bob)',
      '2026-01-14  Take out trash  (bob)',
      '2026-01-16  Take out trash  (bob)',
    ]);
  });
});
