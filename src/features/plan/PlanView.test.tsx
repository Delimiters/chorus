/**
 * The two effects that write to the plan on your behalf.
 *
 * Written after a review found six defects in these seventy-five lines, none of
 * which any test touched — there was no `PlanView.test.tsx` at all, and the
 * riskiest code in the feature was the code nothing asserted.
 *
 * These assert what gets **written**. Both defects that mattered — auto-adding
 * the entire overdue backlog, and a removal that came back after a relaunch —
 * looked completely normal on screen.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ThemeProvider } from '@/design/theme';
import { PlanView } from './PlanView';

const mockMe = 'user-me';
const mockThem = 'user-them';
const mockToday = civilDate('2026-09-01');

const mockAdd = jest.fn();
const mockReorder = jest.fn();
const mockMarkAutoPlanned = jest.fn();
const mockClearPlanOnCreate = jest.fn();

let mockView: {
  mine: AgendaItem[];
  theirs: AgendaItem[];
  done: AgendaItem[];
  skipped: AgendaItem[];
  upcoming: AgendaItem[];
  floating: never[];
};
let mockChores: { id: string; title: string; schedule: unknown }[];
let mockEntries: { occurrenceKey: string; choreId: string; plannedFor: string; position: number }[];
let mockIsLoading = false;
let mockPlanUnknown = false;
let mockEntriesLoading = false;
/** The household's whole plan. Defaults to yours; set apart where it matters. */
let mockAllEntries: typeof mockEntries | null = null;
let mockMembers: { userId: string; displayName: string; accent: string }[] = [];
let mockAutoPlannedOn: string | null = null;
/** Flagged occurrences already auto-added today, as the store would persist them. */
let mockAutoPlannedFlags: { on: string; keys: string[] } | null = null;
const mockMarkFlagsAutoPlanned = jest.fn();
/** The housemate's day, filled by whichever phone opens the app first. */
let mockAutoPlannedTheirsOn: string | null = null;
const mockMarkTheirDayPlanned = jest.fn();
let mockPlanOnCreate: { choreId: string; queuedOn: string }[] = [];

let mockHorizon: AgendaItem[] = [];

jest.mock('@/data/hooks/useOccurrences', () => ({
  useToday_View: () => ({
    view: mockView,
    chores: mockChores,
    today: mockToday,
    isLoading: mockIsLoading,
    error: null,
    refetch: async () => {},
  }),
  // A real horizon, not an empty one. Mocked empty, every assertion about
  // "Later" is vacuous by construction — a review proved exactly that by
  // deleting the group and watching all 498 tests pass.
  useOccurrences: () => ({ agenda: mockHorizon, isLoading: false }),
  quantiseWindow: () => ({ start: mockToday, end: mockToday }),
  useToggleCompletion: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/data/hooks/usePlan', () => ({
  useMyPlanEntries: () => mockEntries,
  /*
   * Both plans, and deliberately a *different* list from `useMyPlanEntries`.
   *
   * These returned the same array, with a comment saying the tests are
   * single-user so it made no difference. The difference between those two
   * hooks is the entire subject of "shared work is claimed once" — the fixture
   * defined the fix away, and a review confirmed the whole suite passed with it
   * reverted. `mockAllEntries` defaults to `mockEntries` and is set apart in
   * the tests that care.
   */
  usePlanEntries: () => mockAllEntries ?? mockEntries,
  usePlanUnavailable: () => mockPlanUnknown,
  usePlanLoading: () => mockEntriesLoading,
  useTheirPlanCount: () => 0,
  useTheirPlanTotal: () => 0,
  useTheirPlanEntries: () => [],
  useRemoveFromPlan: () => ({ mutate: jest.fn() }),
  useReorderPlan: () => ({ mutate: mockReorder }),
  /*
   * Records which day each instance was built for.
   *
   * This discarded its arguments, so the instance bound to your housemate's day
   * and the one bound to yours were the identical object and the owner could
   * not be observed at all. Adding to the wrong plan is the defect this whole
   * area is about.
   */
  useAddToPlan: (_today: string, ownerId?: string) => ({
    mutate: (items: unknown, options?: unknown) => mockAdd(items, options, ownerId),
  }),
}));

jest.mock('@/stores/routineStore', () => ({
  useRoutinePreference: () => ({
    autoPlannedOn: mockAutoPlannedOn,
    autoPlannedFlags: mockAutoPlannedFlags,
    autoPlannedTheirsOn: mockAutoPlannedTheirsOn,
    todayMode: 'plan',
  }),
  useRoutineStore: (selector: (s: unknown) => unknown) =>
    selector({
      markAutoPlanned: mockMarkAutoPlanned,
      markFlagsAutoPlanned: mockMarkFlagsAutoPlanned,
      markTheirDayPlanned: mockMarkTheirDayPlanned,
      planOnCreate: mockPlanOnCreate,
      clearPlanOnCreate: mockClearPlanOnCreate,
      queuePlanOnCreate: jest.fn(),
      setTodayMode: jest.fn(),
      celebratedOn: null,
      markCelebrated: jest.fn(),
    }),
}));

/**
 * Two sets, not one derived from the other.
 *
 * A row *shows* the household's flags and the sheet *toggles* yours, and the
 * two genuinely differ whenever your housemate flags something you have not —
 * which is the case the feature is designed around. Deriving one from the
 * other made every test agree by construction, so the test named "shows a flag
 * somebody else set" would have passed against code reading the wrong set.
 */
const mockProposeDay = jest.fn((...args: unknown[]) => {
  const actual = jest.requireActual('@/core/plan/propose') as {
    proposeDay: (...a: unknown[]) => unknown;
  };
  return actual.proposeDay(...args);
});
/*
 * Spread, not replaced. A bare factory would make every other export of this
 * module `undefined` under test only — `DAY_SIZE` has no importer here today,
 * so the day one appears the failure would be silent and test-only, which is
 * the exact shape AGENTS.md records as "it type-checked, because the wrong
 * type was a subtype of the right one".
 */
jest.mock('@/core/plan/propose', () => ({
  ...jest.requireActual('@/core/plan/propose'),
  proposeDay: (...args: unknown[]) => mockProposeDay(...args),
}));

let mockMyFlags: Set<string> = new Set();
let mockTheirFlags: Set<string> = new Set();
const mockToggleFlag = jest.fn();

/*
 * The same shape as PlanScreen.test.tsx's, and for the same reasons: the map is
 * derived from who flagged rather than kept as a third set, so "flagged by
 * nobody" cannot be written; and the ids come from `mockMe`/`mockThem` rather
 * than literals, which is how the two came to disagree with the screen's.
 *
 * Nothing here assigns these yet. It is wired correctly anyway because the
 * first test that does should get what it asked for rather than a housemate's
 * flag where it wanted its own.
 */
jest.mock('@/data/hooks/useFlags', () => ({
  useFlagsByChore: () => {
    const map = new Map<string, string[]>();
    for (const id of mockMyFlags) map.set(id, [mockMe]);
    for (const id of mockTheirFlags) map.set(id, [...(map.get(id) ?? []), mockThem]);
    return map;
  },
  useToggleFlag: () => ({ mutate: mockToggleFlag }),
}));

jest.mock('@/data/hooks/useCategories', () => ({ useCategoryList: () => [] }));
const mockScheduleToday = jest.fn();
jest.mock('@/data/hooks/useChores', () => ({
  useScheduleToday: () => ({ mutate: mockScheduleToday }),
}));
/*
 * Auto-fill is a household setting. It shipped off, and went back on once the
 * household's schedules were corrected and there was no longer a backlog to
 * drown in — so the default here is `true`, matching the column, and a test
 * that forgets to say gets the shipped behaviour rather than a convenient one.
 */
let mockAutoPlan = true;
/*
 * The household query's own loading state, which this harness could not
 * express at all — `useHousehold` always handed back a resolved object, so the
 * guard that waits for it had no test that could fail. A review found the gate
 * could be inverted to run while the household was still in flight with all
 * 1412 tests green.
 */
let mockHouseholdLoading = false;
jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () =>
    mockHouseholdLoading
      ? { data: undefined }
      : { data: { weekStartsOn: 1, timeZone: 'UTC', autoPlan: mockAutoPlan } },
  useMembers: () => ({ data: mockMembers }),
  useSetPlanGroupOrder: () => ({ mutate: jest.fn(), error: null }),
}));
jest.mock('@/stores/sessionStore', () => ({
  useUserId: () => mockMe,
  // The plan reads subtasks now, and those hooks want a household.
  useActiveHouseholdId: () => 'house-1',
}));

jest.mock('@/data/hooks/useSubtasks', () => ({
  useSubtasksByChore: () => new Map(),
  useSubtaskTicksFor: () => new Map(),
  useToggleSubtask: () => ({ mutate: jest.fn() }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const item = (id: string, over: Partial<AgendaItem> = {}): AgendaItem =>
  ({
    occurrenceKey: `v1:${id}`,
    choreId: id,
    choreTitle: id,
    dueOn: mockToday,
    status: 'due',
    daysOverdue: 0,
    missedBefore: 0,
    completedOn: null,
    completedBy: null,
    assignee: { kind: 'anyone' },
    ...over,
  }) as unknown as AgendaItem;

const recurring = (id: string) => ({
  id,
  title: id,
  schedule: {
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: mockToday,
    endsOn: null,
    timesOfDay: [],
  },
});
const oneOff = (id: string) => ({
  id,
  title: id,
  schedule: {
    rule: { kind: 'once', dueOn: mockToday, granularity: 'day' },
    startsOn: mockToday,
    endsOn: null,
    timesOfDay: [],
  },
});

const renderView = () =>
  render(
    <ThemeProvider>
      <PlanView />
    </ThemeProvider>,
  );

const addedKeys = () =>
  mockAdd.mock.calls.flatMap((call) =>
    (call[0] as { occurrenceKey: string }[]).map((i) => i.occurrenceKey),
  );

beforeEach(() => {
  mockAdd.mockClear();
  mockMarkAutoPlanned.mockClear();
  mockClearPlanOnCreate.mockClear();
  // Flags were the one group of fixtures this reset had missed, so a test that
  // set them leaked into every test written after it — and the proposal test
  // below reads `mockProposeDay.mock.calls.at(-1)`, which would then be
  // reaching into another test's history.
  mockProposeDay.mockClear();
  mockMyFlags = new Set();
  mockTheirFlags = new Set();
  mockAutoPlan = true;
  mockHouseholdLoading = false;
  mockView = { mine: [], theirs: [], done: [], skipped: [], upcoming: [], floating: [] };
  mockChores = [];
  mockEntries = [];
  mockAllEntries = null;
  mockMembers = [{ userId: mockMe, displayName: 'Jake', accent: 'blue' }];
  mockIsLoading = false;
  mockEntriesLoading = false;
  mockAutoPlannedOn = null;
  mockAutoPlannedFlags = null;
  mockMarkFlagsAutoPlanned.mockClear();
  mockAutoPlannedTheirsOn = null;
  mockMarkTheirDayPlanned.mockClear();
  mockPlanOnCreate = [];
  mockHorizon = [];
  mockScheduleToday.mockClear();
});

describe('recurring chores that are due today or late', () => {
  beforeEach(() => {
    mockAutoPlan = true;
  });

  it('go on the plan by themselves', async () => {
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:litter']));
  });

  it('brings late work in with them', async () => {
    /*
     * Jake's call, and a reversal: this file previously asserted the opposite.
     *
     * The case against was that the overdue pile was thirty-two of about fifty
     * rows. That pile was mostly an artefact — interval chores were held
     * against a fixed grid, so three days late meant permanently late. With
     * completion-anchoring, being late is a handful of real things, and a late
     * chore is work you already agreed to. Leaving it off the day made you
     * choose it a second time.
     */
    mockView.mine = [
      item('litter'),
      item('gutters', { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 }),
    ];
    mockChores = [recurring('litter'), recurring('gutters')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(addedKeys().sort()).toEqual(['v1:gutters', 'v1:litter']);
  });

  it('does not drag work forward that is not due yet', async () => {
    /*
     * `view.mine` also carries anything `showFrom` has pulled forward. Those
     * are early, not late — auto-adding them puts next week on today, which is
     * the wall of rows the old today-only rule was really guarding against.
     */
    mockView.mine = [
      item('litter'),
      item('filters', { status: 'due', dueOn: civilDate('2026-09-09') }),
    ];
    mockChores = [recurring('litter'), recurring('filters')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(addedKeys()).toEqual(['v1:litter']);
  });

  it('does not re-add work already finished or skipped today', async () => {
    /*
     * A guard on a fixture that `buildTodayView` does not currently produce —
     * it filters `mine` to due-or-overdue before this ever runs. Kept as a
     * defensive assertion, not presented as the thing that saves us: a chore
     * you already did reappearing unticked is the plan lying about what is
     * left, and this pins that the filter here would catch it.
     */
    mockView.mine = [
      item('litter'),
      item('dishes', { status: 'completed', completedOn: mockToday }),
      item('bins', { status: 'skipped' }),
    ];
    mockChores = [recurring('litter'), recurring('dishes'), recurring('bins')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(addedKeys()).toEqual(['v1:litter']);
  });

  it('takes one-off work too, which is a reversal', async () => {
    /*
     * The original argument for "proposed, not pre-filled" was entirely about
     * one-off work: a one-off is a decision, and decisions belong in the
     * proposal. Jake asked for the opposite — one-time tasks that are due or
     * overdue should land on the day by themselves.
     *
     * See docs/DECISIONS.md. On his household this is 38 extra rows.
     */
    mockView.mine = [item('litter'), item('timesheet')];
    mockChores = [recurring('litter'), oneOff('timesheet')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(addedKeys().sort()).toEqual(['v1:litter', 'v1:timesheet']);
  });

  it('happens once a day, so taking something off sticks', async () => {
    mockAutoPlannedOn = mockToday;
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('waits for the plan, not only for the chores', async () => {
    /*
     * They are separate queries with nothing ordering them. Acting while the
     * plan is still in flight means every already-planned chore looks unplanned
     * and gets added a second time.
     */
    mockEntriesLoading = true;
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('does not re-add something already on the plan', async () => {
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    mockEntries = [
      { occurrenceKey: 'v1:litter', choreId: 'litter', plannedFor: mockToday, position: 1 },
    ];
    renderView();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockAdd).not.toHaveBeenCalled();
    // Still marks the day, or it would try again on every open.
    expect(mockMarkAutoPlanned).toHaveBeenCalledWith(mockToday);
  });

  it('marks the day only once the write has landed', async () => {
    // Marking first meant a failed insert left the day marked done: the
    // auto-plan silently never happened and nothing on screen said so.
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockMarkAutoPlanned).not.toHaveBeenCalled();

    const options = mockAdd.mock.calls[0]?.[1] as { onSuccess: () => void };
    options.onSuccess();
    expect(mockMarkAutoPlanned).toHaveBeenCalledWith(mockToday);
  });
});

describe('a chore created with "put it on today"', () => {
  it('is claimed once its occurrence exists', async () => {
    mockPlanOnCreate = [{ choreId: 'newchore', queuedOn: mockToday }];
    mockView.mine = [item('newchore')];
    mockChores = [oneOff('newchore')];
    renderView();

    await waitFor(() => expect(addedKeys()).toContain('v1:newchore'));
    expect(mockClearPlanOnCreate).toHaveBeenCalledWith(['newchore']);
  });

  it('waits for the occurrence instead of throwing the intent away', async () => {
    /*
     * The defect this replaces, and the test that used to enshrine it.
     *
     * Picking a "No date" chore queues the intent and rewrites the schedule in
     * the same tick, so the very next render still sees an `unscheduled` chore
     * with no occurrence. Clearing unconditionally there discarded the intent
     * before the write had even been issued, and the chore silently became a
     * one-off due today that never reached the plan.
     *
     * The old test asserted exactly that — cleared, nothing added — so the fix
     * would have looked like the regression.
     */
    mockPlanOnCreate = [{ choreId: 'nodate', queuedOn: mockToday }];
    mockChores = [oneOff('nodate')];
    renderView();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockClearPlanOnCreate).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('never puts your housemate’s work on your plan', async () => {
    /*
     * `useAddToPlan` writes `user_id = me`, so pulling from `theirs` silently
     * reassigned work — create a chore for Emily with the switch on and it
     * landed on Jake's plan. The proposal refuses to do this thirty lines up;
     * this used to do it with no guard and no comment.
     */
    mockPlanOnCreate = [{ choreId: 'hers', queuedOn: mockToday }];
    mockView.theirs = [item('hers', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } })];
    mockChores = [oneOff('hers')];
    renderView();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('drops an intent left over from an earlier day', async () => {
    /*
     * Kept until claimed, but not forever: a chore queued yesterday must not
     * ambush somebody on a later morning by landing on the wrong day's plan.
     *
     * The chore is dated in the future so the auto-plan does not add it for its
     * own reasons — since one-off work started being auto-planned, an
     * outstanding one-off is added anyway, and this test would pass without the
     * queue being cleared at all.
     */
    mockPlanOnCreate = [{ choreId: 'yesterday', queuedOn: civilDate('2026-08-31') }];
    mockView.mine = [{ ...item('yesterday'), dueOn: civilDate('2026-10-01') }];
    mockChores = [oneOff('yesterday')];
    renderView();

    await waitFor(() => expect(mockClearPlanOnCreate).toHaveBeenCalledWith(['yesterday']));
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

const undated = (id: string) => ({
  id,
  title: id,
  schedule: {
    rule: { kind: 'unscheduled' },
    startsOn: mockToday,
    endsOn: null,
    timesOfDay: [],
  },
});

describe('the picker, over the whole horizon', () => {
  const openPicker = () => {
    fireEvent.press(
      screen.getByRole('button', { name: /Choose what to do today|Pick my own|^Add something$/ }),
    );
  };

  it('offers one row per chore, not one per future occurrence', async () => {
    /*
     * `collapseSupersededMisses` only collapses at or before today, so a daily
     * chore contributes ninety future occurrences over a thirteen-week horizon
     * and a 3×/week floating chore thirty-six. Rendered whole into a list with
     * no virtualisation, that is an order of magnitude worse than the forty-row
     * group that started this. The soonest one is the only version of the
     * question anybody means.
     */
    mockHorizon = [
      item('dishes', {
        occurrenceKey: 'v1:dishes:03',
        dueOn: civilDate('2026-09-03'),
        status: 'upcoming',
      }),
      item('dishes', {
        occurrenceKey: 'v1:dishes:04',
        dueOn: civilDate('2026-09-04'),
        status: 'upcoming',
      }),
      item('dishes', {
        occurrenceKey: 'v1:dishes:05',
        dueOn: civilDate('2026-09-05'),
        status: 'upcoming',
      }),
    ];
    mockChores = [recurring('dishes')];
    renderView();
    openPicker();

    await waitFor(() => expect(screen.getByText('LATER · 1')).toBeOnTheScreen());
  });

  it('offers a chore due beyond Today’s window at all', async () => {
    // The whole reason for the second query: Today projects three weeks, so
    // anything due in October simply did not exist to be picked.
    mockHorizon = [item('october', { dueOn: civilDate('2026-10-20'), status: 'upcoming' })];
    mockChores = [oneOff('october')];
    renderView();
    openPicker();

    await waitFor(() => expect(screen.getByText('october')).toBeOnTheScreen());
  });

  it('does not offer the same occurrence in two groups', async () => {
    // The horizon overlaps Today's window, so without the dedup a due-today
    // row appears twice and ticking one copy leaves the other looking unpicked.
    mockView.mine = [item('litter')];
    mockHorizon = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();
    openPicker();

    // Counted as *pickable rows*, not as text: the proposal above the picker
    // lists its own titles, so text alone matches both.
    await waitFor(() =>
      expect(screen.getAllByRole('checkbox', { name: 'litter' })).toHaveLength(1),
    );
  });
});

describe('chores with no date', () => {
  it('are offered, rather than being unreachable forever', async () => {
    /*
     * `unscheduled` produces no occurrences by design, so one could never be
     * planned, ticked or finished — you could create the thing and never act
     * on it.
     */
    mockChores = [undated('beanie')];
    renderView();
    fireEvent.press(
      screen.getByRole('button', { name: /Choose what to do today|Pick my own|^Add something$/ }),
    );

    await waitFor(() => expect(screen.getByText('beanie')).toBeOnTheScreen());
  });

  it('are given today’s date rather than being planned directly', async () => {
    // There is no occurrence to plan. Deciding to do it today is deciding when,
    // so the pick schedules the chore and the plan claims it afterwards.
    mockChores = [undated('beanie')];
    renderView();
    fireEvent.press(
      screen.getByRole('button', { name: /Choose what to do today|Pick my own|^Add something$/ }),
    );
    await waitFor(() => expect(screen.getByText('beanie')).toBeOnTheScreen());

    fireEvent.press(screen.getByRole('checkbox', { name: 'beanie' }));
    fireEvent.press(screen.getByRole('button', { name: 'Add 1 to today' }));

    expect(mockScheduleToday).toHaveBeenCalledWith('beanie');
    // The synthetic key must never reach the plan table.
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('work already on the plan', () => {
  it('is shown as already there rather than silently omitted', async () => {
    /*
     * Omitting it made "it's not in the list" mean two different things, which
     * is how a chore that was already planned got reported as missing.
     */
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    mockEntries = [
      { occurrenceKey: 'v1:litter', choreId: 'litter', plannedFor: mockToday, position: 1 },
    ];
    renderView();
    fireEvent.press(
      screen.getByRole('button', { name: /Choose what to do today|Pick my own|^Add something$/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'litter, already on today' })).toBeOnTheScreen(),
    );
  });

  it('covers work planned from beyond Today’s window too', async () => {
    // The group drew only from Today's lists, so anything planned out of
    // "Later" fell out of every group — the same ambiguity, moved.
    mockHorizon = [item('october', { dueOn: civilDate('2026-10-20'), status: 'upcoming' })];
    mockChores = [oneOff('october')];
    mockEntries = [
      { occurrenceKey: 'v1:october', choreId: 'october', plannedFor: mockToday, position: 1 },
    ];
    renderView();
    fireEvent.press(
      screen.getByRole('button', { name: /Choose what to do today|Pick my own|^Add something$/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'october, already on today' })).toBeOnTheScreen(),
    );
  });
});

describe('the day is only marked auto-planned once the write lands', () => {
  beforeEach(() => {
    mockAutoPlan = true;
  });

  /*
   * `useAddToPlan` is optimistic: `onMutate` puts the new rows in the cache
   * before the request is sent. `entries` is a dependency of the auto-plan
   * effect, so that write re-runs the effect, nothing is left to add, and the
   * "nothing to do" branch marked the day done with the request still open.
   * `autoPlannedOn` is persisted, so a write that then failed left the day
   * marked and the auto-plan silently never ran again that day.
   *
   * The other tests in this file cannot see it, because they mock `mutate` as a
   * plain spy that writes nothing — which is the "fix was inert in production"
   * shape AGENTS.md names. This mock does what the real hook does.
   */
  const optimistic = (outcome: 'resolve' | 'reject') => {
    mockAdd.mockImplementation(
      (
        items: { occurrenceKey: string; choreId: string }[],
        options?: { onSuccess?: () => void; onError?: () => void; onSettled?: () => void },
      ) => {
        // `onMutate`: the rows appear in the cache immediately.
        mockEntries = [
          ...mockEntries,
          ...items.map((i, index) => ({ ...i, plannedFor: mockToday, position: index + 1 })),
        ];
        settle = () => {
          if (outcome === 'resolve') options?.onSuccess?.();
          else options?.onError?.();
          options?.onSettled?.();
        };
      },
    );
  };

  let settle: () => void = () => {};

  it('does not mark it while the insert is still in flight', async () => {
    optimistic('resolve');
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    const { rerender } = renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());

    /*
     * The re-render the optimistic cache write causes in the real app. Without
     * driving it the effect never runs a second time, and this test passes
     * against the very bug it exists for — the mocked `useMyPlanEntries` is a
     * plain module variable with no reactivity of its own.
     */
    act(() => {
      rerender(
        <ThemeProvider>
          <PlanView />
        </ThemeProvider>,
      );
    });

    expect(mockMarkAutoPlanned).not.toHaveBeenCalled();

    act(() => settle());
    expect(mockMarkAutoPlanned).toHaveBeenCalledWith(mockToday);
  });

  it('leaves the day unmarked when the insert fails', async () => {
    // So tomorrow's launch — or this one, after a restart — tries again,
    // instead of the day being permanently marked done having done nothing.
    optimistic('reject');
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    const { rerender } = renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    act(() => settle());

    // The rollback: the rows go away again, which re-runs the effect. It must
    // not resubmit forever, and it must not mark the day.
    mockEntries = [];
    act(() => {
      rerender(
        <ThemeProvider>
          <PlanView />
        </ThemeProvider>,
      );
    });

    expect(mockMarkAutoPlanned).not.toHaveBeenCalled();
  });
});

describe('a chore created with "put it on today" ticked', () => {
  it('lands on the day once, not once per future occurrence', async () => {
    /*
     * Reported from the phone: *"I created a new chore called vacuum downstairs
     * and checked the Add to today's plan box, and it got added to my plan 3
     * times. I had to remove 2 of the instances."*
     *
     * The queue matches on chore id, and `view.upcoming` holds every future
     * occurrence of a recurring chore inside the horizon — so a weekly chore
     * queued today's occurrence and the next two. Each has a different
     * occurrence key, so neither the unique constraint nor the upsert could
     * collapse them: three real rows.
     */
    mockPlanOnCreate = [{ choreId: 'vacuum', queuedOn: mockToday }];
    mockView.mine = [item('vacuum')];
    mockView.upcoming = [
      { ...item('vacuum'), occurrenceKey: 'v1:vacuum:next', dueOn: civilDate('2026-09-08') },
      { ...item('vacuum'), occurrenceKey: 'v1:vacuum:later', dueOn: civilDate('2026-09-15') },
    ];
    mockChores = [recurring('vacuum')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());

    /*
     * Distinct keys, not call count. The auto-plan and the create-queue both
     * ask for today's occurrence, and that duplication is harmless — same user,
     * same key, same day, so the unique constraint and the upsert's
     * `ignoreDuplicates` collapse it into one row.
     *
     * Three *different* keys is what could not be collapsed, and what Jake had
     * to delete by hand.
     */
    expect([...new Set(addedKeys())]).toEqual(['v1:vacuum']);
  });

  it('takes the soonest occurrence when today has none', async () => {
    // A chore created for later still lands once — on its first occurrence,
    // not on every one the horizon can see.
    mockPlanOnCreate = [{ choreId: 'vacuum', queuedOn: mockToday }];
    mockView.upcoming = [
      { ...item('vacuum'), occurrenceKey: 'v1:vacuum:later', dueOn: civilDate('2026-09-15') },
      { ...item('vacuum'), occurrenceKey: 'v1:vacuum:next', dueOn: civilDate('2026-09-08') },
    ];
    mockChores = [recurring('vacuum')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(addedKeys()).toEqual(['v1:vacuum:next']);
  });
});

describe('two people sharing one household', () => {
  beforeEach(() => {
    mockAutoPlan = true;
  });

  const THEM = 'user-them';

  beforeEach(() => {
    mockMembers = [
      { userId: mockMe, displayName: 'Jake', accent: 'blue' },
      { userId: THEM, displayName: 'Emily', accent: 'pink' },
    ];
  });

  it('plans shared work onto both days, not whichever phone opened first', async () => {
    /*
     * This asserted the opposite until 2026-09-09: `anyone` work was claimed by
     * whichever device ran the auto-plan first, so the other person never saw
     * it. Jake: *"seems to be randomly distributing the 'Anyone can do' tasks
     * between us? They should all go to both of us, and if somebody's not going
     * to do them they can remove them from their plan."*
     *
     * "Randomly" was accurate — it depended on who opened Chorus first that
     * morning. The fixture holds the chore on the *other* person's day; it must
     * still land on yours.
     */
    mockEntries = [];
    mockAllEntries = [
      { occurrenceKey: 'v1:litter', choreId: 'litter', plannedFor: mockToday, position: 1 },
    ];
    mockView.mine = [item('litter'), item('bins')];
    mockChores = [recurring('litter'), recurring('bins')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    // Your own day specifically. Since the housemate's day is filled from here
    // too, an unscoped tally counts both plans and would pass on a build that
    // put everything on theirs and nothing on yours.
    const mine = mockAdd.mock.calls
      .filter((call) => call[2] === undefined)
      .flatMap((call) => (call[0] as { occurrenceKey: string }[]).map((i) => i.occurrenceKey));
    expect(mine.sort()).toEqual(['v1:bins', 'v1:litter']);
  });

  it('adds to the day the picker was opened for', async () => {
    /*
     * `useAddToPlan` is built per-day, and the mock now records which day. It
     * discarded its arguments before, so the instance for your housemate's day
     * and the one for yours were the same object and the owner was invisible.
     */
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    // Your own fill is the one with no owner argument. There is a housemate
    // fill too now, so this looks for the call rather than assuming the first.
    expect(mockAdd.mock.calls.some((call) => call[2] === undefined)).toBe(true);
  });
});

describe('what the morning proposal counts as urgent', () => {
  /*
   * `propose.ts` documents its `flagged` argument as "what either of you" has
   * flagged, and awards it 500 points — more than lateness. This file passed
   * `useMyFlags`, so a chore Emily flagged never got the boost on Jake's
   * proposal, and reverting the fix left all 686 tests green.
   *
   * Asserted on the argument rather than the rendered order. The bug was in
   * the *composition* — a correct ranking handed the wrong set — and the
   * proposal only reaches the screen when the plan is empty and nothing has
   * auto-planned, which is a lot of fixture standing between the defect and
   * the assertion.
   */
  it('hands the household’s flags to the ranking, not only yours', async () => {
    mockMyFlags = new Set(['dishes']);
    mockTheirFlags = new Set(['gutters']);
    mockView.mine = [item('dishes'), item('gutters')];
    mockChores = [recurring('dishes'), recurring('gutters')];
    renderView();

    await waitFor(() => expect(mockProposeDay).toHaveBeenCalled());

    const options = mockProposeDay.mock.calls.at(-1)?.[1] as { flagged: ReadonlySet<string> };
    expect([...options.flagged].sort()).toEqual(['dishes', 'gutters']);
  });
});

describe('the plan starts empty unless the household asked otherwise', () => {
  /*
   * Emily, twice: too much on the plan. Jake: *"I guess we should go back to
   * having the plan page just start empty and you have to add everything
   * manually ... If I added it to the plan I'm doing it."*
   *
   * The fixture is deliberately the exact one that fills the plan in the
   * describe above — `litter` due today, plus something long overdue. If the
   * setting were ignored these would be added, so the assertion cannot pass by
   * having nothing to add, which is the vacuous shape this repo keeps hitting.
   */
  const dueAndLate = () => {
    mockView.mine = [
      item('litter'),
      item('gutters', { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 }),
    ];
    mockChores = [recurring('litter'), recurring('gutters')];
  };

  it('adds what is due today and leaves the backlog alone', async () => {
    /*
     * Emily: *"autopopulate the flagged ones or the ones that are due that day
     * specifically."* The fixture is one of each — the litter is due today,
     * the gutters have been late since July — so the assertion separates
     * "today's work" from "everything outstanding", which is the distinction
     * the whole change rests on.
     */
    mockAutoPlan = false;
    dueAndLate();
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:litter']));
  });

  it('adds nothing at all when there is no work owed today', async () => {
    mockAutoPlan = false;
    mockView.mine = [
      item('gutters', { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 }),
    ];
    mockChores = [recurring('gutters')];
    renderView();

    /*
     * Waits for the screen to settle rather than asserting immediately, so a
     * late effect cannot sneak the rows in after the assertion has passed.
     *
     * Settles on the proposal, not on "Nothing planned yet." — with the plan
     * empty and work outstanding, the morning offer is what renders, and that
     * is the shape this change is meant to produce: asked, not filled.
     */
    await screen.findByText('Start the day');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('adds them when it is on', async () => {
    mockAutoPlan = true;
    dueAndLate();
    renderView();

    await waitFor(() => expect(addedKeys().sort()).toEqual(['v1:gutters', 'v1:litter']));
  });

  it('offers them behind a button instead, counting what it would add', async () => {
    mockAutoPlan = false;
    dueAndLate();
    /*
     * A third chore that is outstanding but *not* yet owed, so the count can
     * tell "due or late" apart from "everything on the list". Without it both
     * rules produce 2 and the label agrees with a button that would dump next
     * week onto today.
     */
    mockView.mine = [
      ...mockView.mine,
      item('filters', { status: 'due', dueOn: civilDate('2026-09-09') }),
    ];
    mockChores = [...mockChores, recurring('filters')];
    renderView();

    // The count is in the label because the reason the plan no longer fills
    // itself is that it got too big — being told it is two before you tap is
    // the point of the control.
    /*
     * Two, because this harness's `mockAdd` does not write back into
     * `mockEntries` — so the auto-fill's rows never become "planned" and the
     * count still sees both. In the app the litter would already be on the
     * plan and the button would read (1).
     *
     * Said plainly rather than tuned to a number that looks right: what this
     * pins is that the count is the due-or-late set minus what is planned, and
     * "what is planned" is exactly what the harness holds still.
     */
    const button = await screen.findByText('Add everything due or late (2)');
    fireEvent.press(button);

    /*
     * The press's own call, not the running total. The auto-fill has already
     * added the litter in this harness and `mockEntries` never learns about
     * it, so a cumulative assertion would see it twice — an artefact of the
     * fixture, not of the button.
     */
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(2));
    const pressed = mockAdd.mock.calls.at(-1)?.[0] as { occurrenceKey: string }[];
    expect(pressed.map((i) => i.occurrenceKey).sort()).toEqual(['v1:gutters', 'v1:litter']);
  });

  it('hides the button when there is nothing due or late', async () => {
    /*
     * A button that adds nothing is the dead-button shape this screen keeps
     * producing — offered, counted, and then doing nothing at all.
     *
     * `filters` is pulled forward by `showFrom` rather than absent, so the
     * plan is non-empty in the way that matters: there is outstanding work on
     * screen, it is simply not owed yet.
     */
    mockAutoPlan = false;
    mockView.mine = [item('filters', { status: 'due', dueOn: civilDate('2026-09-09') })];
    mockChores = [recurring('filters')];
    renderView();

    await screen.findByText('Start the day');
    expect(screen.queryByText(/Add everything due or late/)).toBeNull();
  });
});

describe('what the bulk-add button counts', () => {
  /*
   * Three properties the first version of these tests could not see, each
   * found by mutating the source and watching the suite stay green:
   *
   *  - every fixture used the default `assignee: { kind: 'anyone' }`, so
   *    widening the button from `view.mine` to the whole household changed
   *    nothing;
   *  - `mockEntries` was `[]` everywhere, so dropping the already-planned
   *    filter changed nothing;
   *  - `useHousehold` always resolved, so the wait-for-the-household guard
   *    could be inverted and nothing noticed.
   */
  it('leaves out work that is your housemate’s turn', async () => {
    mockAutoPlan = false;
    /*
     * `litter` is shared, so it sits in *both* sections — that is how "anyone"
     * work is projected, and it is what makes reading `theirs` as well as
     * `mine` produce a duplicate rather than merely extra work. Without it the
     * `belongsTo` filter alone neutralises the mistake and the assertion
     * cannot tell the two implementations apart.
     *
     * `gutters` is Emily's turn: adding it to Jake's day would reassign her
     * work with nothing on screen saying so.
     */
    // Both overdue, so neither fills itself in and the button is the only
    // thing adding anything — otherwise the auto-fill's rows would be mixed
    // into the assertion below.
    const late = { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 } as const;
    mockView.mine = [item('litter', late)];
    mockView.theirs = [
      item('litter', late),
      item('gutters', { ...late, assignee: { kind: 'member', memberId: mockThem, turn: 0 } }),
    ];
    mockChores = [recurring('litter'), recurring('gutters')];
    renderView();

    const button = await screen.findByText('Add everything due or late (1)');
    fireEvent.press(button);

    await waitFor(() => expect(addedKeys()).toEqual(['v1:litter']));
  });

  it('does not count what is already on your plan', async () => {
    mockAutoPlan = false;
    mockView.mine = [item('litter'), item('bins')];
    mockChores = [recurring('litter'), recurring('bins')];
    mockEntries = [
      { occurrenceKey: 'v1:bins', choreId: 'bins', plannedFor: mockToday, position: 0 },
    ];
    renderView();

    // One, not two: the bins are already spoken for. The plan is non-empty
    // here, so this also pins that the button is reachable in that state.
    await screen.findByText('Add everything due or late (1)');
  });

  it('offers nothing while the household setting is still loading', async () => {
    /*
     * The guard reads `household.data == null` rather than `?.autoPlan`, on
     * the grounds that treating "not read yet" as "off" would be right only by
     * luck. This is the test that makes that a guarantee rather than a comment:
     * with the household in flight, auto-fill must not run.
     */
    mockHouseholdLoading = true;
    mockAutoPlan = true;
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await screen.findByText('Start the day');
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('the bulk-add button waits for the plan', () => {
  /*
   * `entries` is empty until the plan query lands, so "what is already
   * planned" reads as nothing and the count would include work that is
   * already on today's plan — on a screen that, in that same window, is also
   * rendering the empty state. The number would be wrong in the one direction
   * that matters: too big.
   *
   * Pressing it could not have created duplicate rows, since the upsert
   * ignores conflicts. But the whole reason the count is in the label is to
   * say how large the commitment is before you accept it.
   */
  it('offers nothing while the plan query is still in flight', async () => {
    mockAutoPlan = false;
    mockEntriesLoading = true;
    mockView.mine = [item('litter'), item('bins')];
    mockChores = [recurring('litter'), recurring('bins')];
    renderView();

    await screen.findByText('Start the day');
    expect(screen.queryByText(/Add everything due or late/)).toBeNull();
  });
});

describe('flagged work lands by itself even when nothing else does', () => {
  /*
   * Jake: *"okay so if things are flagged they should still automatically
   * populate onto the plan but nothing else should."*
   *
   * Not an exception to "if I added it to the plan I'm doing it" — the
   * clearest case of it. Every other row auto-fill produced came from a
   * schedule nobody looked at this morning. A flag is a person deciding by
   * hand, and flags are shared, so it is also how Emily says it to Jake.
   */
  beforeEach(() => {
    mockAutoPlan = false;
  });

  /*
   * Late, not due today — which is now load-bearing rather than incidental.
   * Work due today fills the plan by itself, so a fixture of two chores due
   * today cannot show that *flagging* is what put one of them there. Both
   * being late means the flag is the only difference left.
   */
  const LATE = { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 } as const;

  it('adds the flagged one and leaves the rest alone', async () => {
    /*
     * Identical in every way except the flag, so the assertion cannot pass
     * against "add everything" — which is the rule it exists to rule out.
     */
    mockMyFlags = new Set(['gutters']);
    mockView.mine = [item('litter', LATE), item('gutters', LATE)];
    mockChores = [recurring('litter'), recurring('gutters')];
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:gutters']));
  });

  it('counts your housemate’s flag too', async () => {
    // Flags are shared: Emily flagging something is her telling Jake it needs
    // doing, and it would be a strange kind of shared if it reached only her
    // plan.
    mockTheirFlags = new Set(['gutters']);
    mockView.mine = [item('litter', LATE), item('gutters', LATE)];
    mockChores = [recurring('litter'), recurring('gutters')];
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:gutters']));
  });

  it('does not drag a flagged chore forward before it is owed', async () => {
    /*
     * A flag lasts until the work is done, so a chore flagged now and due in
     * three weeks would otherwise sit on every single day between here and
     * there — the wall of rows this whole change exists to remove. Flagging
     * pins it to the top of the plan on the day it is actually owed.
     */
    mockMyFlags = new Set(['filters']);
    mockView.mine = [item('filters', { status: 'due', dueOn: civilDate('2026-09-09') })];
    mockChores = [recurring('filters')];
    renderView();

    await screen.findByText('Start the day');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('adds a flagged chore that is late, not only one due today', async () => {
    mockMyFlags = new Set(['gutters']);
    mockView.mine = [
      item('gutters', { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 }),
    ];
    mockChores = [recurring('gutters')];
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:gutters']));
  });
});

describe('a flag raised after the morning fill has already run', () => {
  /*
   * The case the whole carve-out is for, and the one a day-level marker gets
   * wrong. `autoPlannedOn` is set the first time the effect runs — including
   * when it had nothing to add — and it used to short-circuit everything after
   * it. So a chore flagged at two in the afternoon, which is when flags
   * actually get raised, would not have reached the plan until tomorrow.
   */
  beforeEach(() => {
    mockAutoPlan = false;
    // The day has already been through the fill.
    mockAutoPlannedOn = mockToday;
  });

  it('still lands on the plan', async () => {
    mockMyFlags = new Set(['gutters']);
    mockView.mine = [item('litter'), item('gutters')];
    mockChores = [recurring('litter'), recurring('gutters')];
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:gutters']));
  });

  it('records the occurrence so taking it off sticks', async () => {
    /*
     * The other half. A flag lives until the work is done, so without a record
     * of what has already been auto-added, removing a flagged chore would hand
     * it straight back on the next render — a fight that would last all day.
     */
    mockMyFlags = new Set(['gutters']);
    mockView.mine = [item('gutters')];
    mockChores = [recurring('gutters')];
    renderView();

    // The record is written from `onSuccess`, the same place the day marker is
    // — a failed insert must not leave the occurrence looking handled.
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const options = mockAdd.mock.calls[0]?.[1] as { onSuccess: () => void };
    options.onSuccess();

    expect(mockMarkFlagsAutoPlanned).toHaveBeenCalledWith(mockToday, ['v1:gutters']);
  });

  it('does not add one it has already added today', async () => {
    mockMyFlags = new Set(['gutters']);
    mockAutoPlannedFlags = { on: mockToday, keys: ['v1:gutters'] };
    mockView.mine = [item('gutters')];
    mockChores = [recurring('gutters')];
    renderView();

    await screen.findByText('Start the day');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('ignores a record left over from yesterday', async () => {
    // The key carries its own date, so a stale record can never match — but
    // the day is compared anyway rather than relying on that.
    mockMyFlags = new Set(['gutters']);
    mockAutoPlannedFlags = { on: '2026-08-31', keys: ['v1:gutters'] };
    mockView.mine = [item('gutters')];
    mockChores = [recurring('gutters')];
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:gutters']));
  });
});

describe('the setting reaches the screen, not just the effect', () => {
  /*
   * `PlanScreen.test.tsx` pins the ternary that chooses the housemate's
   * empty-day sentence, but nothing pinned that the real value ever arrives:
   * hardcoding the prop to either constant left the whole suite green. That is
   * the `FormScroll` story from AGENTS.md — a correct component, a correct
   * screen, and a wire between them nobody checked.
   *
   * The sentence matters because with filling off it is a promise nothing can
   * keep: Jake would be told Emily's day fills itself when nothing will ever
   * put anything on it.
   */
  beforeEach(() => {
    mockMembers = [
      { userId: mockMe, displayName: 'Jake', accent: 'blue' },
      { userId: mockThem, displayName: 'Emily', accent: 'pink' },
    ];
  });

  it('does not promise a day that will never fill itself', async () => {
    mockAutoPlan = false;
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await screen.findByText(/You can put something on their day/);
    expect(screen.queryByText(/fills up when they open the app/)).toBeNull();
  });

  it('still promises it when the household has turned filling on', async () => {
    mockAutoPlan = true;
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await screen.findByText(/fills up when they open the app/);
  });
});

describe('flagging something already on your plan', () => {
  /*
   * `dueToday` excludes whatever is already planned, so this case wrote no
   * record at all: nothing to add, nothing remembered, and the first time you
   * took the chore off, the flagged path handed it straight back. The second
   * removal stuck, because the bounce-back finally wrote the record — "the
   * button did nothing, then worked", which is the worst kind.
   */
  it('records it as handled even though there is nothing to add', async () => {
    mockAutoPlan = false;
    mockMyFlags = new Set(['gutters']);
    mockView.mine = [item('gutters')];
    mockChores = [recurring('gutters')];
    mockEntries = [
      { occurrenceKey: 'v1:gutters', choreId: 'gutters', plannedFor: mockToday, position: 0 },
    ];
    renderView();

    await waitFor(() =>
      expect(mockMarkFlagsAutoPlanned).toHaveBeenCalledWith(mockToday, ['v1:gutters']),
    );
    // Nothing was added — it was already there. The record is the whole point.
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('does not write the record again once it is there', async () => {
    // `autoPlannedFlags` is a dependency of the effect, so re-recording a key
    // that is already recorded would re-run it forever.
    mockAutoPlan = false;
    mockMyFlags = new Set(['gutters']);
    mockAutoPlannedFlags = { on: mockToday, keys: ['v1:gutters'] };
    mockView.mine = [item('gutters')];
    mockChores = [recurring('gutters')];
    mockEntries = [
      { occurrenceKey: 'v1:gutters', choreId: 'gutters', plannedFor: mockToday, position: 0 },
    ];
    renderView();

    await screen.findByText(/Doing today|Done today/);
    expect(mockMarkFlagsAutoPlanned).not.toHaveBeenCalled();
  });

  it('records flagged work the whole-day fill carried, so removing it sticks', async () => {
    /*
     * With the setting on, the bulk fill adds the flagged chore as part of
     * everything else. If only the flagged branch's own list were recorded,
     * removing it afterwards would leave the flagged path free to re-add it —
     * and the two mechanisms would fight over the row for the rest of the day.
     */
    mockAutoPlan = true;
    mockMyFlags = new Set(['gutters']);
    mockView.mine = [item('litter'), item('gutters')];
    mockChores = [recurring('litter'), recurring('gutters')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const options = mockAdd.mock.calls[0]?.[1] as { onSuccess: () => void };
    options.onSuccess();

    expect(mockMarkFlagsAutoPlanned).toHaveBeenCalledWith(mockToday, ['v1:gutters']);
  });
});

describe('marking the day done when the setting is off', () => {
  /*
   * A review found that reverting either `firstRunToday` guard to
   * `wantsEverything && firstRunToday` passed the entire suite — every
   * assertion about `markAutoPlanned` lived in a describe with the setting on.
   *
   * The mutation is severe in exactly the configuration Jake and Emily run.
   * With the setting off and the day never marked, `firstRunToday` stays true
   * forever and the effect re-adds today's work on every render after you
   * remove it: "Take off today" becomes a button you fight all day.
   */
  beforeEach(() => {
    mockAutoPlan = false;
  });

  it('marks the day after filling it with today’s work', async () => {
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const options = mockAdd.mock.calls[0]?.[1] as { onSuccess: () => void };
    options.onSuccess();

    expect(mockMarkAutoPlanned).toHaveBeenCalledWith(mockToday);
  });

  it('marks it even on a day with nothing to add', async () => {
    /*
     * The branch that matters most: with nothing owed today the effect returns
     * early, and if it returned without marking, every later render would run
     * the whole fill again.
     */
    mockView.mine = [
      item('gutters', { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 }),
    ];
    mockChores = [recurring('gutters')];
    renderView();

    await waitFor(() => expect(mockMarkAutoPlanned).toHaveBeenCalledWith(mockToday));
  });

  it('does not mark it again once the day is already marked', async () => {
    mockAutoPlannedOn = mockToday;
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await screen.findByText(/Doing today|Start the day|Nothing planned yet/);
    expect(mockMarkAutoPlanned).not.toHaveBeenCalled();
  });
});

describe('whoever opens the app first fills both plans', () => {
  /*
   * Jake: *"I thought I asked to make it so that if either person opens the
   * app it goes ahead and auto populates both people's daily plan? Seems like
   * that still doesn't happen, if Emily hasn't opened the app today hers is
   * just empty."*
   *
   * He had. docs/DECISIONS.md recorded it as raised and undecided — the fill
   * ran on your device for your day, so a housemate who had not opened Chorus
   * had no plan at all, which is not a decision they made.
   */
  const addsFor = (ownerId: string | undefined) =>
    mockAdd.mock.calls
      .filter((call) => call[2] === ownerId)
      .flatMap((call) => (call[0] as { occurrenceKey: string }[]).map((i) => i.occurrenceKey));

  beforeEach(() => {
    mockMembers = [
      { userId: mockMe, displayName: 'Jake', accent: 'blue' },
      { userId: mockThem, displayName: 'Emily', accent: 'pink' },
    ];
  });

  it('plans the housemate’s day when they have not opened the app', async () => {
    /*
     * `litter` is shared and `bins` is her turn, and both have to land on her
     * day. The shared one is the trap: `buildTodayView` counts `anyone` work
     * as *yours*, so it lives in `view.mine` and never in `view.theirs` — a
     * fill sourced from `theirs` alone gave her the bins and none of the
     * shared chores, which is the category Jake named when he asked for this.
     */
    mockView.mine = [item('litter')];
    mockView.theirs = [item('bins', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } })];
    mockChores = [recurring('litter'), recurring('bins')];
    renderView();

    // Written against *their* id, which is the other half — `useAddToPlan`
    // falls back to you when given `undefined`, so the owner is an assertion.
    await waitFor(() => expect(addsFor(mockThem).sort()).toEqual(['v1:bins', 'v1:litter']));
    expect(addsFor(undefined)).toEqual(['v1:litter']);
  });

  it('does not plan work that is not theirs onto their day', async () => {
    /*
     * `autoPlannable` is asked about the housemate's id rather than trusting
     * `view.theirs` to be pre-filtered. Putting your turn on their plan is the
     * silent-reassignment defect this whole area exists to avoid.
     */
    mockView.theirs = [
      item('bins', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } }),
      item('mine', { assignee: { kind: 'member', memberId: mockMe, turn: 0 } }),
    ];
    mockChores = [recurring('bins'), recurring('mine')];
    renderView();

    await waitFor(() => expect(addsFor(mockThem)).toEqual(['v1:bins']));
  });

  it('leaves alone what is already on their day', async () => {
    // The second person's own run has to find the work planned and add
    // nothing, or opening the app twice would double every row.
    mockView.theirs = [item('bins', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } })];
    mockChores = [recurring('bins')];
    mockAllEntries = [
      {
        occurrenceKey: 'v1:bins',
        choreId: 'bins',
        plannedFor: mockToday,
        position: 0,
        userId: mockThem,
      },
    ] as never;
    renderView();

    await waitFor(() => expect(mockMarkTheirDayPlanned).toHaveBeenCalledWith(mockToday));
    expect(addsFor(mockThem)).toEqual([]);
  });

  it('leaves a day they have already curated alone', async () => {
    /*
     * The device-local marker is not enough on its own for a day that is not
     * yours. Emily opens at seven, her own fill runs, she takes the mopping
     * off at half past; Jake opens at nine for the first time today with a
     * null marker and the row gone from the cache. Without an emptiness test
     * he puts the mopping straight back.
     *
     * So this fills an *empty* day and never tops one up: one row left on her
     * plan is enough to say she has been here.
     */
    mockView.theirs = [
      item('bins', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } }),
      item('mop', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } }),
    ];
    mockChores = [recurring('bins'), recurring('mop')];
    mockAllEntries = [
      {
        occurrenceKey: 'v1:bins',
        choreId: 'bins',
        plannedFor: mockToday,
        position: 0,
        userId: mockThem,
      },
    ] as never;
    renderView();

    await waitFor(() => expect(mockMarkTheirDayPlanned).toHaveBeenCalledWith(mockToday));
    expect(addsFor(mockThem)).toEqual([]);
  });

  it('marks their day only once the write has landed', async () => {
    /*
     * The failure this repo has already had on the own-day fill: marking
     * before the write means a rejected insert leaves the day recorded as
     * planned and their plan empty, with nothing saying so. Reverting the
     * marker to before `mutate` passed the whole suite when this was written.
     */
    mockView.theirs = [item('bins', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } })];
    mockChores = [recurring('bins')];
    renderView();

    await waitFor(() => expect(addsFor(mockThem)).toEqual(['v1:bins']));
    expect(mockMarkTheirDayPlanned).not.toHaveBeenCalled();

    const call = mockAdd.mock.calls.find((c) => c[2] === mockThem);
    (call?.[1] as { onSuccess: () => void }).onSuccess();
    expect(mockMarkTheirDayPlanned).toHaveBeenCalledWith(mockToday);
  });

  it('does not fill their day twice while the first write is in flight', async () => {
    /*
     * `addForThem` is a fresh object every render and is a dependency, so the
     * effect re-evaluates constantly; the in-flight ref is the only thing
     * between that and a second identical write. Removing it passed the whole
     * suite when this was written, because the mocked mutation never feeds the
     * cache the effect reads.
     */
    mockView.theirs = [item('bins', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } })];
    mockChores = [recurring('bins')];
    const { rerender } = renderView();

    await waitFor(() => expect(addsFor(mockThem)).toEqual(['v1:bins']));
    const again = (
      <ThemeProvider>
        <PlanView />
      </ThemeProvider>
    );
    rerender(again);
    rerender(again);

    expect(addsFor(mockThem)).toEqual(['v1:bins']);
  });

  it('only fills their day once, so taking something off sticks', async () => {
    mockAutoPlannedTheirsOn = mockToday;
    mockView.theirs = [item('bins', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } })];
    mockChores = [recurring('bins')];
    renderView();

    await screen.findByText(/Doing today|Start the day|Nothing planned yet/);
    expect(addsFor(mockThem)).toEqual([]);
  });

  it('writes nobody’s day when there is no housemate', async () => {
    /*
     * `useAddToPlan(today, undefined)` falls back to *you*. A fill issued
     * before the member list lands — or in a one-person household — would put
     * the housemate's chores onto your own plan.
     */
    mockMembers = [{ userId: mockMe, displayName: 'Jake', accent: 'blue' }];
    mockView.theirs = [item('bins')];
    mockChores = [recurring('bins')];
    renderView();

    await screen.findByText(/Doing today|Start the day|Nothing planned yet/);
    expect(mockMarkTheirDayPlanned).not.toHaveBeenCalled();
    expect(addsFor(undefined)).toEqual([]);
  });
});
