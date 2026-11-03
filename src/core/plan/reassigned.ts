/**
 * Dropping a planned row the fill put on the wrong person's day.
 *
 * ## What happened
 *
 * An occurrence key does not encode who the chore belongs to — for everything
 * but an `everyone` fan-out it is `v1:{choreId}:{period}:{slot}:-`. So
 * reassigning a chore does not change the key, `planFor` goes on matching it,
 * and a row the automatic fill wrote on somebody's day while the chore was
 * theirs stays there after it stops being theirs.
 *
 * Measured on the live household the day it was reported: of 208 plan rows for
 * that day, exactly one sat on the wrong person's day — "Water Indoor Plants -
 * Upstairs", on Jake's, assigned to Emily. Which is what Jake described:
 *
 * > "today she said she tried to assign watering to just her for upstairs
 * > plant and then also put water downstairs on today and I guess that wasn't
 * > working properly"
 *
 * The timestamps tell the story: the fill added it to Jake at 13:25, to Emily
 * at 16:24, and somewhere between those she made it hers alone. Nothing was
 * wrong with her change; the stale row was never revisited.
 *
 * ## Why `addedBy` is the whole rule
 *
 * The obvious fix — drop anything on your day that is not yours — is wrong,
 * and Jake said so before this was built:
 *
 * > "I should be able to add it to my own plan even if it's assigned to emily"
 *
 * Both things have to be true at once, and `added_by` already distinguishes
 * them. **Null means the fill chose it**, from an assumption about who the
 * chore belonged to; when that assumption stops holding the row has no reason
 * to exist. **Non-null means a person chose it**, and a deliberate
 * decision is not the app's to overrule — helping with your housemate's chore
 * is a thing people do.
 *
 * The stored id is whose *day* was written to rather than who tapped: Jake
 * adding to Emily's day stores Emily's, because `useAddToPlan` writes
 * `ownerId ?? me`. Only null-or-not matters to this rule, and nothing should
 * read more into it than that.
 *
 * ## A display rule, not a deletion
 *
 * Nothing is written. The same reasoning as `settle.ts`: a row removed from
 * the database cannot come back if the chore is reassigned again, or if this
 * rule turns out to be wrong. Hidden costs one render; deleted costs the
 * ordering somebody built.
 *
 * It also means the fill will not re-add it — `autoPlannable` filters on
 * `belongsTo` too, so the row it would replace is one it would never create
 * today.
 */

import type { Ownable } from './autoplan';
import type { Plannable, PlannedItem } from './plan';

/**
 * The planned rows that still make sense on `ownerId`'s day.
 *
 * Keeps everything a person chose, and everything that is still theirs. Drops
 * only what the fill added and the chore has since moved away from.
 *
 * Takes the matched rows rather than the raw entries: `planFor` has already
 * decided which entry each row came from, and that is the only place the
 * answer is unambiguous.
 */
/**
 * Whether a row the **fill** added still makes sense on `ownerId`'s day.
 *
 * Exported because three places need the question answered and only one of
 * them holds a `PlannedItem`: the two housemate-count hooks work on raw rows
 * and a projected occurrence. They each re-implemented this predicate for one
 * review round — identical by luck rather than by construction, which is how
 * three copies of a rule become two rules.
 *
 * Takes the assignee rather than the row so the shape of the caller's data
 * does not matter.
 */
export function stillBelongsAfterReassignment(
  assignee: { readonly kind: string; readonly memberId?: string | undefined },
  ownerId: string,
): boolean {
  /*
   * Dropped only when the occurrence demonstrably belongs to **somebody
   * else**, which is narrower than `!belongsTo(item, ownerId)` and
   * deliberately so.
   *
   * The first version used `belongsTo`, and its own test caught what that
   * costs: a rotation with no segment covering the date resolves to
   * `unassignable`, which belongs to nobody — so `belongsTo` is false for
   * *both* people and the row would have been hidden from everyone. Work that
   * exists and neither person can see is a worse failure than the one this
   * module is fixing. `anyone` is kept for the same reason by the same test,
   * and anything a future assignment kind produces is kept by default.
   */
  return !(assignee.kind === 'member' && assignee.memberId !== ownerId);
}

export function dropReassignedAutoRows<T extends Plannable & Ownable>(
  planned: readonly PlannedItem<T>[],
  ownerId: string,
): readonly PlannedItem<T>[] {
  return planned.filter(({ item, addedBy }) => {
    /*
     * A person chose it, so it stays. `addedBy` comes off the entry `planFor`
     * actually matched rather than from a second lookup — see the note on
     * `PlannedItem`, where re-deriving it meant an older automatic row for the
     * same occurrence could overrule a deliberate one added today.
     */
    if (addedBy !== null) return true;
    return stillBelongsAfterReassignment(item.assignee, ownerId);
  });
}
