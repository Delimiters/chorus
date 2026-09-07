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
 * The clock and the schedule shapes stay outside. `recurring` is passed in
 * because deciding it needs the chore, not the occurrence, and `on` is passed
 * in because this module never reads a clock.
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
  /** Occurrence keys already on that person's plan for that day. */
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
