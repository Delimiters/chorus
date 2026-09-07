/**
 * What a person's day gets filled with, before they have chosen anything.
 *
 * Anything due or late goes onto the plan by itself — it is the baseline the
 * day starts from, and choosing it every morning was the friction the plan
 * exists to remove.
 *
 * **One-off work is included, and that is a reversal.** This added only
 * recurring chores, on the argument that a one-off is a decision and the
 * proposal is where decisions belong. Jake asked for the opposite: *"I want
 * both one time tasks that are due/overdue as well as any chore assigned to
 * 'Anyone' or 'Everyone does' to appear automatically in the daily plan."*
 *
 * The cost is real and worth knowing when reading this: on his household that
 * is 38 extra rows, the oldest three weeks old, taking a day from about 25 to
 * about 50. A day that long is the thing the plan was built to escape. If it
 * needs a limit later, an age cap on one-off work is the smallest one — but
 * that is a product decision, not a correctness one, and it is not made here.
 *
 * ── Why this is here rather than inline in the effect that uses it ─────────
 *
 * It has two callers, and they must agree. The auto-plan itself runs on *your*
 * device for *your* day; the plan screen also shows a housemate's day, and when
 * they have not opened the app there is nothing to show — so it offers what
 * their day will be filled with when they do. Jake, on being shown an empty
 * sheet: *"is it going to show me the stuff that will automatically be on her
 * list regardless of if she's logged in?"*
 *
 * Two copies of that rule would drift, and the drift would be invisible: the
 * preview would quietly stop matching what actually lands.
 *
 * The clock stays outside: `on` is passed in because this module never reads
 * one. Nothing about the chore's *schedule* is consulted any more — see the
 * one-off reversal above — so an occurrence is all it needs.
 */

import type { CivilDate } from '../civil/types';

interface Plannable {
  readonly occurrenceKey: string;
  readonly dueOn: CivilDate;
  readonly status: string;
  readonly assignee: { readonly kind: string; readonly memberId?: string };
}

/**
 * Whether an occurrence is a given person's to do.
 *
 * `anyone` counts for everybody — an unassigned chore is on both your lists
 * until one of you does it, which is what "anyone" means.
 */
export function belongsTo(item: Plannable, userId: string): boolean {
  return (
    item.assignee.kind === 'anyone' ||
    (item.assignee.kind === 'member' && item.assignee.memberId === userId)
  );
}

interface Options {
  /** Whose day. */
  readonly userId: string;
  /** The day being filled. */
  readonly on: CivilDate;
  /**
   * Occurrence keys already spoken for that day — **anybody's plan, not only
   * this person's**.
   *
   * `anyone` work counts for everyone, so each device auto-planned its own copy
   * and the shared chore appeared on both plans at once. With both days on one
   * screen that is the same row twice, one above the other, and at this
   * household's size roughly half the screen. It also produced duplicate React
   * keys and duplicate test ids for the same occurrence.
   *
   * Whoever's plan claims it first keeps it, which is what "anyone" means: once
   * it is on somebody's day it is theirs, and the other person's list should
   * not still be offering it.
   *
   * Work with a subject — `everyone` fans out per person — has a distinct key
   * per person, so both still get their own.
   */
  readonly planned: ReadonlySet<string>;
}

/**
 * The occurrences that will be added to `userId`'s day, in the order given.
 *
 * `dueOn <= on` is not redundant with the status test: `showFrom` marks a chore
 * `due` before its date arrives, so without it a day fills up with next week.
 */
export function autoPlannable<T extends Plannable>(
  items: readonly T[],
  { userId, on, planned }: Options,
): readonly T[] {
  return items.filter(
    (item) =>
      belongsTo(item, userId) &&
      (item.status === 'due' || item.status === 'overdue') &&
      item.dueOn <= on &&
      !planned.has(item.occurrenceKey),
  );
}
