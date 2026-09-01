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

import { render, waitFor } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ThemeProvider } from '@/design/theme';
import { PlanView } from './PlanView';

const mockMe = 'user-me';
const mockThem = 'user-them';
const mockToday = civilDate('2026-09-01');

const mockAdd = jest.fn();
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
let mockEntriesLoading = false;
let mockAutoPlannedOn: string | null = null;
let mockPlanOnCreate: string[] = [];

jest.mock('@/data/hooks/useOccurrences', () => ({
  useToday_View: () => ({
    view: mockView,
    chores: mockChores,
    today: mockToday,
    isLoading: mockIsLoading,
    error: null,
    refetch: async () => {},
  }),
  useOccurrences: () => ({ agenda: [], isLoading: false }),
  quantiseWindow: () => ({ start: mockToday, end: mockToday }),
  useToggleCompletion: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/data/hooks/usePlan', () => ({
  useMyPlanEntries: () => mockEntries,
  usePlanLoading: () => mockEntriesLoading,
  useTheirPlanCount: () => 0,
  useTheirPlanTotal: () => 0,
  useRemoveFromPlan: () => ({ mutate: jest.fn() }),
  useAddToPlan: () => ({ mutate: mockAdd }),
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

jest.mock('@/data/hooks/useCategories', () => ({ useCategoryList: () => [] }));
jest.mock('@/data/hooks/useFlags', () => ({ useMyFlags: () => new Set<string>() }));
jest.mock('@/data/hooks/useChores', () => ({ useScheduleToday: () => ({ mutate: jest.fn() }) }));
jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: { weekStartsOn: 1, timeZone: 'UTC' } }),
  useMembers: () => ({ data: [{ userId: mockMe, displayName: 'Jake', accent: 'blue' }] }),
}));
jest.mock('@/stores/sessionStore', () => ({ useUserId: () => mockMe }));
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
  mockIsLoading = false;
  mockEntriesLoading = false;
  mockAutoPlannedOn = null;
  mockPlanOnCreate = [];
});

describe('recurring chores that are due today', () => {
  it('go on the plan by themselves', async () => {
    mockView.mine = [item('litter')];
    mockChores = [recurring('litter')];
    renderView();

    await waitFor(() => expect(addedKeys()).toEqual(['v1:litter']));
  });

  it('does not drag the whole overdue backlog in with them', async () => {
    /*
     * The defect a review caught. `view.mine` is everything *outstanding* —
     * work fifty-nine days late, and anything `showFrom` has pulled forward,
     * which on this household is thirty-two of about fifty rows. Auto-adding
     * that is the wall of twenty again wearing the plan's clothes, and it
     * leaves the proposal with nothing left to rank.
     */
    mockView.mine = [
      item('litter'),
      item('gutters', { status: 'overdue', dueOn: civilDate('2026-07-04'), daysOverdue: 59 }),
    ];
    mockChores = [recurring('litter'), recurring('gutters')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(addedKeys()).toEqual(['v1:litter']);
  });

  it('leaves one-off work to be chosen', async () => {
    // The whole argument for "proposed, not pre-filled" was about one-off work.
    mockView.mine = [item('litter'), item('timesheet')];
    mockChores = [recurring('litter'), oneOff('timesheet')];
    renderView();

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(addedKeys()).toEqual(['v1:litter']);
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
    mockPlanOnCreate = ['newchore'];
    mockView.mine = [item('newchore')];
    mockChores = [oneOff('newchore')];
    renderView();

    await waitFor(() => expect(addedKeys()).toContain('v1:newchore'));
    expect(mockClearPlanOnCreate).toHaveBeenCalledWith(['newchore']);
  });

  it('never puts your housemate’s work on your plan', async () => {
    /*
     * `useAddToPlan` writes `user_id = me`, so pulling from `theirs` silently
     * reassigned work — create a chore for Emily with the switch on and it
     * landed on Jake's plan. The proposal refuses to do this thirty lines up;
     * this used to do it with no guard and no comment.
     */
    mockPlanOnCreate = ['hers'];
    mockView.theirs = [item('hers', { assignee: { kind: 'member', memberId: mockThem, turn: 0 } })];
    mockChores = [oneOff('hers')];
    renderView();

    await waitFor(() => expect(mockClearPlanOnCreate).toHaveBeenCalled());
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('clears the queue even when nothing matched', async () => {
    // A chore scheduled for next month has no occurrence today. Left queued, it
    // would ambush somebody on a later morning.
    mockPlanOnCreate = ['later'];
    mockChores = [oneOff('later')];
    renderView();

    await waitFor(() => expect(mockClearPlanOnCreate).toHaveBeenCalledWith(['later']));
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
