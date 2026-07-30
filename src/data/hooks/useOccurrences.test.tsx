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
import { quantiseWindow, useToggleCompletion } from './useOccurrences';

const HOUSEHOLD = 'house-1';
const ME = 'user-me';
const mockToday = '2026-07-30' as CivilDate;

const mockComplete = jest.fn(async () => {});
const mockUncomplete = jest.fn(async () => {});

jest.mock('../api/chores', () => ({
  completeOccurrence: (...args: unknown[]) => mockComplete(...(args as [])),
  uncompleteOccurrence: (...args: unknown[]) => mockUncomplete(...(args as [])),
  skipOccurrence: jest.fn(),
  rescheduleOccurrence: jest.fn(),
  listChores: jest.fn(),
  listCompletions: jest.fn(),
  listCompletionsForChores: jest.fn(),
  listExceptions: jest.fn(),
  listOneTimeChores: jest.fn(),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'user-me',
}));

jest.mock('./useHousehold', () => ({
  useHousehold: () => ({ data: { timeZone: 'UTC', weekStartsOn: 0 } }),
  useMembers: () => ({ data: [] }),
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
