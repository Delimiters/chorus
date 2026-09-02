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
  toAgendaItems,
  type AgendaItem,
} from '@/core/occurrence/agenda';
import { projectOccurrences } from '@/core/occurrence/project';
import type { CompletionInput, ExceptionInput } from '@/core/occurrence/types';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';
import {
  clearException,
  completeOccurrence,
  listChores,
  listCompletions,
  listCompletionsForChores,
  listExceptions,
  listExceptionsForChores,
  listOneTimeChores,
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
  /**
   * Every projected occurrence in the window, uncollapsed.
   *
   * The calendar wants these: collapsing is a Today-screen product decision, and
   * applying it here stripped the grid of every superseded past dot — which is
   * the one thing the grid exists to show.
   */
  readonly items: readonly AgendaItem[];
  /** The same occurrences with superseded misses collapsed. What Today shows. */
  readonly agenda: readonly AgendaItem[];
  readonly chores: readonly Chore[];
  readonly today: CivilDate;
  readonly window: DateWindow;
  readonly calendar: CalendarConfig;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Chores whose stored shape the engine could not read. */
  readonly unreadable: readonly string[];
  /** Refetch everything this household's agenda is built from. */
  readonly refetch: () => Promise<void>;
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

  /**
   * Interval chores need **every** completion they have, not this window's.
   *
   * `anchorToCompletion` sets the phase of an "every N days" series from the
   * last completion whenever it was, so filtering completions by `due_on` — as
   * the windowed query above does, correctly, for everything else — feeds it a
   * different input per screen and it computes different due dates for the same
   * chore on each. Worse, the re-anchoring then *expired*: once a completion
   * fell out of Today's two-week lookback the chore snapped back onto the fixed
   * grid and the dates it had been rightly skipping reappeared as overdue.
   *
   * Only interval chores, because they are the only rule the anchoring touches,
   * and a two-person household's ticks are a few kilobytes.
   */
  const intervalChoreIds = useMemo(
    () =>
      (choresQuery.data?.chores ?? [])
        .filter((c) => c.schedule.rule.kind === 'daily')
        .map((c) => c.id),
    [choresQuery.data],
  );

  const intervalCompletionsQuery = useQuery({
    queryKey: qk.completionsForChores(householdId ?? '__none__', intervalChoreIds),
    queryFn:
      householdId === null
        ? skipToken
        : () => listCompletionsForChores(householdId, intervalChoreIds),
    enabled: householdId !== null && intervalChoreIds.length > 0,
  });

  /**
   * The two completion queries, de-duplicated by occurrence key.
   *
   * They overlap: a recent completion of an interval chore is in both. Passing
   * it twice would apply the same re-anchor twice and walk the series forward
   * by an extra N days.
   */
  const completions = useMemo(() => {
    const merged = new Map<string, CompletionInput>();
    for (const c of (completionsQuery.data ?? []) as CompletionInput[])
      merged.set(c.occurrenceKey, c);
    for (const c of (intervalCompletionsQuery.data ?? []) as CompletionInput[])
      merged.set(c.occurrenceKey, c);
    return [...merged.values()];
  }, [completionsQuery.data, intervalCompletionsQuery.data]);

  const projected = useMemo(() => {
    const chores = choresQuery.data?.chores ?? [];
    if (chores.length === 0) return [];

    const projected = projectOccurrences(
      {
        chores,
        completions,
        exceptions: (exceptionsQuery.data ?? []) as ExceptionInput[],
        memberIds: (members.data ?? []).map((m) => m.userId),
        today,
      },
      calendar,
      window,
    );
    return projected;
  }, [choresQuery.data, completions, exceptionsQuery.data, members.data, today, calendar, window]);

  /**
   * Both views derive from the **projector's** output, not from each other.
   *
   * This was wrong and the bug was invisible: `items` used to be
   * `toAgendaItems(projected)`, which strips displaced occurrences, and the
   * agenda was then collapsed from `items`. So the collapse rule never saw a
   * displaced occurrence and the whole mechanism added to support it was inert
   * in the running app while its unit tests — which call the collapse directly —
   * passed. `AgendaItem extends ProjectedOccurrence`, so the double conversion
   * type-checked in silence.
   */
  const calendarItems = useMemo(() => toAgendaItems(projected, today), [projected, today]);
  const agenda = useMemo(() => collapseSupersededMisses(projected, today), [projected, today]);

  /**
   * Broad rather than surgical, and deliberately so — a household's whole
   * dataset is a few kilobytes, and this runs on pull-to-refresh and on a failed
   * load, both of which want "get me back to the truth", not "get me back to a
   * carefully reasoned subset of the truth".
   */
  const queryClient = useQueryClient();
  const refetch = useCallback(async () => {
    if (householdId === null) return;
    await queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
  }, [householdId, queryClient]);

  return {
    items: calendarItems,
    agenda,
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
    refetch,
  };
}

/**
 * One-time chores outstanding from outside the agenda window, on either side.
 *
 * The collapse rule says a one-time chore never expires, but the window it
 * collapses is only a few weeks wide — so "renew the passport", set eight months
 * ago, was silently absent from Today and the screen cheerfully said "All clear".
 * The guarantee was true of the function and false of the product.
 *
 * Forward as well as back, and the forward half is newer. A chore can now be
 * asked to appear before it is due (`showFrom`), and that decides *status* —
 * but an occurrence dated beyond the window is never fetched, so there is
 * nothing for the status to be about. Twenty-one chores due at the end of the
 * month sat invisible on Today for exactly this reason while every one of them
 * was, by the engine's reckoning, due.
 *
 * These need their own fetch precisely because no sane window contains them.
 */
function useLingeringOneTimeChores(
  today: CivilDate,
  calendar: CalendarConfig,
  window: DateWindow,
): { items: readonly AgendaItem[]; error: Error | null } {
  const householdId = useActiveHouseholdId();
  const members = useMembers();

  const choresQuery = useQuery({
    queryKey: qk.oneTimeChores(householdId ?? '__none__'),
    queryFn: householdId === null ? skipToken : () => listOneTimeChores(householdId),
  });

  const choreIds = useMemo(
    () => (choresQuery.data?.chores ?? []).map((c) => c.id),
    [choresQuery.data],
  );

  const completionsQuery = useQuery({
    queryKey: qk.completionsForChores(householdId ?? '__none__', choreIds),
    queryFn:
      householdId === null ? skipToken : () => listCompletionsForChores(householdId, choreIds),
    enabled: householdId !== null && choreIds.length > 0,
  });

  /**
   * Their exceptions, fetched for the same reason as their completions.
   *
   * Omitting these made skip and reschedule silent no-ops on exactly these
   * rows — and Phase 6 is what made them tappable. Skipping wrote the exception,
   * the next render ignored it, the row stayed put, and tapping again hit the
   * unique constraint, which the API maps to success. A chore that cannot be
   * skipped and never says why.
   */
  const exceptionsQuery = useQuery({
    queryKey: qk.exceptionsForChores(householdId ?? '__none__', choreIds),
    queryFn:
      householdId === null ? skipToken : () => listExceptionsForChores(householdId, choreIds),
    enabled: householdId !== null && choreIds.length > 0,
  });

  const items = useMemo(() => {
    const chores = choresQuery.data?.chores ?? [];
    if (chores.length === 0) return [];

    // Wide enough to hold any of them; each yields exactly one occurrence, so
    // the width costs nothing. Bounded above by the agenda window's start, so an
    // occurrence never appears both here and there.
    const input = {
      chores,
      completions: (completionsQuery.data ?? []) as CompletionInput[],
      exceptions: (exceptionsQuery.data ?? []) as ExceptionInput[],
      memberIds: (members.data ?? []).map((m) => m.userId),
      today,
    };

    /*
     * Two projections, not one wide one.
     *
     * The projector pads its window by 31 days each side and refuses anything
     * over 400 days, so a single range covering both directions would trip
     * that guard — loudly, which is what the guard is for.
     *
     * Each range stops short of the agenda window, so an occurrence can never
     * appear both here and there.
     */
    const behind = projectOccurrences(input, calendar, {
      start: addDays(window.start, -MAX_LOOKBACK_DAYS),
      end: addDays(window.start, -1),
    });
    const ahead = projectOccurrences(input, calendar, {
      start: addDays(window.end, 1),
      end: addDays(today, MAX_LOOKAHEAD_DAYS),
    });

    /*
     * Only what is outstanding *now*.
     *
     * This is what keeps the forward half honest: a chore due in October with
     * no `showFrom` is `upcoming`, not `due`, so it is dropped here and Today
     * stays a list of things to actually do. Only a chore that has been asked
     * to appear early survives.
     */
    return toAgendaItems(
      [...behind, ...ahead].filter((o) => o.status === 'due' || o.status === 'overdue'),
      today,
    );
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
    error:
      (choresQuery.error as Error | null) ??
      (completionsQuery.error as Error | null) ??
      (exceptionsQuery.error as Error | null),
  };
}

/**
 * How far back Today reaches for a forgotten one-time chore.
 *
 * Not 366, which is what this wanted to be: the projector pads the window by 31
 * days on each side to catch occurrences rescheduled across the edge, so a
 * year-long request came to 428 days and tripped the 400-day cap — loudly, which
 * is exactly what that guard is for. 330 leaves room for the padding and still
 * covers "I set this eleven months ago and forgot".
 */
const MAX_LOOKBACK_DAYS = 330;

/**
 * How far ahead Today reaches for a chore asked to appear before it is due.
 *
 * Same bound as the lookback and for the same reason: it is a separate
 * projection, so each stays inside the engine's 400-day ceiling once the
 * projector's 31-day padding is added at both ends.
 */
const MAX_LOOKAHEAD_DAYS = 330;

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
  const lingering = useLingeringOneTimeChores(today, occurrences.calendar, window);

  const view = useMemo(
    () => buildTodayView([...lingering.items, ...occurrences.agenda], today, userId ?? ''),
    [lingering.items, occurrences.agenda, today, userId],
  );

  return { ...occurrences, view, error: occurrences.error ?? lingering.error };
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
      /**
       * Every completions query, whatever its window — the occurrence may appear
       * in more than one — and **nothing but** completions queries.
       *
       * This used to patch the whole `household` prefix and guard with
       * `Array.isArray`, which is not the discriminator it looks like: `members`
       * is an array under that prefix too, so a completion row got appended to
       * the member list and the House tab threw reading `displayName` off it.
       * `exceptions` is worse — the filter *removed* the reschedule for the very
       * occurrence being ticked, so the row jumped back to its original date.
       */
      const prefix = qk.completionsAll(householdId);
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

  /**
   * Undoes a skip or a reschedule.
   *
   * One mutation for both, because there is one row: the exception table is
   * keyed by occurrence and holds at most one deviation per occurrence, so
   * "un-skip" and "put it back" are the same delete.
   */
  const clear = useMutation({
    mutationFn: async (item: AgendaItem) => {
      await clearException(item.choreId, item.occurrenceKey);
    },
    onSuccess: invalidate,
  });

  return { skip, reschedule, clear };
}
