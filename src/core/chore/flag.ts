/**
 * "This one, until it is done."
 *
 * A flag lives until somebody lifts it or the chore is completed. There is no
 * expiry to compute: a row that exists is a live flag, and the database
 * deletes it the moment a completion lands — see
 * supabase/migrations/20260921120000_flags_last_until_done.sql.
 *
 * ── It used to expire by the week, and that was argued for ────────────────
 *
 * A flag was live only while `flaggedOn` fell inside the week being viewed,
 * which needed no scheduler and no decision about what "Monday" means for a
 * household that starts its week on Sunday. All true, and beside the point:
 * Jake — *"I don't like this whole 'flag it for the week' thing. It should
 * stay flagged until you either unflag it or it gets done."* A week is an
 * arbitrary boundary, and the worry that made you flag something does not end
 * at one.
 *
 * What it costs is a rule the client cannot enforce alone, which is why the
 * clearing is a trigger rather than three call sites that each have to
 * remember. See docs/DECISIONS.md.
 */

import type { CivilDate } from '../civil/types';

/** A flag as the engine needs it. The database row carries more. */
export interface ChoreFlag {
  readonly choreId: string;
  readonly userId: string;
  /** When it was raised. A record, not an expiry — nothing here reads it. */
  readonly flaggedOn: CivilDate;
}

/**
 * Everyone's flags, by chore.
 *
 * There is no by-person counterpart. `liveFlagsFor(flags, userId)` existed
 * until flags became shared, and then had exactly one caller passing exactly
 * one id — the signed-in person's — which is the composition the plan's
 * proposal got wrong. Deleted rather than left available.
 *
 * Seeing that your housemate is worried about the car inspection is most of
 * the point — it is how "this is on my mind" gets said without a conversation.
 * Keyed by chore so a row can ask one question.
 */
export function liveFlagsByChore(
  flags: readonly ChoreFlag[],
): ReadonlyMap<string, readonly string[]> {
  const byChore = new Map<string, string[]>();
  for (const flag of flags) {
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
 * Returns the date to store, or null to remove it.
 *
 * There is no stale-flag case left to handle. It used to matter: a flag from a
 * previous week was invisible but still a row, so tapping had to re-raise it
 * rather than delete something the person could not see. Now every row on a
 * chore is a flag you can see, so the tap simply means the opposite of
 * whatever is there.
 */
export function toggleFlag(existing: ChoreFlag | undefined, on: CivilDate): CivilDate | null {
  return existing === undefined ? on : null;
}
