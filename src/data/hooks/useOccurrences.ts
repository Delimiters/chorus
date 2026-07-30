/**
 * The composition point: server state meets the pure engine.
 *
 * There is deliberately **no occurrences query**. Occurrences are not server
 * state — nothing to fetch, nothing to cache, nothing to invalidate. This hook
 * fetches the three things that *are* stored (chores, completions, exceptions)
 * and runs the projector over them inside a `useMemo`.
 *
 * The payoff: editing a chore re-renders the whole agenda with zero network
 * round trips, and every screen can be tested by handing fixtures straight to
 * the projector. See docs/ARCHITECTURE.md.
 */

import { useQuery, useQueryClient, useMutation, skipToken } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { addDays, startOfWeek } from '@/core/civil/date';
import type { CalendarConfig, CivilDate, DateWindow } from '@/core/civil/types';
import {
  buildTodayView,
  collapseSupersededMisses,
  type AgendaItem,
} from '@/core/occurrence/agenda';
import { projectOccurrences } from '@/core/occurrence/project';
import type { CompletionInput, ExceptionInput } from '@/core/occurrence/types';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';
import {
  completeOccurrence,
  listChores,
  listCompletions,
  listExceptions,
  rescheduleOccurrence,
  skipOccurrence,
  uncompleteOccurrence,
  type Chore,
} from '../api/chores';
import { qk } from '../queryKeys';
import { useHousehold, useMembers } from './useHousehold';
import { useToday } from '../today';

/**
 * Quantises a window to whole weeks.
 *
 * The query key contains the window, so an unquantised one would change every
 * time `today` moved and trigger a refetch storm. Snapping to week boundaries
 * means the key is stable for seven days at a time.
 */
export function quantiseWindow(
  around: CivilDate,
  weekStartsOn: CalendarConfig['weekStartsOn'],
  weeksBack: number,
  weeksForward: number,
): DateWindow {
  const start = addDays(startOfWeek(around, weekStartsOn), -weeksBack * 7);
  const end = addDays(startOfWeek(around, weekStartsOn), weeksForward * 7 - 1);
  return { start, end };
}

interface OccurrencesResult {
  readonly items: readonly AgendaItem[];
  readonly chores: readonly Chore[];
  readonly today: CivilDate;
  readonly window: DateWindow;
  readonly calendar: CalendarConfig;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Chores whose stored shape the engine could not read. */
  readonly unreadable: readonly string[];
}

/**
 * Projected occurrences over a window.
 *
 * The window must already be quantised — pass one from {@link quantiseWindow}.
 */
export function useOccurrences(window: DateWindow): OccurrencesResult {
  const householdId = useActiveHouseholdId();
  const household = useHousehold();
  const timeZone = household.data?.timeZone ?? 'UTC';
  const today = useToday(timeZone);

  const calendar = useMemo<CalendarConfig>(
    () => ({ weekStartsOn: (household.data?.weekStartsOn ?? 0) as CalendarConfig['weekStartsOn'] }),
    [household.data?.weekStartsOn],
  );

  const choresQuery = useQuery({
    queryKey: qk.chores(householdId ?? '__none__'),
    queryFn: householdId === null ? skipToken : () => listChores(householdId),
  });

  const completionsQuery = useQuery({
    queryKey: qk.completions(householdId ?? '__none__', window.start, window.end),
    queryFn:
      householdId === null
        ? skipToken
        : () => listCompletions(householdId, window.start, window.end),
  });

  const exceptionsQuery = useQuery({
    queryKey: qk.exceptions(householdId ?? '__none__', window.start, window.end),
    queryFn:
      householdId === null
        ? skipToken
        : () => listExceptions(householdId, window.start, window.end),
  });

  const members = useMembers();

  const items = useMemo(() => {
    const chores = choresQuery.data?.chores ?? [];
    if (chores.length === 0) return [];

    const projected = projectOccurrences(
      {
        chores,
        completions: (completionsQuery.data ?? []) as CompletionInput[],
        exceptions: (exceptionsQuery.data ?? []) as ExceptionInput[],
        memberIds: (members.data ?? []).map((m) => m.userId),
        today,
      },
      calendar,
      window,
    );
    return collapseSupersededMisses(projected, today);
  }, [
    choresQuery.data,
    completionsQuery.data,
    exceptionsQuery.data,
    members.data,
    today,
    calendar,
    window,
  ]);

  return {
    items,
    chores: choresQuery.data?.chores ?? [],
    today,
    window,
    calendar,
    isLoading: choresQuery.isLoading || completionsQuery.isLoading || exceptionsQuery.isLoading,
    error:
      (choresQuery.error as Error | null) ??
      (completionsQuery.error as Error | null) ??
      (exceptionsQuery.error as Error | null),
    unreadable: choresQuery.data?.unreadable ?? [],
  };
}

/** The Today screen's data, arranged as the design specifies. */
export function useToday_View() {
  const household = useHousehold();
  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as CalendarConfig['weekStartsOn'];
  const timeZone = household.data?.timeZone ?? 'UTC';
  const today = useToday(timeZone);
  const userId = useUserId();

  // Two weeks back covers a weekly chore's miss; the collapse rule handles
  // anything longer by superseding it anyway.
  const window = useMemo(() => quantiseWindow(today, weekStartsOn, 2, 1), [today, weekStartsOn]);

  const occurrences = useOccurrences(window);
  const view = useMemo(
    () => buildTodayView(occurrences.items, today, userId ?? ''),
    [occurrences.items, today, userId],
  );

  return { ...occurrences, view };
}

// ── Mutations ───────────────────────────────────────────────────────────────

interface ToggleInput {
  readonly item: AgendaItem;
  readonly complete: boolean;
}

/**
 * Completing and un-completing, optimistically.
 *
 * Safe because the occurrence key is computed on the client with no round trip,
 * and `unique (chore_id, occurrence_key)` makes a retry idempotent. The cache is
 * patched immediately and the UI re-derives, because the projector is pure.
 */
export function useToggleCompletion() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const household = useHousehold();
  const today = useToday(household.data?.timeZone ?? 'UTC');

  return useMutation({
    mutationFn: async ({ item, complete }: ToggleInput) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      if (complete) {
        await completeOccurrence({
          householdId,
          choreId: item.choreId,
          occurrenceKey: item.occurrenceKey,
          dueOn: item.dueOn,
          completedOn: today,
          userId,
        });
      } else {
        await uncompleteOccurrence(item.choreId, item.occurrenceKey);
      }
    },

    onMutate: async ({ item, complete }) => {
      if (householdId === null || userId === null) return;
      // Every completions query, whatever its window — the occurrence may appear
      // in more than one.
      const prefix = qk.household(householdId);
      await queryClient.cancelQueries({ queryKey: prefix });
      const snapshot = queryClient.getQueriesData({ queryKey: prefix });

      queryClient.setQueriesData<CompletionInput[]>({ queryKey: prefix }, (existing) => {
        if (!Array.isArray(existing)) return existing;
        const without = existing.filter((c) => c.occurrenceKey !== item.occurrenceKey);
        if (!complete) return without;
        return [
          ...without,
          {
            choreId: item.choreId,
            occurrenceKey: item.occurrenceKey,
            completedOn: today,
            completedBy: userId,
          },
        ];
      });

      return { snapshot };
    },

    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },

    onSettled: async () => {
      if (householdId === null) return;
      await queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
    },
  });
}

/** Skip or reschedule a single occurrence. */
export function useOccurrenceActions() {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();

  const invalidate = useCallback(async () => {
    if (householdId === null) return;
    await queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
  }, [householdId, queryClient]);

  const skip = useMutation({
    mutationFn: async (item: AgendaItem) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      await skipOccurrence({
        householdId,
        choreId: item.choreId,
        occurrenceKey: item.occurrenceKey,
        dueOn: item.dueOn,
        userId,
      });
    },
    onSuccess: invalidate,
  });

  const reschedule = useMutation({
    mutationFn: async ({ item, movedTo }: { item: AgendaItem; movedTo: CivilDate }) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      await rescheduleOccurrence({
        householdId,
        choreId: item.choreId,
        occurrenceKey: item.occurrenceKey,
        dueOn: item.dueOn,
        movedTo,
        userId,
      });
    },
    onSuccess: invalidate,
  });

  return { skip, reschedule };
}
