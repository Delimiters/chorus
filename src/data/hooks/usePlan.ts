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
import {
  addToPlan,
  listPlanEntries,
  movePlanEntry,
  dismissFromPlan,
  listPlanDismissals,
  removeFromPlan,
  undismissFromPlan,
  type PlanDismissalRow,
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

/**
 * Whether the plan itself has arrived.
 *
 * Separate from the chores query, and nothing orders the two — so anything that
 * acts on "what is already planned" has to wait for this as well, or it will
 * decide that a full plan is empty and add everything a second time.
 */
export function usePlanLoading(today: CivilDate): boolean {
  const householdId = useActiveHouseholdId();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);
  const query = useQuery({
    queryKey: qk.plan(householdId ?? '__none__', from, today),
    queryFn: householdId === null ? skipToken : () => listPlanEntries(householdId, from, today),
  });
  return query.isLoading;
}

/**
 * Whether the plan is unknown rather than empty.
 *
 * `usePlanEntries` returns `EMPTY` for loading, for a failed fetch and for a
 * genuinely empty day alike, which is fine for "what do I add to" and wrong for
 * anything that makes a *claim*. Saying "Sam hasn't planned today" while the
 * query is in flight — or has failed — is a confident, checkable statement
 * about another person, made out of not having asked yet.
 */
export function usePlanUnavailable(today: CivilDate): boolean {
  const householdId = useActiveHouseholdId();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);
  const query = useQuery({
    queryKey: qk.plan(householdId ?? '__none__', from, today),
    queryFn: householdId === null ? skipToken : () => listPlanEntries(householdId, from, today),
  });
  return query.isLoading || query.isError;
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

/**
 * How much your housemate planned today, finished or not.
 *
 * Distinct from `useTheirPlanCount`, which is what they have *left*. The
 * shared celebration needs both: "you both finished" is only true if they had a
 * plan at all, and an empty plan is not an achievement.
 */
export function useTheirPlanTotal(
  today: CivilDate,
  available: readonly { occurrenceKey: string }[],
): number {
  const rows = usePlanEntries(today);
  const userId = useUserId();
  return useMemo(() => {
    /*
     * Cross-checked against what exists, exactly as `useTheirPlanCount` is.
     *
     * Without it, a plan made entirely of ghost entries — an archived chore, a
     * schedule edited so the key moved — gives `total > 0` and `outstanding
     * === 0`, and the app announces "You both finished" with confetti for a day
     * in which they finished nothing. The sibling hook's own comment warns
     * about exactly this and the second one shipped without the check.
     */
    const live = new Set(available.map((item) => item.occurrenceKey));
    return rows.filter(
      (row) => row.userId !== userId && row.plannedFor === today && live.has(row.occurrenceKey),
    ).length;
  }, [rows, userId, today, available]);
}

/**
 * Your housemate's day, in the order they put it in.
 *
 * Editable, as of 2026-09-07 — see docs/DECISIONS.md. This used to say the
 * opposite, and said it confidently: every write policy required
 * `user_id = auth.uid()` and `plan.test.sql` asserted that Bob could neither
 * reorder nor delete Alice's day. Both were true then and neither is now.
 *
 * Cross-checked against what still exists, exactly as the two count hooks are:
 * an entry whose chore was archived, or whose schedule moved the occurrence
 * key, would otherwise render as a row with no title.
 */
export function useTheirPlanEntries(
  today: CivilDate,
  available: readonly { occurrenceKey: string }[],
): readonly PlanEntryRow[] {
  const rows = usePlanEntries(today);
  const userId = useUserId();
  return useMemo(() => {
    const live = new Set(available.map((item) => item.occurrenceKey));
    /*
     * `[...].sort` rather than `toSorted`: nothing else in this codebase uses
     * the ES2023 copying methods, and whether Hermes ships them on this RN is
     * an assumption rather than something checked. `filter` already returns a
     * fresh array, so the spread is free of consequence either way.
     */
    return [
      ...rows.filter(
        (row) => row.userId !== userId && row.plannedFor === today && live.has(row.occurrenceKey),
      ),
      // Tie broken by key, as `planFor` does when it renders their own device.
      // `position` alone is not a total order, and two devices resolving a tie
      // differently would show the same day in two orders.
    ].sort((a, b) => a.position - b.position || a.occurrenceKey.localeCompare(b.occurrenceKey));
  }, [rows, userId, today, available]);
}

/** Which row, on whose day. `ownerId` absent means your own. */
export interface PlanTarget {
  readonly occurrenceKey: string;
  readonly ownerId?: string | undefined;
  /**
   * The chore this occurrence belongs to, so a removal can be named.
   *
   * A dismissal is keyed by occurrence, and an occurrence key is a string the
   * database cannot parse back into a chore without reimplementing the engine
   * — so the caller, which has the row in hand, carries it.
   */
  readonly choreId?: string | undefined;
}

interface Addable {
  readonly occurrenceKey: string;
  readonly choreId: string;
}

export function useAddToPlan(
  today: CivilDate,
  ownerId?: string,
  /**
   * True when the automatic fill is the caller rather than a person.
   *
   * It decides `added_by`, and therefore whether the other phone hears about
   * it. The fill writes these rows constantly — both devices fill both plans —
   * so announcing them would mean a notification per chore per morning, which
   * is how somebody learns to ignore notifications entirely.
   */
  automatic = false,
) {
  const householdId = useActiveHouseholdId();
  const me = useUserId();
  /*
   * Whose day is being added to. Both plans are editable, and this was the one
   * mutation never threaded — so "Add something" under your housemate's section
   * silently wrote to your own, which reads as a dead button.
   */
  const userId = ownerId ?? me;
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
    mutationFn: async ({
      rows: planned,
      requested,
    }: {
      rows: readonly (Addable & { position: number })[];
      requested: readonly Addable[];
    }) => {
      if (householdId === null || userId === null) throw new Error('Please sign in again.');
      await addToPlan(
        planned.map((item) => ({
          householdId,
          userId,
          choreId: item.choreId,
          occurrenceKey: item.occurrenceKey,
          plannedFor: today,
          position: item.position,
          addedBy: automatic ? null : userId,
        })),
      );
      /*
       * And take back any "I don't want this today".
       *
       * Putting something on the plan by hand is the opposite of having taken
       * it off, so the record has to go — otherwise removing it a second time
       * and expecting it back tomorrow would work, while the fill in between
       * would quietly skip it.
       */
      await undismissFromPlan({
        userId,
        /*
         * Everything the caller asked for, not just what `decide` kept.
         * `decide` drops anything already on today's plan, and those are
         * exactly the rows whose stale dismissal would otherwise survive —
         * harmless while the entry exists, and wrong the moment it is removed
         * and expected back.
         */
        occurrenceKeys: requested.map((item) => item.occurrenceKey),
        dismissedOn: today,
      });
    },

    onMutate: async ({ rows: planned }) => {
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
      void queryClient.invalidateQueries({
        queryKey: qk.planDismissals(householdId, from, today),
      });
    },
  });

  return {
    ...mutation,
    /** Reads, decides, then mutates. The order is the point. */
    mutate: (
      items: readonly Addable[],
      options?: { onSuccess?: () => void; onError?: () => void; onSettled?: () => void },
    ) => mutation.mutate({ rows: decide(items), requested: items }, options),
  };
}

/**
 * What has been taken off either plan, for the days in view.
 *
 * The fill reads this and skips anything in it, which is what lets the fill
 * run on every render instead of once a day. Recording the *removals* rather
 * than the fact that a fill happened is the whole of the idea — see
 * 20260925090000_plan_dismissals.sql.
 */
export function usePlanDismissals(today: CivilDate): {
  readonly dismissals: readonly PlanDismissalRow[];
  readonly isLoading: boolean;
  /**
   * Whether this query has ever come back — answered or failed.
   *
   * Separate from `isLoading` because they are needed for opposite jobs. The
   * *fill* must not act on a stale or absent answer, so it waits on
   * `isLoading`, which stays true through refetches and through a permanent
   * failure. The *screen* must not be held hostage to that: gating the first
   * paint on it stranded the user on a placeholder forever when the query
   * errored, with the error state unreachable behind it — and flashed the
   * placeholder back on every remount once the cache went stale.
   *
   * A failure counts as answered. It means "we asked and we know how that
   * went", which is enough to draw a screen, and the fill stays blocked on
   * `isLoading` regardless.
   */
  readonly answered: boolean;
} {
  const householdId = useActiveHouseholdId();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);

  const query = useQuery({
    queryKey: qk.planDismissals(householdId ?? '__none__', from, today),
    queryFn: householdId === null ? skipToken : () => listPlanDismissals(householdId, from, today),
  });

  /*
   * `isLoading` is returned, not swallowed, and the fill has to wait for it.
   *
   * The first version handed back only the rows. An empty list then meant both
   * "nothing was taken off" and "we have not asked yet", and the fill cannot
   * tell those apart — so on any render where the plan query had resolved and
   * this one had not, it re-added everything the user had removed.
   *
   * That is not merely a flicker. The fill's `add` clears dismissals for what
   * it adds, so the stale-window refill *deletes the record*: the chore comes
   * back and the fact that you removed it is gone for good.
   *
   * `useOccurrences` makes this exact argument about its own queries, one hook
   * away — *"PlanView does not merely render that answer, it writes plan rows
   * from it"*. This was the one query the rule had not been applied to.
   */
  /*
   * `isFetching`, not just `isLoading`, and the distinction is the whole bug
   * Emily reported — *"I keep taking things off today and they come back lol"*.
   *
   * `isLoading` is only true for a query that has never resolved. Once there is
   * data in the cache, a refetch leaves it false and hands back the **old**
   * rows while the new ones are in flight. Every removal invalidates this query,
   * and so does every realtime change from the other phone — so the window
   * where the fill sees a stale "nothing was taken off" is not a rare startup
   * race, it is the moment immediately after every single removal.
   *
   * The local half of that is fixed where it should be, by patching the
   * dismissal into the cache in `onMutate`. This closes the other half: a
   * removal made on *her* phone reaches this one as an invalidation, and until
   * the refetch lands this phone has no idea it happened.
   *
   * `isError` is in there too, and for the third time the same argument. A
   * failed fetch leaves `data` undefined, so `dismissals` falls back to the
   * empty list while both `isLoading` and `isFetching` are false — and the
   * fill cannot tell "nothing was taken off" from "we asked and it broke".
   * Open the app on a flaky morning having removed three chores earlier and
   * all three come back; worse, `add` calls `undismissFromPlan`, so the three
   * records are deleted and tomorrow does not fix it.
   *
   * Collapsed into one flag rather than returned as three, because every
   * caller writes plan rows from the answer — there is no caller for whom
   * "stale, absent or broken but present" is good enough, so there is no
   * reason to let one pick wrong. The name is now a slight lie and the
   * alternative was three booleans nobody would combine correctly.
   */
  return {
    dismissals: query.data ?? EMPTY_DISMISSALS,
    isLoading: query.isLoading || query.isFetching || query.isError,
    answered: query.data !== undefined || query.isError,
  };
}

const EMPTY_DISMISSALS: readonly PlanDismissalRow[] = [];

export function useRemoveFromPlan(today: CivilDate) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);

  /*
   * Takes whose day to remove from, defaulting to your own.
   *
   * Both plans are editable by either housemate — see docs/DECISIONS.md — so a
   * mutation hard-wired to `auth.uid()` can only ever edit half the screen.
   */
  return useMutation({
    mutationFn: async ({ occurrenceKey, ownerId, choreId }: PlanTarget) => {
      const owner = ownerId ?? userId;
      // `userId` too, not just `owner`: with `ownerId` passed explicitly the
      // fallback never runs, so a signed-out session would otherwise reach
      // `dismissedBy` as null and record a removal nobody made.
      if (owner === null || userId === null || householdId === null) {
        throw new Error('Please sign in again.');
      }

      /*
       * The record first, then the delete — which is the ordering that fails
       * better, and it took a review to see that the first version had it
       * backwards.
       *
       * These are two writes with no transaction between them, so one of them
       * can land alone. Delete-first leaves the worst outcome: the row is gone
       * from the plan and nothing says it was deliberate, so the very next
       * fill puts it back. Record-first leaves the harmless one: the row is
       * still on the plan and carries a dismissal that changes nothing while
       * it is planned, and is cleared if it is ever added again by hand.
       *
       * The original argued the opposite, on the grounds that a dismissal for
       * a still-planned row would make the fill "skip it forever". It would
       * not: a dismissal carries `dismissed_on` and the fill only honours
       * today's, so the blast radius is the rest of the day.
       */
      await dismissFromPlan({
        householdId,
        userId: owner,
        occurrenceKey,
        dismissedOn: today,
        // Whose day it came off is `owner`; this is who did it, and the two
        // differing is exactly what makes it worth telling them about.
        dismissedBy: userId,
        choreId: choreId ?? null,
      });
      await removeFromPlan(owner, occurrenceKey, today);
    },

    /*
     * ── Both halves of the removal, or the fill undoes it ─────────────────
     *
     * Emily: *"Chorus is glitching I keep taking things off today and they come
     * back lol"*. She was right, and it was not user error.
     *
     * Taking something off is two facts: the entry goes, and a dismissal says
     * that was deliberate. Only the first was patched here; the second had to
     * make a round trip. And `isLoading` does not cover that gap — on a query
     * that already has data it is false for a background refetch — so the
     * fill's `dismissalsLoading` guard waved it through. The fill then saw the
     * entry gone and no dismissal, concluded the chore was unplanned and
     * un-dismissed, and put it straight back. Worse, the re-add calls
     * `undismissFromPlan`, which deleted the dismissal as it landed. So the
     * chore came back *and* the record of not wanting it was erased, which is
     * why it kept happening.
     *
     * Both facts now land in the cache in the same tick as each other.
     */
    onMutate: async ({ occurrenceKey, ownerId }) => {
      const owner = ownerId ?? userId;
      if (householdId === null || owner === null) return;
      const key = qk.plan(householdId, from, today);
      const dismissalKey = qk.planDismissals(householdId, from, today);
      const snapshot = queryClient.getQueryData<readonly PlanEntryRow[]>(key);
      const dismissalSnapshot = queryClient.getQueryData<readonly PlanDismissalRow[]>(dismissalKey);

      queryClient.setQueryData<readonly PlanEntryRow[]>(key, (existing = []) =>
        existing.filter(
          (row) =>
            !(
              row.userId === owner &&
              row.occurrenceKey === occurrenceKey &&
              row.plannedFor === today
            ),
        ),
      );

      queryClient.setQueryData<readonly PlanDismissalRow[]>(dismissalKey, (existing = []) => {
        // The table's own unique key, so a double tap is one fact here too.
        const already = existing.some(
          (d) => d.userId === owner && d.occurrenceKey === occurrenceKey && d.dismissedOn === today,
        );
        if (already) return existing;
        return [...existing, { userId: owner, occurrenceKey, dismissedOn: today }];
      });

      /*
       * Written first, cancelled second — the same ordering `useReorderPlan`
       * documents a few hundred lines down, and for the same reason. Awaiting
       * `cancelQueries` first pushes the patch a microtask or more past the
       * render that needs it, and the render that needs it here is the fill
       * deciding whether this chore is still wanted today.
       */
      await queryClient.cancelQueries({ queryKey: key });
      await queryClient.cancelQueries({ queryKey: dismissalKey });

      return { snapshot, dismissalSnapshot };
    },

    onError: (_error, _key, context) => {
      if (householdId === null) return;
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData(qk.plan(householdId, from, today), context.snapshot);
      }
      // Rolled back too. A dismissal left behind for a row that is back on the
      // plan would make the next removal look like it had already happened.
      if (context?.dismissalSnapshot !== undefined) {
        queryClient.setQueryData(
          qk.planDismissals(householdId, from, today),
          context.dismissalSnapshot,
        );
      }
    },

    onSettled: () => {
      if (householdId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.planAll(householdId) });
      void queryClient.invalidateQueries({
        queryKey: qk.planDismissals(householdId, from, today),
      });
    },
  });
}

/**
 * Move one row, and write one row.
 *
 * The position is computed by the caller from its new neighbours, so a drag
 * costs a single update rather than renumbering the day — which is what lets
 * two people reorder at once and stay two independent facts rather than a merge
 * conflict.
 *
 * A row that has not been persisted yet is skipped rather than sent: its id is
 * the optimistic `optimistic:<key>`, and Postgres would reject that as a uuid.
 * The refetch that follows the add gives it a real id a moment later.
 */
export function useReorderPlan(today: CivilDate) {
  const householdId = useActiveHouseholdId();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const from = shiftDays(today, -PLAN_LOOKBACK_DAYS);

  const rowFor = (occurrenceKey: string, ownerId?: string) => {
    const owner = ownerId ?? userId;
    return (
      queryClient.getQueryData<readonly PlanEntryRow[]>(
        qk.plan(householdId ?? '__none__', from, today),
      ) ?? []
    ).find(
      (r) => r.userId === owner && r.occurrenceKey === occurrenceKey && r.plannedFor === today,
    );
  };

  const mutation = useMutation({
    mutationFn: async ({ id, position }: { id: string; position: number }) => {
      if (id.startsWith('optimistic:')) return;
      await movePlanEntry(id, position);
    },

    /*
     * Written first, cancelled second — the order is what makes a drop settle.
     *
     * `cancelQueries` aborts in-flight fetches, and awaiting it before touching
     * the cache pushed the optimistic reorder a frame or more past the moment
     * the finger lifted. So the row visibly returned to where it started and
     * then jumped to where it had been put: Jake's "jumpy when you drop it".
     * The write is local and synchronous; nothing about it needs the
     * cancellation to have finished, and cancelling immediately afterwards
     * still stops an in-flight refetch overwriting it.
     */
    onMutate: async ({ id, position }) => {
      if (householdId === null) return;
      const key = qk.plan(householdId, from, today);
      const snapshot = queryClient.getQueryData<readonly PlanEntryRow[]>(key);

      queryClient.setQueryData<readonly PlanEntryRow[]>(key, (existing = []) =>
        existing.map((row) => (row.id === id ? { ...row, position } : row)),
      );

      await queryClient.cancelQueries({ queryKey: key });
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

  return {
    ...mutation,
    /*
     * Reads the row, decides the position, then mutates — the order that the
     * flag hook and the add hook both got wrong by re-deriving inside
     * `mutationFn`, which runs *after* `onMutate` has already changed the cache.
     */
    mutate: (occurrenceKey: string, position: number, ownerId?: string | undefined) => {
      const row = rowFor(occurrenceKey, ownerId);
      if (row === undefined) return;
      mutation.mutate({ id: row.id, position });
    },
  };
}

/*
 * The note below is kept because it is why this took two attempts.
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
