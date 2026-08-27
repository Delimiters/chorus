/**
 * "This one, this week."
 *
 * A flag is raised on a date and is live only while that date falls inside the
 * week you are currently looking at. Nothing clears it: next Monday arrives and
 * last week's flags are simply no longer this week's.
 *
 * That is the whole mechanism, and it is deliberate. The alternative — a
 * boolean plus a job that empties it every Monday — needs a scheduler, a
 * decision about what "Monday" means for a household that starts its week on
 * Sunday, and a second place where that decision lives. Expiry by comparison
 * has none of those: it is a pure function of two dates and a setting the
 * household already has.
 *
 * The trade is that a flag from March is still a row in the database. It costs
 * a few bytes and cannot affect anything, and re-flagging is an upsert rather
 * than a resurrection.
 */

import { startOfWeek } from '../civil/date';
import type { CivilDate, Weekday } from '../civil/types';

/** A flag as the engine needs it. The database row carries more. */
export interface ChoreFlag {
  readonly choreId: string;
  readonly userId: string;
  readonly flaggedOn: CivilDate;
}

/**
 * Is this flag live on the day being viewed?
 *
 * Compared by week rather than by age: a flag raised on Sunday is live for one
 * day if the week starts on Monday, and for seven if it starts on Sunday. "Is
 * it still this week" is the question people actually mean, and "is it less
 * than seven days old" only coincides with it by accident.
 */
export function isFlagLive(flag: ChoreFlag, on: CivilDate, weekStartsOn: Weekday): boolean {
  return startOfWeek(flag.flaggedOn, weekStartsOn) === startOfWeek(on, weekStartsOn);
}

/**
 * The chore ids one person has flagged for the week containing `on`.
 *
 * A set rather than a list: every caller is asking "is this one flagged", and
 * handing back an array invites a linear scan inside a render loop.
 */
export function liveFlagsFor(
  flags: readonly ChoreFlag[],
  userId: string,
  on: CivilDate,
  weekStartsOn: Weekday,
): ReadonlySet<string> {
  const live = new Set<string>();
  for (const flag of flags) {
    if (flag.userId !== userId) continue;
    if (isFlagLive(flag, on, weekStartsOn)) live.add(flag.choreId);
  }
  return live;
}

/**
 * Everyone's live flags, by chore.
 *
 * Seeing that your housemate is worried about the car inspection is most of
 * the point — it is how "this is on my mind" gets said without a conversation.
 * Keyed by chore so a row can ask one question.
 */
export function liveFlagsByChore(
  flags: readonly ChoreFlag[],
  on: CivilDate,
  weekStartsOn: Weekday,
): ReadonlyMap<string, readonly string[]> {
  const byChore = new Map<string, string[]>();
  for (const flag of flags) {
    if (!isFlagLive(flag, on, weekStartsOn)) continue;
    const existing = byChore.get(flag.choreId);
    if (existing === undefined) byChore.set(flag.choreId, [flag.userId]);
    else existing.push(flag.userId);
  }
  return byChore;
}

/**
 * Flagged first, then whatever order the caller already chose.
 *
 * A stable partition rather than a sort: the list arriving here has already
 * been ordered by urgency or priority, and re-sorting would throw that away.
 * Flagging something moves it to the top of its section without scrambling
 * everything underneath — which is what "pin this" means to the person doing
 * it, and is why `Array.prototype.sort` being stable is load-bearing here
 * rather than incidental.
 */
export function flaggedFirst<T extends { readonly choreId: string }>(
  items: readonly T[],
  flagged: ReadonlySet<string>,
): readonly T[] {
  if (flagged.size === 0) return items;
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (flagged.has(item.choreId)) pinned.push(item);
    else rest.push(item);
  }
  return [...pinned, ...rest];
}

/**
 * What the flag should become when tapped.
 *
 * Returns the date to store, or null to remove it. A flag raised in a previous
 * week is *not* live, so tapping it raises it again for this week rather than
 * clearing something the person cannot see — the alternative makes the first
 * tap on a stale flag appear to do nothing at all.
 */
export function toggleFlag(
  existing: ChoreFlag | undefined,
  on: CivilDate,
  weekStartsOn: Weekday,
): CivilDate | null {
  if (existing === undefined) return on;
  return isFlagLive(existing, on, weekStartsOn) ? null : on;
}
