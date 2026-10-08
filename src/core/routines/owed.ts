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
import { addDays } from '../civil/date';
import { dayOfWallClock, minutesIntoDay } from '../civil/daybreak';
import { DEFAULT_BUCKET_TIMES, fallsOnNextCalendarDay, type TimeBucket } from './buckets';

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
 * When an item comes due, as minutes into the household day that contains it.
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
function timeFor(item: OwedCandidate): CivilTime {
  return item.timeOfDay ?? DEFAULT_BUCKET_TIMES[item.bucket];
}

function owedFrom(item: OwedCandidate, dayStartsAtHour: number): number {
  return minutesIntoDay(timeFor(item), dayStartsAtHour);
}

/**
 * The household day an item actually happens on.
 *
 * Two boundaries, and this is the one place that has to reconcile them rather
 * than pick one. A routine occurrence's `dueOn` is a **routine** day, which runs
 * 05:00 to 05:00, so an item timed 04:00 on Monday happens on *Tuesday's*
 * calendar morning — that is what `fallsOnNextCalendarDay` encodes, and the
 * reminder for it is scheduled that way. Which **household** day that instant
 * falls in is then a separate question, answered by the break.
 *
 * Filtering on `dueOn === today` while measuring the clock from the break got
 * this wrong in both directions. A review caught the second one: with the break
 * at 3, a Night item timed 04:00 looked like it was due an hour into Monday,
 * so the badge counted it from Monday morning — twenty-three hours before the
 * reminder for it, and before the thing exists.
 */
function householdDayOf(item: OwedCandidate, dayStartsAtHour: number): CivilDate {
  const time = timeFor(item);
  const wall = fallsOnNextCalendarDay(time) ? addDays(item.dueOn, 1) : item.dueOn;
  return dayOfWallClock(wall, time, dayStartsAtHour);
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
    /**
     * The wall-clock time, which must come from the *same instant* as `today`.
     *
     * `useNowCivil` exists for that: read from two clocks these drifted for up
     * to a minute at the break, and 02:59 is the largest "minutes into the day"
     * there is — so every item of the new day counted as owed at once.
     */
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
      householdDayOf(item, dayStartsAtHour) === today &&
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
