/**
 * The plan mutations, against a real QueryClient.
 *
 * The harness in `useFlags.test.tsx` exists because a hook that decided what to
 * write by reading a cache `onMutate` had already changed wrote its own inverse
 * on every call. This file exists because the same trap was reintroduced here,
 * one PR later, in a hook written the same afternoon — positions were computed
 * inside `mutationFn`, so every add counted its own optimistic rows and the
 * number the user saw was never the number stored.
 *
 * These assert the **write**. The optimistic cache was correct in both bugs,
 * which is exactly why neither was visible on screen.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { civilDate } from '@/core/civil/date';
import { qk } from '../queryKeys';
import type { PlanEntryRow } from '../api/plan';

const HOUSE = 'house-1';
const ME = 'user-me';
const THEM = 'user-them';
const TODAY = civilDate('2026-08-27');
const FROM = civilDate('2026-08-19'); // today − PLAN_LOOKBACK_DAYS

interface Written {
  readonly occurrenceKey: string;
  readonly position: number;
  readonly plannedFor: string;
}

const mockWrites: Written[] = [];
const mockDeletes: { occurrenceKey: string; userId: string }[] = [];

/**
 * A server that remembers.
 *
 * `onSettled` invalidates, so a `listPlanEntries` that always returned `[]`
 * would wipe the optimistic rows and turn any assertion about the settled cache
 * into a test of the mock.
 */
let mockServer: PlanEntryRow[] = [];

jest.mock('../api/plan', () => ({
  listPlanEntries: jest.fn(async () => mockServer),
  addToPlan: jest.fn(
    async (entries: readonly (Written & { userId: string; choreId: string })[]) => {
      for (const entry of entries) {
        mockWrites.push(entry);
        mockServer = [
          ...mockServer,
          {
            id: `db:${entry.occurrenceKey}`,
            userId: entry.userId,
            choreId: entry.choreId,
            occurrenceKey: entry.occurrenceKey,
            plannedFor: entry.plannedFor as PlanEntryRow['plannedFor'],
            position: entry.position,
          },
        ];
      }
    },
  ),
  removeFromPlan: jest.fn(async (userId: string, occurrenceKey: string) => {
    mockDeletes.push({ userId, occurrenceKey });
    mockServer = mockServer.filter(
      (r) => !(r.userId === userId && r.occurrenceKey === occurrenceKey),
    );
  }),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => HOUSE,
  useUserId: () => ME,
}));

// eslint-disable-next-line import/first
import { useAddToPlan, useRemoveFromPlan } from './usePlan';

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const row = (
  occurrenceKey: string,
  position: number,
  userId = ME,
  plannedFor = TODAY,
): PlanEntryRow => ({
  id: `db:${occurrenceKey}`,
  userId,
  choreId: occurrenceKey.replace('v1:', ''),
  occurrenceKey,
  plannedFor,
  position,
});

const seed = (client: QueryClient, rows: PlanEntryRow[]) => {
  mockServer = [...rows];
  client.setQueryData(qk.plan(HOUSE, FROM, TODAY), rows);
};

beforeEach(() => {
  mockWrites.length = 0;
  mockDeletes.length = 0;
  mockServer = [];
});

describe('adding to the plan writes the positions it shows', () => {
  it('starts at one on an empty day', async () => {
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:a', choreId: 'a' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.position).toBe(1);
  });

  it('does not count its own optimistic rows', async () => {
    /*
     * The defect. With positions computed inside `mutationFn`, which runs after
     * `onMutate`, adding two items on top of one existing row wrote 6 and 7
     * while the screen showed 4 and 5 — the add double-counted itself.
     */
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 3)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() =>
      result.current.mutate([
        { occurrenceKey: 'v1:b', choreId: 'b' },
        { occurrenceKey: 'v1:c', choreId: 'c' },
      ]),
    );

    await waitFor(() => expect(mockWrites).toHaveLength(2));
    expect(mockWrites.map((w) => w.position)).toEqual([4, 5]);
  });

  it('agrees with what it put in the cache', async () => {
    // The two numbers must be the same number. They were not.
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 3)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:b', choreId: 'b' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    await waitFor(() => {
      const cached =
        client.getQueryData<readonly PlanEntryRow[]>(qk.plan(HOUSE, FROM, TODAY)) ?? [];
      const settled = cached.find((r) => r.occurrenceKey === 'v1:b');
      expect(settled?.position).toBe(mockWrites[0]?.position);
    });
  });

  it('ignores the other person when finding the end of my day', async () => {
    /*
     * `nextPosition` ran over every row in the household under a variable named
     * `mine`, so a housemate with a long day pushed my first item to position
     * 52. Harmless to order, wrong on its face, and the name is how it survived.
     */
    const { client, wrapper } = harness();
    seed(client, [row('v1:theirs', 50, THEM)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:mine', choreId: 'mine' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.position).toBe(1);
  });

  it('ignores another day when finding the end of this one', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:yesterday', 90, ME, civilDate('2026-08-26'))]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:a', choreId: 'a' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.position).toBe(1);
  });

  it('does not write something already planned today', async () => {
    // The unique index makes it a no-op anyway; not writing it keeps the
    // optimistic list from briefly showing a duplicate that the refetch then
    // removes, which reads as a dropped tap.
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() =>
      result.current.mutate([
        { occurrenceKey: 'v1:a', choreId: 'a' },
        { occurrenceKey: 'v1:b', choreId: 'b' },
      ]),
    );

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.occurrenceKey).toBe('v1:b');
  });

  it('always plans for today, never for the day a row came from', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:old', 1, ME, civilDate('2026-08-20'))]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:old', choreId: 'old' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.plannedFor).toBe(TODAY);
  });
});

describe('taking something off the plan', () => {
  it('deletes only my own entry', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1), row('v1:a', 1, THEM)]);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate('v1:a'));

    await waitFor(() => expect(mockDeletes).toHaveLength(1));
    expect(mockDeletes[0]).toEqual({ userId: ME, occurrenceKey: 'v1:a' });
  });

  it('leaves my housemate’s copy in the cache', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1), row('v1:a', 1, THEM)]);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate('v1:a'));

    await waitFor(() => {
      const cached =
        client.getQueryData<readonly PlanEntryRow[]>(qk.plan(HOUSE, FROM, TODAY)) ?? [];
      expect(cached.map((r) => r.userId)).toEqual([THEM]);
    });
  });
});
