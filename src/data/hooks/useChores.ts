/**
 * Chore reads and writes.
 *
 * Separate from `useOccurrences` on purpose: that file is about deriving what is
 * due, this one is about the stored rows it derives from. Every mutation here
 * invalidates the whole household key rather than patching the cache, because a
 * schedule edit changes which occurrences exist at all — there is no surgical
 * patch for "every date this chore falls on is now different", and pretending
 * otherwise is where realtime bugs live.
 *
 * Completion is the one exception, and it lives in `useOccurrences` with its
 * optimistic patch, because it happens twenty times a week and its effect is
 * exactly one row.
 */

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { CivilDate } from '@/core/civil/types';
import { somedayKeyOf } from '@/core/recurrence/period';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';
import {
  archiveChore,
  completeOccurrence,
  createChore,
  listChores,
  listCompletionsForChores,
  scheduleChoreForDay,
  type Chore,
  type ChoreDraft,
  uncompleteOccurrence,
  updateChore,
} from '../api/chores';
import { qk } from '../queryKeys';

/**
 * Every chore in the household, archived ones included on request.
 *
 * The Chores tab wants the archived ones behind a filter — archiving is the only
 * removal the app offers, so unarchiving has to be reachable from somewhere.
 */
export function useChoreList(options: { includeArchived?: boolean } = {}) {
  const householdId = useActiveHouseholdId();
  const includeArchived = options.includeArchived ?? false;

  return useQuery({
    queryKey: qk.choreList(householdId ?? '__none__', { archived: includeArchived }),
    queryFn: householdId === null ? skipToken : () => listChores(householdId, { includeArchived }),
  });
}

/** One chore, read from whichever list query already has it. */
export function useChore(choreId: string | null): Chore | undefined {
  const list = useChoreList({ includeArchived: true });
  if (choreId === null) return undefined;
  return list.data?.chores.find((c) => c.id === choreId);
}

/**
 * Invalidates everything scoped to the household.
 *
 * Broad and deliberate. A household's whole dataset is a few kilobytes, and the
 * alternative — working out which windows a schedule change affects — is both
 * harder and wrong more often. See docs/ARCHITECTURE.md.
 */
function useInvalidateHousehold() {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (householdId === null) return;
    await queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
  }, [householdId, queryClient]);
}

/**
 * Ticking a Someday chore off.
 *
 * Someday chores produce no occurrences, so they were creatable and never
 * completable — the picker promised you could "tick it off" from a list with no
 * checkbox on it. They now get one stable key each (see `somedayKeyOf`) and an
 * ordinary completion row, so "we finally cleared the loft on 3 March" is a real
 * record rather than a chore quietly disappearing.
 *
 * `dueOn` is set to the day it was done. A Someday chore was never due on any
 * particular date, and "due whenever you got to it" is the honest reading —
 * which also keeps the column non-null without a migration.
 */
/**
 * When each one-off chore was ticked, if it was.
 *
 * Both kinds that are finished for good once they are done: Someday, which is
 * ticked on the chore list itself, and one-time, which is ticked on Today.
 * A repeating chore is excluded because "when was it completed" has no single
 * answer for it.
 */
export function useOneOffCompletions() {
  const householdId = useActiveHouseholdId();
  const list = useChoreList({ includeArchived: true });

  const choreIds = useMemo(
    () =>
      (list.data?.chores ?? [])
        .filter((c) => c.schedule.rule.kind === 'unscheduled' || c.schedule.rule.kind === 'once')
        .map((c) => c.id),
    [list.data],
  );

  return useQuery({
    queryKey: qk.completionsForChores(householdId ?? '__none__', choreIds),
    queryFn:
      householdId === null ? skipToken : () => listCompletionsForChores(householdId, choreIds),
    enabled: householdId !== null && choreIds.length > 0,
  });
}

export function useToggleSomeday() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: async ({
      choreId,
      done,
      today,
    }: {
      choreId: string;
      done: boolean;
      today: CivilDate;
    }) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      const occurrenceKey = somedayKeyOf(choreId);
      if (done) {
        await completeOccurrence({
          householdId,
          choreId,
          occurrenceKey,
          dueOn: today,
          completedOn: today,
          userId,
        });
      } else {
        await uncompleteOccurrence(choreId, occurrenceKey);
      }
    },
    onSuccess: invalidate,
  });
}

export function useCreateChore() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: async (draft: ChoreDraft) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      return createChore(householdId, userId, draft);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateChore() {
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: ({ choreId, draft }: { choreId: string; draft: ChoreDraft }) =>
      updateChore(choreId, draft),
    onSuccess: invalidate,
  });
}

/** Give a "no date" chore today's date, so it can be planned and finished. */
export function useScheduleToday(today: string) {
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: (choreId: string) => scheduleChoreForDay(choreId, today),
    onSuccess: invalidate,
  });
}

export function useArchiveChore() {
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: ({ choreId, archived }: { choreId: string; archived: boolean }) =>
      archiveChore(choreId, archived),
    onSuccess: invalidate,
  });
}
