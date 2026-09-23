/**
 * The optimistic completion patch, against a real QueryClient.
 *
 * This file exists because the first version of `onMutate` patched every query
 * under the household key and discriminated with `Array.isArray` — which is not
 * the discriminator it looks like. `members` is an array under that prefix too.
 * Twenty lines of test would have caught it; there were none, so it took driving
 * the app to find. These assert what the patch must *not* touch, which is the
 * part no screen test would have noticed until it threw.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { CivilDate } from '@/core/civil/types';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { qk } from '../queryKeys';
import { quantiseWindow, useToday_View, useToggleCompletion } from './useOccurrences';

const HOUSEHOLD = 'house-1';
const ME = 'user-me';
const mockToday = '2026-07-30' as CivilDate;

const mockComplete = jest.fn(async () => {});
/*
 * The turn-override fetch, which this factory used to omit entirely — so the
 * queryFn threw a TypeError, react-query swallowed it, `?? []` hid it, and the
 * suite passed while the feature was inert.
 */
let mockTurns: { occurrenceKey: string; userId: string }[] = [];
let mockRoster: { userId: string; displayName: string }[] = [];
const mockListChores = jest.fn(async () => ({ chores: [], unreadable: [] }));
const mockListTurns = jest.fn(async () => mockTurns);
const mockUncomplete = jest.fn(async () => {});

jest.mock('../api/chores', () => ({
  completeOccurrence: (...args: unknown[]) => mockComplete(...(args as [])),
  uncompleteOccurrence: (...args: unknown[]) => mockUncomplete(...(args as [])),
  skipOccurrence: jest.fn(),
  rescheduleOccurrence: jest.fn(),
  listChores: (...args: unknown[]) => mockListChores(...(args as [])),
  listCompletions: jest.fn(),
  listCompletionsForChores: jest.fn(),
  listExceptions: jest.fn(),
  listOneTimeChores: jest.fn(),
  listTurnOverrides: (...args: unknown[]) => mockListTurns(...(args as [])),
  setTurnOverride: jest.fn(),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'user-me',
}));

jest.mock('./useHousehold', () => ({
  useHousehold: () => ({ data: { timeZone: 'UTC', weekStartsOn: 0 } }),
  // `isLoading` included because the real hook is a query and `useOccurrences`
  // now reads it — a mock missing it made the whole `||` chain `undefined`.
  // `isLoading` included because the real hook is a query and `useOccurrences`
  // now reads it — a mock missing it made the whole `||` chain `undefined`.
  // The roster is mutable because the projector drops an override naming
  // somebody who is not on it, so a test about overrides needs real members.
  useMembers: () => ({ data: mockRoster, isLoading: false }),
}));

jest.mock('../today', () => ({ useToday: () => '2026-07-30' }));

const item = {
  choreId: 'dishes',
  occurrenceKey: 'v1:dishes:2026-07-30:0:-',
  dueOn: mockToday,
  status: 'due',
} as unknown as AgendaItem;

const MEMBERS = [{ userId: ME, displayName: 'Jake', accent: 'blue', role: 'owner', sortOrder: 0 }];
const EXCEPTIONS = [
  {
    choreId: 'dishes',
    occurrenceKey: item.occurrenceKey,
    kind: 'reschedule',
    movedTo: '2026-08-02' as CivilDate,
  },
];

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const window = quantiseWindow(mockToday, 0, 2, 1);

  client.setQueryData(qk.members(HOUSEHOLD), MEMBERS);
  client.setQueryData(qk.exceptions(HOUSEHOLD, window.start, window.end), EXCEPTIONS);
  client.setQueryData(qk.completions(HOUSEHOLD, window.start, window.end), []);

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, window, wrapper };
}

beforeEach(() => {
  mockComplete.mockClear();
  mockUncomplete.mockClear();
});

describe('optimistic completion', () => {
  it('adds the completion to every completions window before the server answers', async () => {
    const { client, window, wrapper } = setup();
    const { result } = await renderHook(() => useToggleCompletion(), { wrapper });

    await act(async () => {
      result.current.mutate({ item, complete: true });
    });

    await waitFor(() => {
      const completions = client.getQueryData(qk.completions(HOUSEHOLD, window.start, window.end));
      expect(completions).toEqual([
        {
          choreId: 'dishes',
          occurrenceKey: item.occurrenceKey,
          completedOn: mockToday,
          completedBy: ME,
        },
      ]);
    });
  });

  it('leaves the member list alone, even though it is also an array under the household key', async () => {
    const { client, wrapper } = setup();
    const { result } = await renderHook(() => useToggleCompletion(), { wrapper });

    await act(async () => {
      result.current.mutate({ item, complete: true });
    });

    // Patching the household prefix appended a completion row here, and the
    // House tab then read `displayName` off it and threw mid-render.
    expect(client.getQueryData(qk.members(HOUSEHOLD))).toEqual(MEMBERS);
  });

  it('does not delete the exception for the occurrence being completed', async () => {
    const { client, window, wrapper } = setup();
    const { result } = await renderHook(() => useToggleCompletion(), { wrapper });

    await act(async () => {
      result.current.mutate({ item, complete: true });
    });

    // The reschedule survives; otherwise ticking a moved chore snapped it back
    // to its original date until the refetch landed.
    expect(client.getQueryData(qk.exceptions(HOUSEHOLD, window.start, window.end))).toEqual(
      EXCEPTIONS,
    );
  });

  it('removes the completion again when un-ticked', async () => {
    const { client, window, wrapper } = setup();
    const { result } = await renderHook(() => useToggleCompletion(), { wrapper });

    await act(async () => {
      result.current.mutate({ item, complete: true });
    });
    await act(async () => {
      result.current.mutate({ item, complete: false });
    });

    await waitFor(() => {
      expect(client.getQueryData(qk.completions(HOUSEHOLD, window.start, window.end))).toEqual([]);
    });
    expect(mockUncomplete).toHaveBeenCalledWith('dishes', item.occurrenceKey);
  });

  it('rolls the patch back when the write fails', async () => {
    mockComplete.mockRejectedValueOnce(new Error('offline'));
    const { client, window, wrapper } = setup();
    const { result } = await renderHook(() => useToggleCompletion(), { wrapper });

    await act(async () => {
      result.current.mutate({ item, complete: true });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(qk.completions(HOUSEHOLD, window.start, window.end))).toEqual([]);
  });
});

describe('quantiseWindow', () => {
  it('snaps to week boundaries so the query key does not churn daily', () => {
    // Every day of the same week must produce the same window, or the key
    // changes on every render and the app refetches in a loop.
    const monday = quantiseWindow('2026-07-27' as CivilDate, 0, 2, 1);
    const friday = quantiseWindow('2026-07-31' as CivilDate, 0, 2, 1);
    expect(friday).toEqual(monday);
  });

  it('moves once the week does', () => {
    const thisWeek = quantiseWindow('2026-07-30' as CivilDate, 0, 2, 1);
    const nextWeek = quantiseWindow('2026-08-06' as CivilDate, 0, 2, 1);
    expect(nextWeek.start).not.toEqual(thisWeek.start);
  });

  it('honours the household week start', () => {
    const sunday = quantiseWindow('2026-07-30' as CivilDate, 0, 2, 1);
    const monday = quantiseWindow('2026-07-30' as CivilDate, 1, 2, 1);
    expect(sunday.start).not.toEqual(monday.start);
  });

  it('covers the requested number of weeks either side of today', () => {
    const { start, end } = quantiseWindow(mockToday, 0, 2, 1);
    expect(start).toBe('2026-07-12'); // two weeks before the 26th
    expect(end).toBe('2026-08-01'); // end of the current week
  });
});

describe('turn overrides reaching the projector', () => {
  /*
   * A review found that deleting `turns: turnsQuery.data ?? []` from
   * `useOccurrences` left the entire repo green: the engine tests pass
   * overrides straight to `projectOccurrences`, and every screen test mocks
   * this hook wholesale. Correct pure function, correct screen, no wire —
   * the shape AGENTS.md names.
   */
  const THEM = 'user-them';

  beforeEach(() => {
    mockTurns = [];
    mockListTurns.mockClear();
    mockRoster = [
      { userId: ME, displayName: 'Jake' },
      { userId: THEM, displayName: 'Sam' },
    ];
    // A daily chore that is Sam's, so an override to Jake is visible as a
    // change rather than agreeing with the rotation by accident.
    mockListChores.mockResolvedValue({
      chores: [
        {
          id: 'dishes',
          title: 'Dishes',
          schedule: {
            rule: { kind: 'daily', everyNDays: 1 },
            startsOn: '2026-07-01' as CivilDate,
            endsOn: null,
            timesOfDay: [],
          },
          assignment: { kind: 'fixed', memberId: THEM },
          archived: false,
        },
      ],
      unreadable: [],
    } as never);
  });

  it('asks for them', async () => {
    const { wrapper } = setup();
    renderHook(() => useToday_View(), { wrapper });

    await waitFor(() => expect(mockListTurns).toHaveBeenCalledWith(HOUSEHOLD));
  });

  it('hands them to the projection, so an override changes whose turn it is', async () => {
    mockTurns = [{ occurrenceKey: item.occurrenceKey, userId: ME }];
    const { wrapper } = setup();

    const { result } = renderHook(() => useToday_View(), { wrapper });

    await waitFor(() => expect(result.current?.isLoading).toBe(false));
    const found = [...result.current.view.mine, ...result.current.view.theirs].find(
      (i) => i.occurrenceKey === item.occurrenceKey,
    );
    expect(found?.assignee).toEqual({ kind: 'member', memberId: ME, turn: 0 });
  });

  it('waits for them rather than painting the rotation first', async () => {
    /*
     * `PlanView` does not merely render this answer, it writes plan rows from
     * it — so a turns fetch that has not landed would plan a chore Emily took
     * onto Jake's day and persist it.
     */
    const { wrapper } = setup();
    let resolve: (v: { occurrenceKey: string; userId: string }[]) => void = () => {};
    mockListTurns.mockImplementationOnce(
      () => new Promise<{ occurrenceKey: string; userId: string }[]>((r) => (resolve = r)),
    );

    const { result } = renderHook(() => useToday_View(), { wrapper });

    /*
     * Let every *other* query settle first. Asserting `isLoading` on the first
     * render proves nothing — the chores fetch is outstanding too, so it would
     * pass with the turns query left out of the gate entirely. Measured: that
     * is exactly what the first version of this test did.
     */
    await waitFor(() => expect(result.current?.chores.length).toBeGreaterThan(0));
    expect(result.current?.isLoading).toBe(true);

    await act(async () => {
      resolve([]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
