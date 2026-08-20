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

    onMutate: async ({ subtaskId, ticked, occurrenceKey }) => {
      if (householdId === null) return;
      const key = qk.subtaskTicks(householdId, occurrenceKey);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<readonly string[]>(key);

      queryClient.setQueryData<readonly string[]>(key, (existing) => {
        const without = (existing ?? []).filter((id) => id !== subtaskId);
        return ticked ? [...without, subtaskId] : without;
      });

      return { snapshot };
    },

    onError: (_error, input, context) => {
      if (householdId === null || context?.snapshot === undefined) return;
      queryClient.setQueryData(qk.subtaskTicks(householdId, input.occurrenceKey), context.snapshot);
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
