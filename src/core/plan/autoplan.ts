/**
 * What a person's day gets filled with, before they have chosen anything.
 *
 * This decides *what would be added* if something is doing the adding. As of
 * 2026-09-22 that is no longer automatic: the household opts in, and with the
 * setting off only flagged work goes on by itself. The rule did not change —
 * anything due or late, whoever's turn it is — but the sentence that used to
 * sit here ("it is the baseline the day starts from") described a behaviour
 * that is now off by default.
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
 * It has two callers, and they must agree: the auto-fill effect, and the "Add
 * everything due or late" button that does the same job on request. If the
 * button offered a different set from the one the setting adds, the two would
 * be describing different days and the button's count would be a lie.
 *
 * ── It used to be a housemate forecast, and that is gone ──────────────────
 *
 * The second caller was once the plan screen previewing a housemate's day —
 * what would land when they opened the app. Jake: *"is it going to show me the
 * stuff that will automatically be on her list regardless of if she's logged
 * in?"* That forecast was removed in #105, and as of 2026-09-22 auto-filling
 * is off unless the household turns it on, so by default there is nothing left
 * to forecast. This header went on describing it regardless.
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
   * Occurrence keys already on **this person's** day.
   *
   * It was briefly anybody's, so that `anyone` work was claimed by whichever
   * device auto-planned first and appeared on exactly one of the two plans.
   * That was reversed: Jake — *"They should all go to both of us, and if
   * somebody's not going to do them they can remove them from their plan."*
   * See docs/DECISIONS.md, 2026-09-09.
   *
   * The consequence the claim-first version was avoiding is real and is now
   * accepted: with both days on one screen a shared chore renders twice, once
   * under each person, and its React key and test id appear twice with it.
   * Anything reading rows across both days has to expect duplicate keys.
   *
   * Work with a subject — `everyone` fans out per person — has a distinct key
   * per person regardless.
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
