/**
 * What your routine owes you *right now*.
 *
 * Emily, on the routines half of Today: she *"kinda thought the routine tab
 * would be more prominent"*, and suggested a count of what is due at this point
 * in the day — what is outstanding in the bucket you are currently in, plus
 * anything from earlier buckets you have not done.
 *
 * That is a sharper question than "how many routine items are there today",
 * and the difference is the whole point. A badge showing everything on today's
 * routine reads as a to-do list and says the same thing all day; a badge
 * showing what has *come due* starts at zero each morning, rises as the day
 * moves through its buckets, and goes back to zero when you have caught up.
 * One of those is worth glancing at and the other is wallpaper.
 *
 * ── Deliberately not a shake ──────────────────────────────────────────────
 *
 * Jake floated an animated nudge on the tab and called it possibly overkill.
 * Agreed, and worth writing down rather than quietly dropping: an animation
 * you cannot dismiss is charming once and irritating by the third morning, it
 * cannot say *how much* is owed, and it fights `prefers-reduced-motion`. A
 * number is quieter and carries more.
 *
 * Pure, `Date`-free: the current time arrives as a `CivilTime` parameter like
 * every other clock reading in the engine.
 */

import type { CivilTime } from '../civil/types';
import { bucketStart, minutesFromDayStart, type TimeBucket } from './buckets';

/** Only the fields the count needs, so a fixture can stand in for the projection. */
export interface OwedCandidate {
  readonly ownerId: string;
  readonly bucket: TimeBucket;
  /** A specific time, or null when the item only claims a bucket. */
  readonly timeOfDay: CivilTime | null;
  readonly status: 'upcoming' | 'due' | 'completed' | 'missed';
}

/**
 * When an item comes due, measured from the day's 05:00 start.
 *
 * A timed item is owed from its own time — setting one is a statement that the
 * thing happens *then*, and rounding it down to its bucket would throw that
 * away and claim 21:00's medication was overdue at five in the afternoon. An
 * untimed item is owed from the start of the bucket it claims, because a bucket
 * means "sometime this evening" and the window opening is the honest moment.
 */
function owedFrom(item: OwedCandidate): number {
  return minutesFromDayStart(item.timeOfDay ?? bucketStart(item.bucket));
}

/**
 * How many of your own routine items have come due today and are not done.
 *
 * Includes earlier buckets, which is what makes it a nudge rather than a clock:
 * the thing you skipped this morning is still owed at three in the afternoon.
 *
 * `missed` counts for the same reason — on the day being viewed it is work
 * that came due and did not happen. It stops counting tomorrow, because a
 * missed routine never rolls forward.
 *
 * Somebody else's shared routine is never counted. A badge is a prompt to act,
 * and you cannot do their stretches.
 */
export function owedByNow(
  items: readonly OwedCandidate[],
  options: { readonly userId: string | null; readonly now: CivilTime },
): number {
  const { userId, now } = options;
  if (userId === null) return 0;

  const elapsed = minutesFromDayStart(now);

  return items.filter(
    (item) =>
      item.ownerId === userId &&
      (item.status === 'due' || item.status === 'missed') &&
      owedFrom(item) <= elapsed,
  ).length;
}

/**
 * The badge text, capped.
 *
 * `null` rather than `0` because that is what "no badge" has to be at the call
 * site — a zero would render as a circle containing a zero, which is the one
 * thing worse than no badge.
 */
export function owedBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}
