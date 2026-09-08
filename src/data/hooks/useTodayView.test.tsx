/**
 * Does a chore dated beyond Today's window actually reach the screen?
 *
 * `showFrom` decides whether an occurrence counts as due. It cannot decide
 * whether the occurrence is *fetched*, and Today's window is about three weeks
 * wide — so twenty-one chores due at the end of the month were invisible while
 * being, by the engine's reckoning, due today.
 *
 * This runs `useToday_View` itself rather than replaying the ranges it uses.
 * The first version of this test replayed them, and survived deleting the
 * forward projection entirely: it was testing the engine, which was never
 * wrong, instead of the composition, which was.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { civilDate } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import { useToday_View } from './useOccurrences';

const TODAY = '2026-08-17';
/*
 * Genuinely outside the projection window, which is now six weeks forward
 * rather than one — widened so the thirty-day horizon fits inside it. A date
 * that used to be nine days past the end is comfortably inside it today, and
 * would have made these assertions about the ordinary path instead of this
 * hook's.
 */
const DUE = '2026-11-30';

const oneTimeChore = (showFrom?: string) => ({
  id: 'patio',
  title: 'Set up new patio set',
  notes: null,
  schedule: {
    rule: {
      kind: 'once',
      dueOn: DUE as CivilDate,
      granularity: 'month',
      ...(showFrom === undefined ? {} : { showFrom: showFrom as CivilDate }),
    },
    startsOn: DUE as CivilDate,
    endsOn: null,
    timesOfDay: [],
  },
  assignment: { kind: 'anyone' },
  archived: false,
  archivedAt: null,
  categoryId: null,
  priority: 'normal',
  icon: null,
  privateTo: null,
  createdAt: null,
  createdBy: null,
});

let mockOneTime: ReturnType<typeof oneTimeChore>[] = [];
const mockListOneTime = jest.fn(async () => ({ chores: mockOneTime, unreadable: [] }));

jest.mock('../api/chores', () => ({
  listChores: jest.fn(async () => ({ chores: [], unreadable: [] })),
  listOneTimeChores: (...a: unknown[]) => mockListOneTime(...(a as [])),
  listCompletions: jest.fn(async () => []),
  listCompletionsForChores: jest.fn(async () => []),
  listExceptions: jest.fn(async () => []),
  listExceptionsForChores: jest.fn(async () => []),
  completeOccurrence: jest.fn(),
  uncompleteOccurrence: jest.fn(),
  skipOccurrence: jest.fn(),
  rescheduleOccurrence: jest.fn(),
  clearException: jest.fn(),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'user-me',
}));

jest.mock('./useHousehold', () => ({
  useHousehold: () => ({ data: { timeZone: 'UTC', weekStartsOn: 0 } }),
  useMembers: () => ({ data: [{ userId: 'user-me', displayName: 'Jake', accent: 'blue' }] }),
}));

jest.mock('../today', () => ({ useToday: () => '2026-08-17' }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

/** Rendered once; the queries settle across re-renders of that same hook. */
const renderToday = () => renderHook(() => useToday_View(), { wrapper });

describe('a one-time chore due beyond the window Today projects', () => {
  /*
   * These asserted that `showFrom` pulled such a chore onto Today early, which
   * was the only way it could appear before its date. That field is gone, and
   * the window is six weeks wide, so everything inside the thirty-day horizon
   * arrives by the ordinary path.
   *
   * What still has to hold here is that a chore beyond the window is *fetched
   * at all* — it was invisible on every screen, which is the complaint this
   * hook was written for. It now feeds the "All" scope rather than Today's
   * outstanding list.
   */
  it('is fetched and upcoming, rather than missing', async () => {
    mockOneTime = [oneTimeChore()];
    const { result } = renderToday();

    await waitFor(
      () => {
        expect(result.current.view.upcoming.map((i) => i.choreTitle)).toContain(
          'Set up new patio set',
        );
      },
      { timeout: 5000 },
    );
  });

  it('is not counted as work to do now', async () => {
    // The rule that keeps the outstanding list a list of things to do.
    mockOneTime = [oneTimeChore()];
    const { result } = renderToday();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.view.mine).toEqual([]);
  });

  it('behaves identically whether or not it carries an old showFrom', async () => {
    /*
     * Forty-five stored chores still have one. The field is inert, not merely
     * unused in the default case — same chore, same answer, with and without.
     */
    mockOneTime = [oneTimeChore(TODAY)];
    const { result } = renderToday();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.view.mine).toEqual([]);
    expect(result.current.view.upcoming.map((i) => i.choreTitle)).toContain('Set up new patio set');
  });

  it('is genuinely outside the window, or this proves nothing', () => {
    // Six weeks from the start of the week containing 2026-08-17.
    expect(civilDate(DUE) > civilDate('2026-09-26')).toBe(true);
  });
});
