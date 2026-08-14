/**
 * Planning reminders for routine items, and merging them with chores.
 *
 * iOS keeps one queue. Two planners each producing up to sixty would overrun
 * it, and — worse — the transport's reconcile begins by cancelling everything,
 * so whichever ran second would erase the first's work entirely. There is
 * therefore exactly one merge, one cap and one reconcile, and this file owns
 * the first two.
 */

import { addDays, compareCivil, toEpochDay } from '../civil/date';
import type { CivilDate } from '../civil/types';
import type { ProjectedOccurrence } from '../occurrence/types';
import { describeBucket, fallsOnNextCalendarDay, type TimeBucket } from '../routines/buckets';
import type { RoutineOccurrence } from '../routines/project';
import {
  capReminders,
  keepAliveFor,
  planReminders,
  type PlannedReminder,
  type ReminderPolicy,
} from './plan';

/**
 * How far ahead routine reminders are scheduled.
 *
 * Three days, against thirty for chores. A daily routine reminding you three
 * weeks out is worthless — you open the app daily, and the keep-alive tops the
 * queue up — while planning it would cost thirty slots per item and crowd out
 * every chore reminder.
 */
export const ROUTINE_HORIZON_DAYS = 3;

/**
 * Roughly a third of the queue, kept for routines.
 *
 * Soft: unused slots are given back to chores, and vice versa. It exists so
 * that a person with a long routine cannot silence their chores, and a
 * household with many chores cannot silence a routine.
 */
export const ROUTINE_SHARE = 20;

/**
 * Sixty minus the keep-alive.
 *
 * `capReminders` truncates to sixty and the keep-alive is appended afterwards,
 * so without this the queue could reach sixty-one. Still under the operating
 * system's sixty-four, but the headroom exists precisely so nothing has to
 * reason about how close to the edge it is.
 */
const MERGE_BUDGET = 59;

/** Distinct from occurrence keys, because the transport schedules by id. */
const ITEM_PREFIX = 'routine:';
const BUCKET_PREFIX = 'routine-bucket:';

/**
 * One reminder per timed item, and one per bucket for everything untimed.
 *
 * Setting a time is a statement that the thing happens *then*, so it earns its
 * own notification. A bucket means "sometime this morning", and four items in
 * one morning do not deserve four buzzes at 05:00 — they deserve one saying
 * there are four. This is what keeps the queue affordable: a day costs at most
 * four grouped notifications plus one per timed item, rather than one per item.
 */
export function planRoutineReminders(input: {
  readonly occurrences: readonly RoutineOccurrence[];
  readonly today: CivilDate;
  readonly userId: string;
  readonly policy: ReminderPolicy;
}): readonly PlannedReminder[] {
  const { occurrences, today, userId, policy } = input;
  if (!policy.enabled || !policy.includeRoutines) return [];

  const horizonEnd = addDays(today, ROUTINE_HORIZON_DAYS);

  const candidates = occurrences.filter((occ) => {
    // Yours only. A local notification fires on the phone that scheduled it, so
    // planning somebody else's routine would buzz the wrong person — and their
    // routine is theirs to be reminded about.
    if (occ.ownerId !== userId) return false;
    if (!occ.remind) return false;
    if (occ.status === 'completed') return false;
    // Never the past: a reminder about a routine you missed on Tuesday helps
    // nobody, and the item is marked missed on its own day already.
    if (compareCivil(occ.dueOn, today) < 0) return false;
    if (compareCivil(occ.dueOn, horizonEnd) > 0) return false;
    return true;
  });

  const planned: PlannedReminder[] = [];
  /** One entry per (day, bucket) that has untimed items wanting a reminder. */
  const grouped = new Map<string, { date: CivilDate; bucket: TimeBucket; count: number }>();

  for (const occ of candidates) {
    if (occ.timeOfDay !== null) {
      planned.push({
        id: `${ITEM_PREFIX}${occ.occurrenceKey}`,
        choreId: occ.itemId,
        title: occ.title,
        body: 'In your routine today',
        // The routine day starts at 05:00, so a 00:30 item sits in tonight's
        // Night section and happens on tomorrow's date. Scheduling it against
        // `dueOn` would fire it a day early — or, for today, at an instant
        // already past, which the transport skips silently.
        onDate: fallsOnNextCalendarDay(occ.timeOfDay) ? addDays(occ.dueOn, 1) : occ.dueOn,
        atTime: occ.timeOfDay,
      });
      continue;
    }

    const key = `${occ.dueOn}::${occ.bucket}`;
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, { date: occ.dueOn, bucket: occ.bucket, count: 1 });
    else existing.count += 1;
  }

  for (const [key, group] of grouped) {
    planned.push({
      id: `${BUCKET_PREFIX}${key}`,
      // The bucket, not an item: tapping it should open the day rather than one
      // of several things it is about.
      choreId: group.bucket,
      title: `${describeBucket(group.bucket)} routine`,
      body: group.count === 1 ? '1 thing to do' : `${group.count} things to do`,
      onDate: group.date,
      // The chosen reminder time, not the bucket boundary. Morning begins at
      // 05:00 because the day does; that is not when anyone wants telling.
      atTime: policy.bucketTimes[group.bucket],
    });
  }

  return planned;
}

/**
 * Everything the phone should be reminded about, in one capped list.
 *
 * Each source is planned uncapped, then given a quota, then the union is
 * ordered and truncated once. Unused quota is handed to the other source, so
 * neither feature wastes slots the other could use.
 *
 * The keep-alive is appended last and from the merged plan, so it sits a day
 * before whatever actually fires last rather than before one source's last
 * item.
 */
export function planAllReminders(input: {
  readonly chores: readonly ProjectedOccurrence[];
  readonly routines: readonly RoutineOccurrence[];
  readonly today: CivilDate;
  readonly userId: string;
  readonly policy: ReminderPolicy;
}): readonly PlannedReminder[] {
  const { chores, routines, today, userId, policy } = input;
  if (!policy.enabled) return [];

  const chorePlan = planReminders({ occurrences: chores, today, userId, policy });
  const routinePlan = planRoutineReminders({ occurrences: routines, today, userId, policy });

  const nearestFirst = (a: PlannedReminder, b: PlannedReminder): number =>
    toEpochDay(a.onDate) - toEpochDay(b.onDate) || a.atTime.localeCompare(b.atTime);

  const routinesSorted = [...routinePlan].sort(nearestFirst);
  const choresSorted = [...chorePlan].sort(nearestFirst);

  // Give routines their share, then let chores have everything left — and if
  // routines did not use their share, chores get the remainder too.
  const routineQuota = Math.min(ROUTINE_SHARE, routinesSorted.length);
  const routinesKept = routinesSorted.slice(0, routineQuota);
  const choresKept = choresSorted.slice(0, Math.max(0, MERGE_BUDGET - routinesKept.length));

  const merged = capReminders([...choresKept, ...routinesKept]);
  const keepAlive = keepAliveFor(merged, policy);
  return keepAlive === null ? merged : [...merged, keepAlive];
}

/** True when a reminder came from a routine rather than a chore. */
export function isRoutineReminder(reminder: PlannedReminder): boolean {
  return reminder.id.startsWith(ITEM_PREFIX) || reminder.id.startsWith(BUCKET_PREFIX);
}
