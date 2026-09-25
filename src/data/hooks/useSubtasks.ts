/**
 * A chore's steps, and the ticks against the occurrence on screen.
 *
 * There is no "is it done" rule to apply: a step is done when a tick row
 * exists for that occurrence. A new occurrence has none, so it starts fresh
 * with nothing written; a past one keeps its own, so looking back shows what
 * was really done.
 */

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  listSubtaskTicks,
  listSubtaskTicksForOccurrences,
  listSubtasks,
  replaceSubtasks,
  setSubtaskTick,
  type Subtask,
} from '../api/subtasks';
import { qk } from '../queryKeys';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';

export function useSubtasks() {
  const householdId = useActiveHouseholdId();
  return useQuery({
    queryKey: qk.subtasks(householdId ?? '__none__'),
    queryFn: householdId === null ? skipToken : () => listSubtasks(householdId),
  });
}

/** A chore's steps, in order. Empty for the many chores that have none. */
export function useSubtasksFor(choreId: string | null): readonly Subtask[] {
  const all = useSubtasks();
  return useMemo(
    () => (choreId === null ? [] : (all.data ?? []).filter((s) => s.choreId === choreId)),
    [all.data, choreId],
  );
}

/** The ids ticked off for one occurrence. */
export function useSubtaskTicks(occurrenceKey: string | null): ReadonlySet<string> {
  const householdId = useActiveHouseholdId();
  const query = useQuery({
    queryKey: qk.subtaskTicks(householdId ?? '__none__', occurrenceKey ?? '__none__'),
    queryFn:
      householdId === null || occurrenceKey === null
        ? skipToken
        : () => listSubtaskTicks(householdId, occurrenceKey),
  });
  return useMemo(() => new Set(query.data ?? []), [query.data]);
}

/**
 * Steps grouped by chore, for drawing them under every row.
 *
 * Most chores have none, so this is usually a small map — and returning one
 * lets a screen ask per row without filtering the whole list each time.
 */
export function useSubtasksByChore(): ReadonlyMap<string, readonly Subtask[]> {
  const all = useSubtasks();
  return useMemo(() => {
    const map = new Map<string, Subtask[]>();
    for (const subtask of all.data ?? []) {
      const bucket = map.get(subtask.choreId);
      if (bucket) bucket.push(subtask);
      else map.set(subtask.choreId, [subtask]);
    }
    return map;
  }, [all.data]);
}

/** Ticks for everything on screen, keyed by occurrence. */
/** One tick, as `listSubtaskTicksForOccurrences` returns it. */
interface TickRow {
  readonly subtaskId: string;
  readonly occurrenceKey: string;
}

export function useSubtaskTicksFor(
  occurrenceKeys: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const householdId = useActiveHouseholdId();
  const query = useQuery({
    queryKey: qk.subtaskTicksFor(householdId ?? '__none__', occurrenceKeys),
    queryFn:
      householdId === null
        ? skipToken
        : () => listSubtaskTicksForOccurrences(householdId, occurrenceKeys),
    enabled: householdId !== null && occurrenceKeys.length > 0,
  });

  return useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const tick of query.data ?? []) {
      const bucket = map.get(tick.occurrenceKey);
      if (bucket) bucket.add(tick.subtaskId);
      else map.set(tick.occurrenceKey, new Set([tick.subtaskId]));
    }
    return map;
  }, [query.data]);
}

/**
 * Ticking a step, optimistically.
 *
 * Optimistic for the same reason completing a chore is: the checkbox renders
 * from the cache, so without this it would flick back to its old state the
 * instant it was pressed and forward again when the write returned.
 */
export function useToggleSubtask(tickedOn: string) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      subtaskId,
      ticked,
      occurrenceKey,
    }: {
      subtaskId: string;
      ticked: boolean;
      occurrenceKey: string;
    }) => {
      if (householdId === null || userId === null) {
        throw new Error('Please sign in again.');
      }
      return setSubtaskTick({
        householdId,
        subtaskId,
        occurrenceKey,
        tickedOn,
        userId,
        ticked,
      });
    },

    /*
     * Patches every cache entry a screen actually reads.
     *
     * This used to write only `qk.subtaskTicks(household, occurrenceKey)` — a
     * `string[]` keyed by one occurrence. Nothing renders from that. Both
     * screens read `useSubtaskTicksFor`, which is `qk.subtaskTicksFor` keyed
     * by the *list* of occurrences on screen and shaped
     * `{subtaskId, occurrenceKey}[]`. Different key, different shape, so the
     * optimistic update was inert in the app: tapping a step did nothing until
     * the refetch landed, and on a bad connection did nothing visible at all.
     *
     * A prefix filter rather than an exact key, because the list in the key
     * changes with whatever is on screen and this mutation cannot know it.
     */
    onMutate: async ({ subtaskId, ticked, occurrenceKey }) => {
      if (householdId === null) return;
      const prefix = qk.subtasks(householdId);
      await queryClient.cancelQueries({ queryKey: prefix });

      const snapshots = queryClient.getQueriesData<readonly TickRow[]>({
        queryKey: qk.subtaskTicksForAll(householdId),
      });

      queryClient.setQueriesData<readonly TickRow[]>(
        { queryKey: qk.subtaskTicksForAll(householdId) },
        (existing) => {
          const without = (existing ?? []).filter(
            (row) => !(row.subtaskId === subtaskId && row.occurrenceKey === occurrenceKey),
          );
          return ticked ? [...without, { subtaskId, occurrenceKey }] : without;
        },
      );

      return { snapshots };
    },

    onError: (_error, _input, context) => {
      if (householdId === null || context?.snapshots === undefined) return;
      for (const [key, snapshot] of context.snapshots) {
        queryClient.setQueryData(key, snapshot);
      }
    },

    onSettled: async () => {
      if (householdId === null) return;
      // Everything under the subtasks prefix: the single-occurrence query the
      // sheet uses and the batched one the lists use both hold this tick, and
      // leaving either stale would make the two disagree on screen.
      await queryClient.invalidateQueries({ queryKey: qk.subtasks(householdId) });
    },
  });
}

/** Saves a chore's steps as a set: what is here stays, what is not goes. */
export function useReplaceSubtasks() {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      choreId,
      steps,
    }: {
      choreId: string;
      steps: readonly { id?: string; title: string }[];
    }) => {
      if (householdId === null) throw new Error('Please sign in again.');
      return replaceSubtasks(householdId, choreId, steps);
    },
    onSuccess: async () => {
      if (householdId === null) return;
      await queryClient.invalidateQueries({ queryKey: qk.subtasks(householdId) });
    },
  });
}
