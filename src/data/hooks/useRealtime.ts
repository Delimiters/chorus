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
import { useEffect, useRef } from 'react';
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
  'chore_completions',
  'chore_exceptions',
  'household_members',
  // Routine rows are mostly private, but a shared routine's state is exactly
  // what the other phone is rendering — a tick has to reach it. RLS decides
  // which rows actually arrive.
  'routine_items',
  'routine_completions',
] as const;

export function useRealtimeHousehold(): void {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    void channel.subscribe();

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
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      subscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [householdId, queryClient]);
}
