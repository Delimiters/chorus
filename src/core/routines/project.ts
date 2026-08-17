/**
 * Turning routine items into the things a day is made of.
 *
 * The same shape as the chore projector and a fraction of the size, because a
 * routine has none of what makes chores complicated. There is no rotation — an
 * item has exactly one owner. There is no assignment, so no `everyone` fan-out
 * and no `unassignable`. There is no exceptions table, so no skip, no
 * reschedule, and therefore no `displaced` occurrences, no reschedule padding
 * and no supersession machinery. Skipping a personal routine is called not
 * ticking it.
 *
 * What is shared with chores is the part worth sharing: `expandOccurrences`
 * takes a plain string id and knows nothing about what it is expanding, so the
 * recurrence rules, the period keys and the occurrence keys are all the ones
 * already covered by property tests.
 *
 * Status is computed against **the real today**, not against the day being
 * viewed, and the difference is the whole value of the day history: scrolling
 * back to Wednesday should show that you missed your stretches, not that they
 * are merely outstanding. Passing the viewed day here instead makes `missed`
 * unreachable — every row the screen can show would be `due` or `completed` —
 * and it did, until the day navigation was used in anger.
 */

import { compareCivil } from '../civil/date';
import type { CalendarConfig, CivilDate, CivilTime, DateWindow } from '../civil/types';
import { expandOccurrences } from '../recurrence/expand';
import type { Occurrence, Schedule } from '../recurrence/types';
import { minutesFromDayStart, type TimeBucket } from './buckets';

/** A routine item, as the engine needs it. The database row carries more. */
export interface RoutineItemInput {
  readonly id: string;
  readonly title: string;
  readonly ownerId: string;
  readonly schedule: Schedule;
  /** Null when the item only names a bucket. */
  readonly timeOfDay: CivilTime | null;
  readonly bucket: TimeBucket;
  readonly linkedChoreId: string | null;
  readonly icon: string | null;
  readonly remind: boolean;
  /** Manual order within a bucket; null when never dragged. */
  readonly position: number | null;
  /** Soft-deleted items produce nothing. */
  readonly archived: boolean;
}

export interface RoutineCompletionInput {
  readonly routineItemId: string;
  readonly occurrenceKey: string;
  readonly completedOn: CivilDate;
}

/**
 * Derived, never stored.
 *
 * `missed` is only ever true for a day that has already finished — it is a
 * statement about that day, not a debt carried into the next one.
 */
export type RoutineStatus = 'upcoming' | 'due' | 'completed' | 'missed';

export interface RoutineOccurrence extends Occurrence {
  readonly itemId: string;
  readonly title: string;
  readonly ownerId: string;
  readonly bucket: TimeBucket;
  readonly timeOfDay: CivilTime | null;
  readonly linkedChoreId: string | null;
  readonly icon: string | null;
  readonly remind: boolean;
  readonly status: RoutineStatus;
  readonly completedOn: CivilDate | null;
  /**
   * Position within its day, with 05:00 as zero.
   *
   * Precomputed so every consumer sorts the same way, and so nothing is tempted
   * to compare `'HH:MM'` strings — which puts half past midnight above nine in
   * the evening. Untimed items sort after timed ones within their bucket.
   */
  readonly sortKey: number;
  /**
   * Where the owner dragged it, or null if they never have.
   *
   * Null is not zero. An item nobody has placed keeps its time order and sits
   * after everything that has been placed — so a list looks untouched until it
   * is reordered, and a new item joins the bottom of its bucket instead of the
   * middle of somebody's sequence.
   */
  readonly position: number | null;
}

/** Untimed items sit after every timed one in their bucket. */
const UNTIMED = Number.MAX_SAFE_INTEGER;

export function projectRoutineOccurrences(
  input: {
    readonly items: readonly RoutineItemInput[];
    readonly completions: readonly RoutineCompletionInput[];
    /** The real today, for deciding what is missed rather than merely not done. */
    readonly today: CivilDate;
  },
  calendar: CalendarConfig,
  window: DateWindow,
): readonly RoutineOccurrence[] {
  const { items, completions, today } = input;

  const completedOn = new Map<string, CivilDate>();
  for (const completion of completions) {
    completedOn.set(
      `${completion.routineItemId}::${completion.occurrenceKey}`,
      completion.completedOn,
    );
  }

  const projected: RoutineOccurrence[] = [];

  for (const item of items) {
    if (item.archived) continue;

    for (const occurrence of expandOccurrences(item.id, item.schedule, calendar, window, null)) {
      const done = completedOn.get(`${item.id}::${occurrence.occurrenceKey}`) ?? null;

      projected.push({
        ...occurrence,
        itemId: item.id,
        title: item.title,
        ownerId: item.ownerId,
        bucket: item.bucket,
        timeOfDay: item.timeOfDay,
        linkedChoreId: item.linkedChoreId,
        icon: item.icon,
        remind: item.remind,
        completedOn: done,
        status: statusOf(occurrence, done, today),
        sortKey: item.timeOfDay === null ? UNTIMED : minutesFromDayStart(item.timeOfDay),
        position: item.position,
      });
    }
  }

  return projected;
}

function statusOf(
  occurrence: Occurrence,
  completedOn: CivilDate | null,
  today: CivilDate,
): RoutineStatus {
  if (completedOn !== null) return 'completed';
  const relativeToToday = compareCivil(occurrence.dueOn, today);
  if (relativeToToday > 0) return 'upcoming';
  // Past and not done. Marked on its own day; it does not reappear tomorrow,
  // because a routine skipped on Tuesday is not work owed on Wednesday.
  if (relativeToToday < 0) return 'missed';
  return 'due';
}
