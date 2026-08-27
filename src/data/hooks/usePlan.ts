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

import { nextPosition, positionBetween, type PlanEntry } from '@/core/plan/plan';
import type { CivilDate } from '@/core/civil/types';
import {
  addToPlan,
  listPlanEntries,
  movePlanEntry,
  removeFromPlan,
  type PlanEntryRow,
} from '../api/plan';
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

/** How much your housemate has taken on today, for the one-line summary. */
export function useTheirPlanCount(today: CivilDate): number {
  const rows = usePlanEntries(today);
  const userId = useUserId();
  return useMemo(
    () => rows.filter((row) => row.userId !== userId && row.plannedFor === today).length,
    [rows, userId, today],
  );
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

  return useMutation({
    mutationFn: async (items: readonly Addable[]) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      const existing = queryClient.getQueryData<readonly PlanEntryRow[]>(
        qk.plan(householdId, from, today),
      );
      const mine = (existing ?? []).map((row) => ({
        occurrenceKey: row.occurrenceKey,
        choreId: row.choreId,
        plannedFor: row.plannedFor,
        position: row.position,
      }));

      // Positions assigned in one pass so a multi-add keeps the order it was
      // picked in, rather than every row claiming the same slot.
      let position = nextPosition(mine, today);
      await addToPlan(
        items.map((item) => ({
          householdId,
          userId,
          choreId: item.choreId,
          occurrenceKey: item.occurrenceKey,
          plannedFor: today,
          position: position++,
        })),
      );
    },

    onMutate: async (items) => {
      if (householdId === null || userId === null) return;
      const key = qk.plan(householdId, from, today);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<readonly PlanEntryRow[]>(key);

      queryClient.setQueryData<readonly PlanEntryRow[]>(key, (existing = []) => {
        const mine = existing.map((row) => ({
          occurrenceKey: row.occurrenceKey,
          choreId: row.choreId,
          plannedFor: row.plannedFor,
          position: row.position,
        }));
        let position = nextPosition(mine, today);
        const added = items
          // Already planned is a no-op, matching `ignoreDuplicates` on the
          // write. Without this the optimistic list shows a duplicate that the
          // refetch then silently removes, which looks like a dropped tap.
          .filter(
            (item) =>
              !existing.some(
                (row) =>
                  row.userId === userId &&
                  row.occurrenceKey === item.occurrenceKey &&
                  row.plannedFor === today,
              ),
          )
          .map((item) => ({
            id: `optimistic:${item.occurrenceKey}`,
            userId,
            choreId: item.choreId,
            occurrenceKey: item.occurrenceKey,
            plannedFor: today,
            position: position++,
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

/** Drag to reorder. One row moves, one row is written. */
export function useReorderPlan(today: CivilDate) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);

  return useMutation({
    mutationFn: async ({
      occurrenceKey,
      position,
    }: {
      occurrenceKey: string;
      position: number;
    }) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      const rows = queryClient.getQueryData<readonly PlanEntryRow[]>(
        qk.plan(householdId, from, today),
      );
      const row = (rows ?? []).find(
        (r) => r.userId === userId && r.occurrenceKey === occurrenceKey && r.plannedFor === today,
      );
      if (row === undefined) return;
      await movePlanEntry(row.id, position);
    },

    onMutate: async ({ occurrenceKey, position }) => {
      if (householdId === null || userId === null) return;
      const key = qk.plan(householdId, from, today);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<readonly PlanEntryRow[]>(key);

      queryClient.setQueryData<readonly PlanEntryRow[]>(key, (existing = []) =>
        existing.map((row) =>
          row.userId === userId && row.occurrenceKey === occurrenceKey && row.plannedFor === today
            ? { ...row, position }
            : row,
        ),
      );
      return { snapshot };
    },

    onError: (_error, _input, context) => {
      if (householdId === null || context?.snapshot === undefined) return;
      queryClient.setQueryData(qk.plan(householdId, from, today), context.snapshot);
    },

    onSettled: () => {
      if (householdId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.planAll(householdId) });
    },
  });
}

export { positionBetween };
