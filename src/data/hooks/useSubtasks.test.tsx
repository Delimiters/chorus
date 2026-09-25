/**
 * Ticking a step, against a real QueryClient.
 *
 * Written after a bug hunt found the optimistic update was **inert in the
 * app**: it patched `qk.subtaskTicks(household, occurrenceKey)`, a `string[]`
 * keyed by one occurrence, and nothing renders from that. Both screens read
 * `useSubtaskTicksFor`, which is keyed by the *list* of occurrences on screen
 * and shaped `{subtaskId, occurrenceKey}[]`.
 *
 * Different key, different shape — so tapping a step did nothing until the
 * refetch landed, and on a bad connection did nothing visible at all. The
 * module had no tests, which is why a documented, typed, unreachable
 * optimistic update survived. It is the "harness shaped wrong" family from
 * AGENTS.md, in its purest form: correct code nobody could reach.
 *
 * These assert the cache the screens actually read.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { civilDate } from '@/core/civil/date';

import { qk } from '../queryKeys';

const HOUSE = 'house-1';
const TODAY = civilDate('2026-08-27');
const KEY = 'v1:dishes:2026-08-27:0:-';

let mockServerTicks: { subtaskId: string; occurrenceKey: string }[] = [];
let mockSetFails = false;
/*
 * A write the test decides when to finish.
 *
 * Without it these tests are vacuous: the mock server remembers, so after
 * `onSettled` invalidates and refetches, the tick is on screen whether or not
 * the optimistic patch ever worked. Measured — restoring the inert patch left
 * all five green. Holding the request open is the only way to observe the one
 * moment the optimistic value is what the screen is reading.
 *
 * Resolved at the end of each test rather than left hanging: a promise that
 * never settles keeps a jest worker alive after the assertions pass.
 */
let releaseWrite: (() => void) | null = null;
const holdWrite = () => {
  const gate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  return gate;
};
let mockSetHangs = false;
const mockWrites: { subtaskId: string; ticked: boolean }[] = [];

jest.mock('../api/subtasks', () => ({
  listSubtasks: jest.fn(async () => []),
  listSubtaskTicks: jest.fn(async () => []),
  listSubtaskTicksForOccurrences: jest.fn(async () => mockServerTicks),
  replaceSubtasks: jest.fn(async () => {}),
  setSubtaskTick: jest.fn(
    async (input: { subtaskId: string; ticked: boolean; occurrenceKey: string }) => {
      if (mockSetFails) throw new Error('nope');
      if (mockSetHangs) await holdWrite();
      mockWrites.push({ subtaskId: input.subtaskId, ticked: input.ticked });
      /*
       * A server that remembers. `onSettled` invalidates, so a mock that
       * always returned the same rows would wipe the optimistic patch before
       * any assertion could see it — and every test here would fail for a
       * reason that has nothing to do with the hook.
       */
      const without = mockServerTicks.filter(
        (row) => !(row.subtaskId === input.subtaskId && row.occurrenceKey === input.occurrenceKey),
      );
      mockServerTicks = input.ticked
        ? [...without, { subtaskId: input.subtaskId, occurrenceKey: input.occurrenceKey }]
        : without;
    },
  ),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'user-me',
}));

// eslint-disable-next-line import/first
import { useSubtaskTicksFor, useToggleSubtask } from './useSubtasks';

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  mockServerTicks = [];
  mockSetFails = false;
  mockSetHangs = false;
  releaseWrite = null;
  mockWrites.length = 0;
});

afterEach(() => {
  // Let the held write finish, or the worker stays alive after the test ends.
  releaseWrite?.();
});

describe('what the screen sees the moment you tap', () => {
  it('shows the step ticked before the write has landed', async () => {
    // The request is held open, so what is asserted is the optimistic value
    // rather than the refetch that follows it.
    mockSetHangs = true;
    const { client, wrapper } = harness();
    // Seeded as the screens key it: by the list of occurrences on screen.
    client.setQueryData(qk.subtaskTicksFor(HOUSE, [KEY]), []);

    const { result } = renderHook(
      () => ({ ticks: useSubtaskTicksFor([KEY]), toggle: useToggleSubtask(TODAY) }),
      { wrapper },
    );

    act(() => {
      result.current.toggle.mutate({ subtaskId: 's1', ticked: true, occurrenceKey: KEY });
    });

    await waitFor(() => {
      expect(result.current.ticks.get(KEY)?.has('s1')).toBe(true);
    });
  });

  it('un-ticks optimistically too', async () => {
    mockSetHangs = true;
    const { client, wrapper } = harness();
    client.setQueryData(qk.subtaskTicksFor(HOUSE, [KEY]), [
      { subtaskId: 's1', occurrenceKey: KEY },
    ]);
    mockServerTicks = [{ subtaskId: 's1', occurrenceKey: KEY }];

    const { result } = renderHook(
      () => ({ ticks: useSubtaskTicksFor([KEY]), toggle: useToggleSubtask(TODAY) }),
      { wrapper },
    );

    act(() => {
      result.current.toggle.mutate({ subtaskId: 's1', ticked: false, occurrenceKey: KEY });
    });

    // `?? false` because an occurrence with no ticks left has no map entry at
    // all, and `undefined` is not the assertion being made.
    await waitFor(() => {
      expect(result.current.ticks.get(KEY)?.has('s1') ?? false).toBe(false);
    });
  });

  it('leaves another occurrence of the same step alone', async () => {
    /*
     * Ticks are per occurrence — yesterday's rinse and today's are different
     * facts. A patch keyed on the subtask alone would tick both.
     */
    const other = 'v1:dishes:2026-08-26:0:-';
    mockSetHangs = true;
    const { client, wrapper } = harness();
    client.setQueryData(qk.subtaskTicksFor(HOUSE, [KEY, other]), []);

    const { result } = renderHook(
      () => ({ ticks: useSubtaskTicksFor([KEY, other]), toggle: useToggleSubtask(TODAY) }),
      { wrapper },
    );

    act(() => {
      result.current.toggle.mutate({ subtaskId: 's1', ticked: true, occurrenceKey: KEY });
    });

    await waitFor(() => expect(result.current.ticks.get(KEY)?.has('s1')).toBe(true));
    expect(result.current.ticks.get(other)?.has('s1') ?? false).toBe(false);
  });

  it('puts it back when the write fails', async () => {
    // Otherwise a dropped request leaves the step looking done for ever —
    // there is no error rendered anywhere for this mutation.
    mockSetFails = true;
    const { client, wrapper } = harness();
    client.setQueryData(qk.subtaskTicksFor(HOUSE, [KEY]), []);

    const { result } = renderHook(
      () => ({ ticks: useSubtaskTicksFor([KEY]), toggle: useToggleSubtask(TODAY) }),
      { wrapper },
    );

    act(() => {
      result.current.toggle.mutate({ subtaskId: 's1', ticked: true, occurrenceKey: KEY });
    });

    await waitFor(() => expect(result.current.toggle.isError).toBe(true));
    expect(result.current.ticks.get(KEY)?.has('s1') ?? false).toBe(false);
  });
});

describe('what it writes', () => {
  it('sends the tick the caller asked for, not one re-derived from the cache', async () => {
    /*
     * The trap this repo has hit twice: `onMutate` runs *before* `mutationFn`,
     * so anything the write re-derives from the cache sees the optimistic
     * value and does the inverse. `useToggleFlag` shipped exactly that.
     */
    const { client, wrapper } = harness();
    client.setQueryData(qk.subtaskTicksFor(HOUSE, [KEY]), []);

    const { result } = renderHook(() => useToggleSubtask(TODAY), { wrapper });

    act(() => result.current.mutate({ subtaskId: 's1', ticked: true, occurrenceKey: KEY }));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]).toEqual({ subtaskId: 's1', ticked: true });
  });
});
