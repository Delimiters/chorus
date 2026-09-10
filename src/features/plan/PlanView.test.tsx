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
  useRoutinePreference: () => ({ autoPlannedOn: mockAutoPlannedOn, todayMode: 'plan' }),
  useRoutineStore: (selector: (s: unknown) => unknown) =>
    selector({
      markAutoPlanned: mockMarkAutoPlanned,
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
  useMyFlags: () => mockMyFlags,
  useToggleFlag: () => ({ mutate: mockToggleFlag }),
}));

jest.mock('@/data/hooks/useCategories', () => ({ useCategoryList: () => [] }));
const mockScheduleToday = jest.fn();
jest.mock('@/data/hooks/useChores', () => ({
  useScheduleToday: () => ({ mutate: mockScheduleToday }),
}));
jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: { weekStartsOn: 1, timeZone: 'UTC' } }),
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
  mockView = { mine: [], theirs: [], done: [], skipped: [], upcoming: [], floating: [] };
  mockChores = [];
  mockEntries = [];
  mockAllEntries = null;
  mockMembers = [{ userId: mockMe, displayName: 'Jake', accent: 'blue' }];
  mockIsLoading = false;
  mockEntriesLoading = false;
  mockAutoPlannedOn = null;
  mockPlanOnCreate = [];
  mockHorizon = [];
  mockScheduleToday.mockClear();
});

describe('recurring chores that are due today or late', () => {
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
    expect(addedKeys().sort()).toEqual(['v1:bins', 'v1:litter']);
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
    // The auto-plan is always your own day.
    expect(mockAdd.mock.calls[0]?.[2]).toBeUndefined();
  });
});
