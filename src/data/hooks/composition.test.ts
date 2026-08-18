/**
 * The projector-to-screen composition, tested where it actually happens.
 *
 * This file exists because of a bug that every unit test missed by construction.
 * The projector marks an occurrence rescheduled out of the window `displaced`,
 * so the collapse rule can see that a newer occurrence exists and keep the older
 * one superseded. The collapse rule handled it correctly, and its unit tests —
 * which call it directly on projector output — passed.
 *
 * The app did not do that. `useOccurrences` computed the calendar list first
 * (which strips displaced occurrences, correctly, since their dates are outside
 * the window) and then collapsed *that*. So the collapse never saw a displaced
 * occurrence, the mechanism was inert in production, and nothing failed:
 * `AgendaItem extends ProjectedOccurrence`, so the wrong composition type-checked
 * in silence.
 *
 * The lesson is narrow and worth keeping: **a pure function tested only through
 * its own front door proves nothing about the pipeline that calls it.** These
 * tests run the exact chain `useOccurrences` runs, against the same window it
 * builds, and assert on both outputs.
 */

import { civilDate } from '@/core/civil/date';
import type { CalendarConfig, CivilDate } from '@/core/civil/types';
import { collapseSupersededMisses, toAgendaItems } from '@/core/occurrence/agenda';
import { projectOccurrences } from '@/core/occurrence/project';
import { bucketSections } from '@/core/routines/agenda';
import { projectRoutineOccurrences, type RoutineItemInput } from '@/core/routines/project';
import type { ChoreInput, ExceptionInput } from '@/core/occurrence/types';
import { quantiseWindow } from './useOccurrences';

const d = (s: string): CivilDate => civilDate(s);
const CAL: CalendarConfig = { weekStartsOn: 0 };
const ME = 'me';

/** Today's window, exactly as `useToday_View` builds it. */
const TODAY = d('2026-07-31'); // a Friday — the last day of a Sunday-start week
const WINDOW = quantiseWindow(TODAY, 0, 2, 1);

const dishes: ChoreInput = {
  id: 'dishes',
  title: 'Dishes',
  schedule: {
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: d('2026-07-20'),
    endsOn: null,
    timesOfDay: [],
  },
  assignment: { kind: 'anyone' },
  archived: false,
};

/** The chain `useOccurrences` runs, in the order it runs it. */
function compose(exceptions: ExceptionInput[] = []) {
  const projected = projectOccurrences(
    { chores: [dishes], completions: [], exceptions, memberIds: [ME], today: TODAY },
    CAL,
    WINDOW,
  );
  return {
    calendar: toAgendaItems(projected, TODAY),
    agenda: collapseSupersededMisses(projected, TODAY),
  };
}

const keyFor = (dueOn: CivilDate): string =>
  projectOccurrences(
    { chores: [dishes], completions: [], exceptions: [], memberIds: [ME], today: TODAY },
    CAL,
    WINDOW,
  ).find((o) => o.dueOn === dueOn)?.occurrenceKey as string;

describe('the window Today actually asks for', () => {
  it('ends on the last day of the current week', () => {
    // Which is why moving something to "next week" pushes it out — the quick
    // option in the date field is one tap away from the edge.
    expect(WINDOW.end).toBe('2026-08-01');
  });
});

describe('rescheduling past the end of the window', () => {
  const movedOut: ExceptionInput[] = [
    {
      choreId: 'dishes',
      occurrenceKey: keyFor(TODAY),
      kind: 'reschedule',
      movedTo: d('2026-08-09'),
    },
  ];

  it('does not resurrect yesterday on the agenda', () => {
    // The failure this file exists for. Two taps in the app: open today's
    // chore, "Move it", "Next week". Yesterday's came back as overdue,
    // captioned "The last 8 were missed."
    const { agenda } = compose(movedOut);
    const outstanding = agenda.filter((i) => i.status === 'due' || i.status === 'overdue');
    expect(outstanding).toEqual([]);
  });

  it('and does not show the moved occurrence at a date outside the window', () => {
    const { agenda, calendar } = compose(movedOut);
    for (const item of [...agenda, ...calendar]) {
      expect(item.dueOn <= WINDOW.end).toBe(true);
      expect(item.dueOn >= WINDOW.start).toBe(true);
    }
  });

  it('leaves the calendar showing every other day as normal', () => {
    // The fix must not cost the calendar its history; only the moved one goes.
    const { calendar } = compose(movedOut);
    expect(calendar.some((i) => i.dueOn === '2026-07-30')).toBe(true);
    expect(calendar.some((i) => i.dueOn === TODAY)).toBe(false);
  });
});

describe('rescheduling before the start of the window', () => {
  it('does not show an occurrence dragged back out of range', () => {
    // The mirror of the case above, and the one that fixing it exposes: an
    // occurrence whose position is in the future but whose effective date is
    // behind the window start lands in a different branch of the collapse.
    const { agenda, calendar } = compose([
      {
        choreId: 'dishes',
        occurrenceKey: keyFor(d('2026-08-01')),
        kind: 'reschedule',
        movedTo: d('2026-06-01'),
      },
    ]);
    expect(agenda.every((i) => i.dueOn >= WINDOW.start)).toBe(true);
    expect(calendar.every((i) => i.dueOn >= WINDOW.start)).toBe(true);
  });
});

describe('an ordinary reschedule inside the window', () => {
  it('still moves the row, because displacement must be the rare case', () => {
    const { agenda } = compose([
      {
        choreId: 'dishes',
        occurrenceKey: keyFor(TODAY),
        kind: 'reschedule',
        movedTo: d('2026-08-01'),
      },
    ]);
    const moved = agenda.find((i) => i.rescheduled);
    expect(moved?.dueOn).toBe('2026-08-01');
    expect(moved?.originalDueOn).toBe(TODAY);
  });
});

describe('the two outputs disagree, and are supposed to', () => {
  it('the calendar keeps superseded history the agenda collapses away', () => {
    const { agenda, calendar } = compose();
    // Eleven days of a daily chore in the window versus one outstanding row.
    expect(calendar.length).toBeGreaterThan(agenda.length);
    expect(agenda.filter((i) => i.status === 'due' || i.status === 'overdue')).toHaveLength(1);
  });
});

/**
 * The same shape of failure, in the routine screen.
 *
 * `projectRoutineOccurrences` takes `today` to decide what is *missed* rather
 * than merely not yet done, and `bucketSections` takes the day being *viewed*
 * to decide what to show. `useRoutineDay` passed the viewed day to both — so
 * every row it could render was `due` or `completed`, `missed` was
 * unreachable, and the Missed chip in `RoutineRow` was dead code.
 *
 * Both functions' own tests passed, because both were called directly with the
 * arguments the hook failed to give them.
 */
describe('a routine day in the past', () => {
  const YESTERDAY = d('2026-07-30');
  const stretch: RoutineItemInput = {
    id: 'stretch',
    title: 'Stretch',
    ownerId: ME,
    schedule: {
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: d('2026-07-20'),
      endsOn: null,
      timesOfDay: [],
    },
    timeOfDay: null,
    bucket: 'morning',
    linkedChoreId: null,
    icon: null,
    remind: false,
    shared: false,
  } as unknown as RoutineItemInput;

  /** Exactly the chain `useRoutineDay` runs, with the arguments it now passes. */
  const sectionsFor = (viewing: CivilDate) => {
    const occurrences = projectRoutineOccurrences(
      { items: [stretch], completions: [], today: TODAY },
      CAL,
      quantiseWindow(viewing, 0, 0, 1),
    );
    return bucketSections(occurrences, ME, { showOthers: false, on: viewing });
  };

  it('shows what was missed, not what is merely outstanding', () => {
    const morning = sectionsFor(YESTERDAY).sections.find((s) => s.bucket === 'morning');
    expect(morning?.mine[0]?.status).toBe('missed');
  });

  it('and today is still due, so the fixture is not simply marking everything', () => {
    const morning = sectionsFor(TODAY).sections.find((s) => s.bucket === 'morning');
    expect(morning?.mine[0]?.status).toBe('due');
  });
});

/**
 * A chore dated beyond the window, asked to appear early.
 *
 * `showFrom` decides whether an occurrence counts as due. It cannot decide
 * whether the occurrence is *fetched*, and Today's window is about three weeks
 * wide — so twenty-one chores due at the end of the month were invisible while
 * being, by the engine's own reckoning, due today.
 *
 * The lingering query is the safety net for one-time chores no sane window
 * contains, and it only looked backwards. These run the ranges it now projects.
 */
describe('a one-time chore due beyond the agenda window', () => {
  const WINDOW = quantiseWindow(d('2026-08-17'), 0, 2, 1);
  const TODAY_NOW = d('2026-08-17');

  const errand = (showFrom?: CivilDate): ChoreInput =>
    ({
      id: 'patio',
      title: 'Set up new patio set',
      schedule: {
        rule:
          showFrom === undefined
            ? { kind: 'once', dueOn: d('2026-08-31'), granularity: 'month' }
            : { kind: 'once', dueOn: d('2026-08-31'), granularity: 'month', showFrom },
        startsOn: d('2026-08-31'),
        endsOn: null,
        timesOfDay: [],
      },
      assignment: { kind: 'anyone' },
      archived: false,
    }) as ChoreInput;

  /** Exactly the ranges `useLingeringOneTimeChores` projects. */
  const lingering = (chore: ChoreInput) => {
    const base = {
      chores: [chore],
      completions: [],
      exceptions: [],
      memberIds: [ME],
      today: TODAY_NOW,
    };
    const behind = projectOccurrences(base, CAL, {
      start: d('2025-09-21'),
      end: d('2026-08-01'),
    });
    const ahead = projectOccurrences(base, CAL, {
      start: d('2026-08-23'),
      end: d('2027-07-14'),
    });
    return [...behind, ...ahead].filter((o) => o.status === 'due' || o.status === 'overdue');
  };

  it('is outside the window Today fetches, which is the whole problem', () => {
    expect(WINDOW.end).toBe('2026-08-22');
    expect(d('2026-08-31') > WINDOW.end).toBe(true);
  });

  it('is picked up when it has been asked to show early', () => {
    expect(lingering(errand(TODAY_NOW)).map((o) => o.choreId)).toEqual(['patio']);
  });

  it('is left alone when it has not', () => {
    // Non-vacuity, and the rule that keeps Today a list of things to do: a
    // chore due in October with no showFrom is upcoming, not due.
    expect(lingering(errand())).toEqual([]);
  });
});
