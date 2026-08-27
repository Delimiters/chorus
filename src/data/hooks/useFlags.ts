/**
 * Flags, and toggling one.
 *
 * The engine decides what "live" means (see `core/chore/flag.ts`); this layer
 * fetches every row and hands them over. Toggling is optimistic, because the
 * whole value of a flag is that raising one costs nothing — a marker that
 * waits on a round trip before appearing is a marker you stop reaching for.
 */

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { liveFlagsByChore, liveFlagsFor, toggleFlag } from '@/core/chore/flag';
import type { CivilDate, Weekday } from '@/core/civil/types';
import { listFlags, lowerFlag, raiseFlag, type ChoreFlagRow } from '../api/flags';
import { qk } from '../queryKeys';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';

const EMPTY: readonly ChoreFlagRow[] = [];

export function useFlags(): readonly ChoreFlagRow[] {
  const householdId = useActiveHouseholdId();
  const query = useQuery({
    queryKey: qk.flags(householdId ?? '__none__'),
    queryFn: householdId === null ? skipToken : () => listFlags(householdId),
  });
  return query.data ?? EMPTY;
}

/** The chores you have flagged for the week containing `on`. */
export function useMyFlags(on: CivilDate, weekStartsOn: Weekday): ReadonlySet<string> {
  const flags = useFlags();
  const userId = useUserId();
  return useMemo(
    () => (userId === null ? new Set<string>() : liveFlagsFor(flags, userId, on, weekStartsOn)),
    [flags, userId, on, weekStartsOn],
  );
}

/** Everyone's live flags, by chore — so a row can show that *somebody* cares. */
export function useFlagsByChore(
  on: CivilDate,
  weekStartsOn: Weekday,
): ReadonlyMap<string, readonly string[]> {
  const flags = useFlags();
  return useMemo(() => liveFlagsByChore(flags, on, weekStartsOn), [flags, on, weekStartsOn]);
}

export function useToggleFlag(on: CivilDate, weekStartsOn: Weekday) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (choreId: string) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      const key = qk.flags(householdId);
      const existing = (queryClient.getQueryData<readonly ChoreFlagRow[]>(key) ?? []).find(
        (f) => f.choreId === choreId && f.userId === userId,
      );
      const next = toggleFlag(
        existing === undefined ? undefined : { choreId, userId, flaggedOn: existing.flaggedOn },
        on,
        weekStartsOn,
      );

      if (next === null) await lowerFlag(choreId, userId);
      else await raiseFlag({ householdId, choreId, userId, flaggedOn: next });
    },

    onMutate: async (choreId) => {
      if (householdId === null || userId === null) return;
      const key = qk.flags(householdId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<readonly ChoreFlagRow[]>(key);

      queryClient.setQueryData<readonly ChoreFlagRow[]>(key, (existing = []) => {
        const mine = existing.find((f) => f.choreId === choreId && f.userId === userId);
        const next = toggleFlag(
          mine === undefined ? undefined : { choreId, userId, flaggedOn: mine.flaggedOn },
          on,
          weekStartsOn,
        );
        const without = existing.filter((f) => !(f.choreId === choreId && f.userId === userId));
        return next === null ? without : [...without, { choreId, userId, flaggedOn: next }];
      });

      return { snapshot };
    },

    onError: (_error, _choreId, context) => {
      if (householdId === null || context?.snapshot === undefined) return;
      queryClient.setQueryData(qk.flags(householdId), context.snapshot);
    },

    onSettled: () => {
      if (householdId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.flags(householdId) });
    },
  });
}
