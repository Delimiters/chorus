/**
 * Routine reads and writes, and the day the screen is showing.
 *
 * The same composition as `useOccurrences`: fetch the stored things — items and
 * completions — and run the pure projector over them in a `useMemo`. There is
 * deliberately no query key for occurrences, because occurrences are not server
 * state and there is nothing to fetch.
 *
 * The one thing worth copying carefully from that file: **both derived values
 * come from the projector's output, never one from the other.** Deriving the
 * sections from an already-transformed list is how the chore agenda's collapse
 * rule ended up inert in the running app while its unit tests passed.
 */

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { CivilDate, DateWindow } from '@/core/civil/types';
import { bucketSections, type DaySummary } from '@/core/routines/agenda';
import { projectRoutineOccurrences, type RoutineOccurrence } from '@/core/routines/project';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';
import {
  archiveRoutineItem,
  completeRoutine,
  createRoutineItem,
  deleteRoutineItem,
  listRoutineCompletions,
  listRoutineItems,
  setShareRoutine,
  uncompleteRoutine,
  updateRoutineItem,
  type LinkedChoreTick,
  type RoutineDraft,
  type RoutineItem,
} from '../api/routines';
import { qk } from '../queryKeys';
import { useHousehold } from './useHousehold';
import { quantiseWindow } from './useOccurrences';

const EMPTY: readonly RoutineItem[] = [];

export function useRoutineItems(options: { includeArchived?: boolean } = {}) {
  const householdId = useActiveHouseholdId();
  const includeArchived = options.includeArchived ?? false;

  return useQuery({
    queryKey: qk.routineList(householdId ?? '__none__', { archived: includeArchived }),
    queryFn:
      householdId === null ? skipToken : () => listRoutineItems(householdId, { includeArchived }),
  });
}

/** One routine item, read from whichever list already has it. */
export function useRoutineItem(itemId: string | null): RoutineItem | undefined {
  const list = useRoutineItems({ includeArchived: true });
  if (itemId === null) return undefined;
  return list.data?.items.find((i) => i.id === itemId);
}

function useInvalidateHousehold() {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (householdId === null) return;
    await queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
  }, [householdId, queryClient]);
}

export interface RoutineDay {
  readonly summary: DaySummary;
  /** Every occurrence in the window, for anything that needs more than one day. */
  readonly occurrences: readonly RoutineOccurrence[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly unreadable: readonly string[];
}

/**
 * The routine for one day.
 *
 * The *window* is a whole quantised week around that day, not the day itself —
 * so paging back and forth within a week costs no refetch and the query key
 * does not churn. The projector is given the window; `bucketSections` narrows
 * to the day.
 */
export function useRoutineDay(on: CivilDate, options: { showOthers: boolean }): RoutineDay {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const household = useHousehold();
  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  const window: DateWindow = useMemo(
    () => quantiseWindow(on, weekStartsOn, 0, 1),
    [on, weekStartsOn],
  );

  const items = useRoutineItems();
  const completions = useQuery({
    queryKey: qk.routineCompletions(householdId ?? '__none__', window.start, window.end),
    queryFn:
      householdId === null
        ? skipToken
        : () => listRoutineCompletions(householdId, window.start, window.end),
  });

  const occurrences = useMemo(
    () =>
      projectRoutineOccurrences(
        {
          items: items.data?.items ?? [],
          completions: completions.data ?? [],
          today: on,
        },
        { weekStartsOn },
        window,
      ),
    [items.data, completions.data, on, weekStartsOn, window],
  );

  // From `occurrences`, not from anything already derived from it.
  const summary = useMemo(
    () => bucketSections(occurrences, userId ?? '', { showOthers: options.showOthers, on }),
    [occurrences, userId, options.showOthers, on],
  );

  return {
    summary,
    occurrences,
    isLoading: items.isPending || completions.isPending,
    error: (items.error as Error | null) ?? (completions.error as Error | null),
    unreadable: items.data?.unreadable ?? [],
  };
}

/** The items you own, for the reminder planner and the management list. */
export function useMyRoutineItems(): readonly RoutineItem[] {
  const userId = useUserId();
  const list = useRoutineItems();
  return useMemo(
    () => (list.data?.items ?? EMPTY).filter((i) => i.ownerId === userId),
    [list.data, userId],
  );
}

export function useCreateRoutineItem() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: (draft: RoutineDraft) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      return createRoutineItem(householdId, userId, draft);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRoutineItem() {
  const invalidate = useInvalidateHousehold();
  return useMutation({
    mutationFn: ({ itemId, draft }: { itemId: string; draft: RoutineDraft }) =>
      updateRoutineItem(itemId, draft),
    onSuccess: invalidate,
  });
}

export function useArchiveRoutineItem() {
  const invalidate = useInvalidateHousehold();
  return useMutation({
    mutationFn: ({ itemId, archived }: { itemId: string; archived: boolean }) =>
      archiveRoutineItem(itemId, archived),
    onSuccess: invalidate,
  });
}

export function useDeleteRoutineItem() {
  const invalidate = useInvalidateHousehold();
  return useMutation({
    mutationFn: ({ itemId }: { itemId: string }) => deleteRoutineItem(itemId),
    onSuccess: invalidate,
  });
}

export function useSetShareRoutine() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: ({ shared }: { shared: boolean }) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      return setShareRoutine(householdId, userId, shared);
    },
    onSuccess: invalidate,
  });
}

/**
 * Ticking a routine item on or off, and the linked chore with it.
 *
 * The caller supplies the linked chore's occurrence, because it is the caller
 * that knows what is due today — the RPC is a two-row transaction and
 * deliberately does not expand recurrence, which would be a second
 * implementation of the engine.
 *
 * When nothing of that chore is due today, `chore` is null and the tick is a
 * routine tick alone. That is the right answer rather than a missing feature: a
 * completion invented for a day the chore was never due would distort the
 * expected-versus-actual figure the stats screen is built on.
 */
export function useToggleRoutine() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: async ({
      occurrence,
      complete,
      on,
      chore,
    }: {
      occurrence: RoutineOccurrence;
      complete: boolean;
      on: CivilDate;
      chore?: LinkedChoreTick | null;
    }) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      if (complete) {
        await completeRoutine({
          routineItemId: occurrence.itemId,
          occurrenceKey: occurrence.occurrenceKey,
          dueOn: occurrence.dueOn,
          completedOn: on,
          chore: chore ?? null,
        });
      } else {
        await uncompleteRoutine({
          routineItemId: occurrence.itemId,
          occurrenceKey: occurrence.occurrenceKey,
          chore: chore ?? null,
        });
      }
    },
    onSuccess: invalidate,
  });
}
