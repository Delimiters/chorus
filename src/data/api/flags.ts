/**
 * "This one, until it is done."
 *
 * A marker on a chore, raised by one person and owned by the house. Every row is live: there is no expiry to
 * compute, and the rows do not accumulate, because completing the chore
 * deletes them — a trigger, in
 * supabase/migrations/20260921120000_flags_last_until_done.sql, since a chore
 * can be completed from three screens and the clearing has to hold for all of
 * them.
 *
 * Raising is yours; lowering is anyone's in the house. Jake: *"If I flag
 * something does it flag it for both of us? Because I want it to."* A flag is
 * a message to the household, so either of you can answer it — `lowerFlag`
 * clears every row on the chore, and `chore_flags_delete` permits that.
 * Completion clears them too, via the trigger, which is why it is definer.
 */

import { civilDate } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import { supabase } from '../supabase';

export interface ChoreFlagRow {
  readonly choreId: string;
  readonly userId: string;
  /** In the household's zone. Parsed at this boundary, not trusted onward. */
  readonly flaggedOn: CivilDate;
}

const COLUMNS = 'chore_id, user_id, flagged_on';

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

/**
 * Every flag in the household, both people's.
 *
 * Unfiltered, and there is nothing left to filter by: a row that exists is a
 * live flag. It used to need saying that the week was deliberately not applied
 * here — the boundary depended on a household setting that can change, so
 * baking it into the query would have cached rows chosen under the old answer.
 * That whole problem is gone.
 */
export async function listFlags(householdId: string): Promise<readonly ChoreFlagRow[]> {
  const { data, error } = await supabase
    .from('chore_flags')
    .select(COLUMNS)
    .eq('household_id', householdId);
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    choreId: row.chore_id,
    userId: row.user_id,
    // A Postgres `date` always renders as YYYY-MM-DD, so this cannot throw on
    // real data — but the brand has to be applied somewhere, and the edge is
    // the only place that knows the value came from a date column.
    flaggedOn: civilDate(row.flagged_on),
  }));
}

/**
 * Raise a flag, or move an existing one to today.
 *
 * An upsert on `(chore_id, user_id)` rather than a select-then-insert: the
 * unique index makes the second flag impossible anyway, and doing it in one
 * statement is what lets the row be written optimistically without a race
 * between two phones.
 */
export async function raiseFlag(input: {
  householdId: string;
  choreId: string;
  userId: string;
  flaggedOn: CivilDate;
}): Promise<void> {
  const { error } = await supabase.from('chore_flags').upsert(
    {
      household_id: input.householdId,
      chore_id: input.choreId,
      user_id: input.userId,
      flagged_on: input.flaggedOn,
    },
    { onConflict: 'chore_id,user_id' },
  );
  if (error) fail(error);
}

/**
 * Lower the flag on a chore — everyone's, not only your own.
 *
 * Deliberately not scoped to a `userId`. A flag is the household's: the "!!"
 * shows on both phones and lifts the chore on both plans, so clearing only
 * your row would leave the mark standing and the tap looking broken. Jake:
 * *"If I flag something does it flag it for both of us? Because I want it
 * to."*
 *
 * The policy allows exactly this and no more — any flag in your household, on
 * a chore you can see. A flag on a housemate's private chore stays out of
 * reach, which is why `chore_is_visible` is still on the delete policy.
 */
export async function lowerFlag(choreId: string): Promise<void> {
  const { error } = await supabase.from('chore_flags').delete().eq('chore_id', choreId);
  if (error) fail(error);
}
