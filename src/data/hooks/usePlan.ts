/**
 * Today's plan, and changing it.
 *
 * Every mutation here is optimistic. The plan is meant to feel like moving
 * pieces of paper around a table — if adding something waits on a round trip
 * before it appears, building a day stops being cheap and the whole feature
 * fails at the one thing it exists to do.
 */

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { nextPosition, type PlanEntry } from '@/core/plan/plan';
import type { CivilDate } from '@/core/civil/types';
import { addToPlan, listPlanEntries, removeFromPlan, type PlanEntryRow } from '../api/plan';
import { qk } from '../queryKeys';
import { useActiveHouseholdId, useUserId } from '@/stores/sessionStore';

const EMPTY: readonly PlanEntryRow[] = [];

/**
 * The window the plan screen holds.
 *
 * Eight days back so yesterday's leftovers — and the few days before it, on a
 * bad week — are available to rank a proposal without a second query.
 */
export const PLAN_LOOKBACK_DAYS = 8;

function shiftDays(date: CivilDate, days: number): CivilDate {
  const [y, m, d] = date.split('-').map(Number);
  const at = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10) as CivilDate;
}

export function usePlanEntries(today: CivilDate) {
  const householdId = useActiveHouseholdId();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);

  const query = useQuery({
    queryKey: qk.plan(householdId ?? '__none__', from, today),
    queryFn: householdId === null ? skipToken : () => listPlanEntries(householdId, from, today),
  });

  return query.data ?? EMPTY;
}

/** Only yours. Both plans are visible, but the screen is about your day. */
export function useMyPlanEntries(today: CivilDate): readonly PlanEntry[] {
  const rows = usePlanEntries(today);
  const userId = useUserId();
  return useMemo(
    () =>
      rows
        .filter((row) => row.userId === userId)
        .map((row) => ({
          occurrenceKey: row.occurrenceKey,
          choreId: row.choreId,
          plannedFor: row.plannedFor,
          position: row.position,
        })),
    [rows, userId],
  );
}

/**
 * What your housemate still has on today.
 *
 * Counted the same way mine is, which it was not: the first version tallied raw
 * rows, so it kept saying "Sam has 3 planned" after Sam had finished all three,
 * and counted entries whose occurrence no longer exists — the very ghosts the
 * screen's own test proves are dropped from *my* denominator. A number that
 * means one thing in one line and something else in the next is worse than no
 * number.
 */
export function useTheirPlanCount(
  today: CivilDate,
  available: readonly { occurrenceKey: string; status: string }[],
): number {
  const rows = usePlanEntries(today);
  const userId = useUserId();
  return useMemo(() => {
    const byKey = new Map(available.map((item) => [item.occurrenceKey, item]));
    return rows.filter((row) => {
      if (row.userId === userId || row.plannedFor !== today) return false;
      const item = byKey.get(row.occurrenceKey);
      return item !== undefined && item.status !== 'completed' && item.status !== 'skipped';
    }).length;
  }, [rows, userId, today, available]);
}

interface Addable {
  readonly occurrenceKey: string;
  readonly choreId: string;
}

export function useAddToPlan(today: CivilDate) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);

  /**
   * What to write, decided from the cache as it stands *before* the mutation.
   *
   * The first version computed positions inside `mutationFn`, which runs after
   * `onMutate` — so it counted its own optimistic rows and every add landed a
   * few slots further down than the row the user was looking at. The same trap
   * that made `useToggleFlag` write its own inverse, one PR earlier, in a hook
   * written the same afternoon. Deciding once and passing the answer through is
   * the only shape that cannot drift.
   */
  const decide = (items: readonly Addable[]) => {
    const rows = queryClient.getQueryData<readonly PlanEntryRow[]>(
      qk.plan(householdId ?? '__none__', from, today),
    );
    // Mine, not everyone's. `nextPosition` used to run over the whole
    // household's rows under a variable named `mine`, so my first planned item
    // could be written at position 52 because my housemate had a long day.
    const mine = (rows ?? [])
      .filter((row) => row.userId === userId)
      .map((row) => ({
        occurrenceKey: row.occurrenceKey,
        choreId: row.choreId,
        plannedFor: row.plannedFor,
        position: row.position,
      }));
    const already = new Set(
      (rows ?? [])
        .filter((row) => row.userId === userId && row.plannedFor === today)
        .map((row) => row.occurrenceKey),
    );

    let position = nextPosition(mine, today);
    return items
      .filter((item) => !already.has(item.occurrenceKey))
      .map((item) => ({ ...item, position: position++ }));
  };

  const mutation = useMutation({
    mutationFn: async (planned: readonly (Addable & { position: number })[]) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      await addToPlan(
        planned.map((item) => ({
          householdId,
          userId,
          choreId: item.choreId,
          occurrenceKey: item.occurrenceKey,
          plannedFor: today,
          position: item.position,
        })),
      );
    },

    onMutate: async (planned) => {
      if (householdId === null || userId === null) return;
      const key = qk.plan(householdId, from, today);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<readonly PlanEntryRow[]>(key);

      queryClient.setQueryData<readonly PlanEntryRow[]>(key, (existing = []) => {
        const added = planned.map((item) => ({
          id: `optimistic:${item.occurrenceKey}`,
          userId,
          choreId: item.choreId,
          occurrenceKey: item.occurrenceKey,
          plannedFor: today,
          // The same number that goes to the database. Previously the
          // optimistic row and the written row disagreed on every add.
          position: item.position,
        }));
        return [...existing, ...added];
      });

      return { snapshot };
    },

    onError: (_error, _items, context) => {
      if (householdId === null || context?.snapshot === undefined) return;
      queryClient.setQueryData(qk.plan(householdId, from, today), context.snapshot);
    },

    onSettled: () => {
      if (householdId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.planAll(householdId) });
    },
  });

  return {
    ...mutation,
    /** Reads, decides, then mutates. The order is the point. */
    mutate: (items: readonly Addable[]) => mutation.mutate(decide(items)),
  };
}

export function useRemoveFromPlan(today: CivilDate) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);

  return useMutation({
    mutationFn: async (occurrenceKey: string) => {
      if (userId === null) throw new Error('Please sign in again.');
      await removeFromPlan(userId, occurrenceKey, today);
    },

    onMutate: async (occurrenceKey) => {
      if (householdId === null || userId === null) return;
      const key = qk.plan(householdId, from, today);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<readonly PlanEntryRow[]>(key);

      queryClient.setQueryData<readonly PlanEntryRow[]>(key, (existing = []) =>
        existing.filter(
          (row) =>
            !(
              row.userId === userId &&
              row.occurrenceKey === occurrenceKey &&
              row.plannedFor === today
            ),
        ),
      );
      return { snapshot };
    },

    onError: (_error, _key, context) => {
      if (householdId === null || context?.snapshot === undefined) return;
      queryClient.setQueryData(qk.plan(householdId, from, today), context.snapshot);
    },

    onSettled: () => {
      if (householdId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.planAll(householdId) });
    },
  });
}

/*
 * Drag to reorder is deliberately absent.
 *
 * It was written first — a `useReorderPlan` mutation, `positionBetween`, and
 * `numeric` positions in the schema to support averaging — and none of it had a
 * caller, because the screen renders a plain list with no drag affordance. A
 * review found roughly seventy lines of prose across three files justifying a
 * feature that did not exist, and one of the untestable kind: the mutation
 * would have sent an optimistic `optimistic:<key>` id to Postgres as a uuid the
 * first time anyone dragged a just-added row.
 *
 * Tested, documented and unreachable is the shape that let the invite screen go
 * missing for four phases here. So it is removed until the gesture is built,
 * and the column stays `numeric` so building it needs no migration.
 */
