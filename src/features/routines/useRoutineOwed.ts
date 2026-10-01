/**
 * The badge on the Routines segment of Today.
 *
 * Emily: she *"kinda thought the routine tab would be more prominent"*. The
 * segment sits next to Plan with nothing to say it has anything in it, so the
 * personal half of Today reads as the one you have already dealt with.
 *
 * What it counts is in `src/core/routines/owed.ts`, and the choice there is the
 * whole feature: what has **come due** by now, not what exists today. A count
 * of everything says the same thing all day and becomes wallpaper; a count of
 * what is owed starts at nothing each morning, climbs as the day moves through
 * its buckets, and returns to nothing when you have caught up.
 *
 * Only ever called from `ModeSwitch`, which is a leaf — `useNowTime` polls once
 * a minute, and anything that re-renders on that tick re-renders once a minute
 * for as long as Today is open.
 */

import { owedBadge, owedByNow } from '@/core/routines/owed';
import { useHousehold } from '@/data/hooks/useHousehold';
import { useRoutineDay } from '@/data/hooks/useRoutines';
import { useNowTime, useToday } from '@/data/today';
import { useUserId } from '@/stores/sessionStore';

/** What the Routines segment should show — `null` for no badge. */
export function useRoutineOwedBadge(): string | null {
  const household = useHousehold();
  const timeZone = household.data?.timeZone ?? 'UTC';
  const today = useToday(timeZone);
  const now = useNowTime(timeZone);
  const userId = useUserId();

  /*
   * `showOthers: false`, always. The badge is a prompt to act and you cannot do
   * your housemate's stretches — and the count filters by owner anyway, so
   * fetching theirs would be work thrown away. It is the same query key the
   * Routines screen uses when the preference is off, so the two share a cache
   * rather than racing.
   */
  const { occurrences } = useRoutineDay(today, { showOthers: false });

  return owedBadge(owedByNow(occurrences, { userId, now }));
}
