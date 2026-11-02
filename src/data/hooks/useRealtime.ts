/**
 * Keeping two phones in step.
 *
 * One channel per household, and every change does the same broad thing:
 * invalidate the household key and let the queries refetch. No surgical cache
 * patching — a two-person household's entire dataset is a few kilobytes, and
 * surgical patching is where realtime bugs live. Correctness over cleverness.
 *
 * Two things make that cheap enough to be the obvious choice. The occurrence
 * list is *computed*, so a refetch of three small tables re-derives the whole
 * agenda with no extra round trips. And the invalidation is debounced, so
 * completing four chores in a row is one refetch rather than four.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useActiveHouseholdId } from '@/stores/sessionStore';
import { qk } from '../queryKeys';
import { supabase } from '../supabase';

/**
 * Long enough to coalesce a burst, short enough to feel immediate.
 *
 * A completion writes one row and the resulting UPDATE/INSERT events arrive
 * within milliseconds of each other; 250ms turns a flurry into one refetch
 * while staying well under the threshold where a change feels delayed.
 */
const DEBOUNCE_MS = 250;

/** Tables worth listening to. Each is something the agenda derives from. */
const TABLES = [
  'chores',
  // A flag raised on one phone should appear on the other: half its value is
  // saying "this is on my mind" without a conversation.
  'chore_flags',
  // A plan made on one phone should show on the other: seeing what your
  // housemate has taken on today is half the reason to share a list.
  'plan_entries',
  // What was taken off a plan on purpose. Published by its migration but
  // subscribed by nobody, so a removal reached the other phone only
  // incidentally — via the `plan_entries` delete — which is an unordered race
  // against the very refetch the fill depends on.
  'plan_dismissals',
  'chore_completions',
  'chore_exceptions',
  // Whose turn one occurrence is. A change on one phone has to reach the other,
  // or the two disagree about who is doing the bins tonight.
  'chore_turns',
  // The note board is the one place in the app two people might be typing at
  // once; a stale copy is exactly what makes last-write-wins feel arbitrary.
  'household_notes',
  'household_members',
  // Routine rows are mostly private, but a shared routine's state is exactly
  // what the other phone is rendering — a tick has to reach it. RLS decides
  // which rows actually arrive.
  'routine_items',
  'routine_completions',
  // Ticking a step is the other phone's business too, the same as ticking a
  // chore. The definitions are here so a step added on one phone appears on
  // the other without a manual refresh.
  'chore_subtasks',
  'chore_subtask_ticks',
] as const;

export function useRealtimeHousehold(): void {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Bumped to rebuild the channel after a failed join.
   *
   * A channel that has errored cannot be re-subscribed — the only way back is
   * a new one — so the retry re-runs this effect rather than calling
   * `subscribe` again on a corpse.
   */
  const [generation, setGeneration] = useState(0);
  /**
   * Consecutive failed joins, for the backoff.
   *
   * A ref rather than a local: the retry works by re-running this effect, so
   * anything held in the effect's own closure resets on every attempt and the
   * backoff never grows. Reset on a successful join.
   */
  const attempts = useRef(0);

  useEffect(() => {
    if (householdId === null) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
    };

    const schedule = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        invalidate();
      }, DEBOUNCE_MS);
    };

    const channel = supabase.channel(`household:${householdId}`);
    for (const table of TABLES) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          /**
           * Server-side filter, so another household's traffic never reaches
           * this device. RLS already stops it being *readable*; this stops it
           * being *sent*, which matters on a metered connection.
           *
           * It only works on DELETE where replica identity is FULL — otherwise
           * Postgres emits just the primary key and there is no `household_id`
           * to match on. The core schema sets FULL on `chore_completions` and
           * `chore_exceptions` for exactly this reason: un-ticking a chore and
           * undoing a skip are both deletes, and both need to reach the other
           * phone. `chores` does not need it (DELETE is revoked; archiving is an
           * update), and `household_members` will if a "leave household" action
           * is ever added.
           */
          filter: `household_id=eq.${householdId}`,
        },
        schedule,
      );
    }
    /**
     * Subscribing, and noticing when it fails.
     *
     * `void channel.subscribe()` threw the status away. A channel that never
     * joined — a dropped socket at the wrong moment, a token refresh landing
     * mid-handshake — left the phone with **no realtime at all**, silently and
     * for the life of the screen: this effect only re-runs when the household
     * or the query client changes, which is to say never. Jake:
     *
     * > "sometimes when emily archives or edits a chore on her daily plan, it
     * > still shows up on mine unchanged"
     *
     * `chores` is published and subscribed, so the delivery path was right;
     * what was missing was noticing that nobody was listening.
     *
     * Two things happen here. A failure retries with backoff, because one
     * failed join should not cost the session. And a *successful* join
     * invalidates once — realtime does not replay what happened while the
     * socket was down, so re-joining without catching up leaves exactly the
     * stale screen this is meant to prevent.
     */
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const join = () => {
      channel.subscribe((status) => {
        if (disposed) return;

        if (status === 'SUBSCRIBED') {
          attempts.current = 0;
          /*
           * Through the debounce, not straight to `invalidate`.
           *
           * A flapping connection joins repeatedly, and an un-debounced catch-up
           * refetched the whole household on each one — the storm the debounce
           * exists to stop, entered by the one path that skipped it.
           */
          schedule();
          return;
        }

        /*
         * `CLOSED` is also how a deliberate `removeChannel` reports itself, and
         * `disposed` above is what tells the two apart — without it, unmounting
         * would schedule a reconnect to a channel that no longer exists.
         */
        if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return;

        /*
         * 1s, 2s, 4s … capped at 30.
         *
         * The counter lives in a **ref**, not in this closure. As a local it
         * was re-initialised to zero every time the effect re-ran — and the
         * only thing that re-runs the effect is the retry itself, so the
         * backoff was a flat one-second loop for ever. On a phone with no
         * signal that is a websocket torn down and thirteen subscription
         * filters re-sent once a second, all night: precisely the hammering
         * this comment claimed to avoid.
         */
        const wait = Math.min(30_000, 1000 * 2 ** attempts.current);
        attempts.current += 1;
        if (retry !== null) clearTimeout(retry);
        retry = setTimeout(() => {
          retry = null;
          if (disposed) return;
          /*
           * A failed channel cannot be re-subscribed, so this rebuilds from
           * scratch by re-running the effect's own teardown and setup — which
           * is what bumping `generation` does.
           */
          setGeneration((n) => n + 1);
        }, wait);
      });
    };
    join();

    /**
     * Realtime does not replay what happened while the socket was down, so
     * coming back to the app needs one invalidation regardless — otherwise you
     * return to a list that is however stale as the time you were away.
     */
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') invalidate();
    };
    const subscription = AppState.addEventListener('change', onAppState);

    return () => {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      subscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [householdId, queryClient, generation]);
}
