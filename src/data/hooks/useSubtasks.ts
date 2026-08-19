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
 * Ticking a step, optimistically.
 *
 * Optimistic for the same reason completing a chore is: the checkbox renders
 * from the cache, so without this it would flick back to its old state the
 * instant it was pressed and forward again when the write returned.
 */
export function useToggleSubtask(occurrenceKey: string | null, tickedOn: string) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ subtaskId, ticked }: { subtaskId: string; ticked: boolean }) => {
      if (householdId === null || userId === null || occurrenceKey === null) {
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

    onMutate: async ({ subtaskId, ticked }) => {
      if (householdId === null || occurrenceKey === null) return;
      const key = qk.subtaskTicks(householdId, occurrenceKey);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<readonly string[]>(key);

      queryClient.setQueryData<readonly string[]>(key, (existing) => {
        const without = (existing ?? []).filter((id) => id !== subtaskId);
        return ticked ? [...without, subtaskId] : without;
      });

      return { snapshot };
    },

    onError: (_error, _input, context) => {
      if (householdId === null || occurrenceKey === null || context?.snapshot === undefined) return;
      queryClient.setQueryData(qk.subtaskTicks(householdId, occurrenceKey), context.snapshot);
    },

    onSettled: async () => {
      if (householdId === null || occurrenceKey === null) return;
      await queryClient.invalidateQueries({
        queryKey: qk.subtaskTicks(householdId, occurrenceKey),
      });
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
