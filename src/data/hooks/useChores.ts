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
import { useCallback } from 'react';

import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';
import {
  archiveChore,
  createChore,
  listChores,
  updateChore,
  type Chore,
  type ChoreDraft,
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
    queryFn:
      householdId === null ? skipToken : () => listChores(householdId, { includeArchived }),
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

export function useArchiveChore() {
  const invalidate = useInvalidateHousehold();

  return useMutation({
    mutationFn: ({ choreId, archived }: { choreId: string; archived: boolean }) =>
      archiveChore(choreId, archived),
    onSuccess: invalidate,
  });
}
