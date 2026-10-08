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

import type { CivilDate, CivilTime } from '../civil/types';
import { minutesIntoDay } from '../civil/daybreak';
import { DEFAULT_BUCKET_TIMES, type TimeBucket } from './buckets';

/**
 * Only the fields the count needs, so a fixture can stand in for the projection.
 *
 * `dueOn` is here because leaving it out was a defect, not an economy. The
 * projection the caller hands over spans a **whole quantised week** — that is
 * what `useRoutineDay` fetches — and without a day to compare against, every
 * incomplete occurrence from Sunday onward counted. One daily item read `5` on
 * a Thursday and `7` by Saturday.
 *
 * Worse than the arithmetic: a shape without `dueOn` cannot *express* the bug,
 * so no fixture could catch it, and `RoutineOccurrence` satisfied the narrower
 * shape structurally so it type-checked. That is the trap AGENTS.md names —
 * the wrong type being a subtype of the right one.
 */
export interface OwedCandidate {
  readonly ownerId: string;
  readonly dueOn: CivilDate;
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
 * away and claim 21:00's medication was overdue at five in the afternoon.
 *
 * An untimed item is owed from its bucket's **reminder** time, not from where
 * the bucket structurally begins. The two differ for exactly one bucket and it
 * is the one that matters: morning *starts* at 05:00, because that is where the
 * routine day is cut so that night is one span rather than two. Measuring from
 * there made every untimed morning item owed at five in the morning — so the
 * count did not start at zero and climb, it started at all of them. `buckets.ts`
 * already makes this argument against itself, which is why
 * `DEFAULT_BUCKET_TIMES.morning` is 07:00 and the reminder does not fire at the
 * boundary either.
 */
function owedFrom(item: OwedCandidate, dayStartsAtHour: number): number {
  return minutesIntoDay(item.timeOfDay ?? DEFAULT_BUCKET_TIMES[item.bucket], dayStartsAtHour);
}

/**
 * How many of your own routine items have come due today and are not done.
 *
 * Includes earlier buckets, which is what makes it a nudge rather than a clock:
 * the thing you skipped this morning is still owed at three in the afternoon.
 *
 * Today only. The caller's projection spans a whole week, so the day is a
 * parameter rather than an assumption — see `OwedCandidate.dueOn`.
 *
 * Somebody else's shared routine is never counted. A badge is a prompt to act,
 * and you cannot do their stretches.
 */
export function owedByNow(
  items: readonly OwedCandidate[],
  options: {
    readonly userId: string | null;
    /**
     * The day being counted, which is always today.
     *
     * Required, and the reason is the whole of the `dueOn` note above: the
     * caller's projection covers a week, and a count with no day in it counts
     * the week.
     */
    readonly today: CivilDate;
    readonly now: CivilTime;
    /**
     * The household's day break, which has to be the same origin `today` was
     * computed from.
     *
     * Both sides of the comparison below used `minutesFromDayStart`, whose zero
     * is the routine day's own fixed 05:00 — while `today` comes from the
     * household break. Where the two disagree the count is simply wrong: with a
     * break at noon, at 09:00 on Tuesday `today` is Monday, but "now" measured
     * four hours into *Tuesday's* routine day, so every Monday afternoon and
     * evening item silently stopped counting. Measuring both from the break
     * leaves bucket sorting alone and makes the comparison mean something.
     */
    readonly dayStartsAtHour: number;
  },
): number {
  const { userId, today, now, dayStartsAtHour } = options;
  if (userId === null) return 0;

  const elapsed = minutesIntoDay(now, dayStartsAtHour);

  return items.filter(
    (item) =>
      item.ownerId === userId &&
      item.dueOn === today &&
      /*
       * `due` alone, because for today's date it is the only incomplete status
       * the projector can produce: `statusOf` gives `upcoming` strictly in the
       * future and `missed` strictly in the past. The first version also
       * admitted `missed`, which read as "a skipped item still counts today"
       * and was in fact the clause letting the rest of the week in.
       */
      item.status === 'due' &&
      owedFrom(item, dayStartsAtHour) <= elapsed,
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
