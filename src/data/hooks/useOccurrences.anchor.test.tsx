/**
 * The re-anchoring reaching the screen, which is the half that was missing.
 *
 * `anchorToCompletion` was made window-independent and unit-tested as such —
 * and then handed a completions list the caller had already filtered by
 * `due_on` to the very window whose influence the fix removed. The pure
 * function was right, every engine test passed, and the app behaved exactly as
 * it had before: the same chore showed different due dates on Today, on Stats
 * and in the reminder planner, and the re-anchor *expired* once the completion
 * aged out of the two-week lookback.
 *
 * So this test deliberately supplies the completion **only** through the
 * unbounded per-chore fetch. If the hook goes back to reading the windowed
 * query alone, the dates snap onto the fixed grid and this fails.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { CivilDate } from '@/core/civil/types';
import { useOccurrences } from './useOccurrences';

const d = (s: string) => s as CivilDate;

/** Every 10 days from 5 August. On the plain grid: … 09-14, 09-24, 10-04. */
const mockChore = {
  id: 'plants',
  title: 'Water the plants',
  schedule: {
    rule: { kind: 'daily', everyNDays: 10 },
    startsOn: d('2026-08-05'),
    endsOn: null,
    timesOfDay: [],
  },
  assignment: { kind: 'anyone' },
  archived: false,
};

/*
 * Due 4 September, done five days late on the 9th. Both dates are outside the
 * window below, which is the point — this is what a completion looks like a
 * fortnight later, and it still sets the phase of the series.
 */
const mockOldCompletion = {
  choreId: 'plants',
  occurrenceKey: 'v1:plants:2026-09-04:0:-',
  completedOn: d('2026-09-09'),
  completedBy: 'user-me',
};

const mockListCompletionsForChores: jest.Mock = jest.fn(async () => [mockOldCompletion]);

jest.mock('../api/chores', () => ({
  listChores: jest.fn(async () => ({ chores: [mockChore], unreadable: [] })),
  // Windowed, and therefore empty: the completion's `due_on` is a fortnight
  // behind the start of this window.
  listCompletions: jest.fn(async () => []),
  listCompletionsForChores: (...args: unknown[]) => mockListCompletionsForChores(...(args as [])),
  listExceptions: jest.fn(async () => []),
  listExceptionsForChores: jest.fn(async () => []),
  listOneTimeChores: jest.fn(async () => ({ chores: [], unreadable: [] })),
  completeOccurrence: jest.fn(),
  uncompleteOccurrence: jest.fn(),
  skipOccurrence: jest.fn(),
  rescheduleOccurrence: jest.fn(),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'user-me',
}));

jest.mock('./useHousehold', () => ({
  useHousehold: () => ({ data: { timeZone: 'UTC', weekStartsOn: 1 } }),
  useMembers: () => ({ data: [{ userId: 'user-me' }] }),
}));

jest.mock('../today', () => ({ useToday: () => '2026-09-28' }));

function renderOccurrences() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useOccurrences({ start: d('2026-09-14'), end: d('2026-10-04') }), {
    wrapper,
  });
}

describe('when the unbounded fetch fails', () => {
  it('says so rather than quietly showing the fixed grid', async () => {
    /*
     * The failure mode this query was added to remove, arriving through the
     * back door. If the fetch fails and nothing reports it, every interval
     * chore silently reverts to the grid — dates the chore had rightly been
     * skipping reappear as overdue, `refetch` has nothing to signal, and the
     * reminder planner, which reads the same `items`, schedules notifications
     * for occurrences Today does not show.
     */
    mockListCompletionsForChores.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderOccurrences();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('offline');
  });
});

describe('an interval chore completed before the window', () => {
  it('is still anchored to that completion', async () => {
    const { result } = renderOccurrences();
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));

    const dates = result.current.items.map((o) => o.dueOn);

    // Ten days after it was done, not ten days after a grid date nobody met.
    expect(dates).toContain(d('2026-09-19'));
    expect(dates).toContain(d('2026-09-29'));
    // The fixed-grid dates the chore has been rightly skipping. Their return is
    // the user-visible symptom: two chores reappearing as overdue, a fortnight
    // after the tick that should have cleared them.
    expect(dates).not.toContain(d('2026-09-24'));
    expect(dates).not.toContain(d('2026-09-14'));
  });

  it('asks for that chore\u2019s completions without a date bound', async () => {
    const { result } = renderOccurrences();
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));

    // Only interval chores need this; a calendar rule ignores completions, and
    // fetching every tick for every chore would be a table scan per render.
    expect(mockListCompletionsForChores).toHaveBeenCalledWith('house-1', ['plants']);
  });
});
