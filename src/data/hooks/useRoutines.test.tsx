/**
 * Reordering a routine, at the layer where the jitter lived.
 *
 * The list renders from the query cache. Without an optimistic patch the
 * dropped row re-rendered in its old place the moment the gesture ended, then
 * moved again when the refetch landed — visibly jumping back and forth before
 * settling. That is invisible to the engine tests, which only ever see the
 * comparator, so it belongs here.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { civilDate } from '@/core/civil/date';
import type { RoutineItem } from '@/data/api/routines';
import { qk } from '@/data/queryKeys';
import { useReorderRoutine } from './useRoutines';

const HOUSEHOLD = 'house-1';

const mockReorder = jest.fn(async (_ids: readonly string[]) => {});
jest.mock('@/data/api/routines', () => ({
  reorderRoutineItems: (ids: readonly string[]) => mockReorder(ids),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'me',
}));

const item = (id: string, position: number | null): RoutineItem =>
  ({ id, title: id, position, ownerId: 'me' }) as RoutineItem;

/** What `useRoutineItems` holds: the list result, not a bare array. */
const listOf = (...items: RoutineItem[]) => ({ items, unreadable: [], sharedByMe: false });

function setup(seed: RoutineItem[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.routineList(HOUSEHOLD, { archived: false }), listOf(...seed));
  client.setQueryData(qk.routineList(HOUSEHOLD, { archived: true }), listOf(...seed));
  // A completions query lives under the same prefix and is a plain array. The
  // patch must leave it alone: the chore version of this once appended a
  // completion to the member list for exactly this reason.
  client.setQueryData(
    qk.routineCompletions(HOUSEHOLD, civilDate('2026-03-15'), civilDate('2026-03-21')),
    [],
  );

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const positionsIn = (client: QueryClient, archived: boolean) =>
  Object.fromEntries(
    (
      client.getQueryData(qk.routineList(HOUSEHOLD, { archived })) as ReturnType<typeof listOf>
    ).items.map((i) => [i.id, i.position]),
  );

beforeEach(() => mockReorder.mockClear());

describe('reordering a routine', () => {
  it('puts the new order in the cache before the server answers', async () => {
    const { client, wrapper } = setup([item('a', null), item('b', null), item('c', null)]);
    const { result } = await renderHook(() => useReorderRoutine(), { wrapper });

    await act(async () => {
      result.current.mutate({ orderedIds: ['c', 'a', 'b'] });
    });

    await waitFor(() => {
      expect(positionsIn(client, false)).toEqual({ c: 0, a: 1, b: 2 });
    });
  });

  it('patches the archived list too, so the editor agrees with the screen', async () => {
    const { client, wrapper } = setup([item('a', null), item('b', null)]);
    const { result } = await renderHook(() => useReorderRoutine(), { wrapper });

    await act(async () => {
      result.current.mutate({ orderedIds: ['b', 'a'] });
    });

    await waitFor(() => {
      expect(positionsIn(client, true)).toEqual({ b: 0, a: 1 });
    });
  });

  it('leaves the completions under the same prefix untouched', async () => {
    const { client, wrapper } = setup([item('a', null)]);
    const { result } = await renderHook(() => useReorderRoutine(), { wrapper });

    await act(async () => {
      result.current.mutate({ orderedIds: ['a'] });
    });

    await waitFor(() => {
      expect(
        client.getQueryData(
          qk.routineCompletions(HOUSEHOLD, civilDate('2026-03-15'), civilDate('2026-03-21')),
        ),
      ).toEqual([]);
    });
  });

  it('puts the old order back when the write fails', async () => {
    mockReorder.mockRejectedValueOnce(new Error('offline'));
    const { client, wrapper } = setup([item('a', 0), item('b', 1)]);
    const { result } = await renderHook(() => useReorderRoutine(), { wrapper });

    await act(async () => {
      result.current.mutate({ orderedIds: ['b', 'a'] });
    });

    await waitFor(() => {
      expect(positionsIn(client, false)).toEqual({ a: 0, b: 1 });
    });
  });
});
