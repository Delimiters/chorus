/**
 * "This one, this week."
 *
 * A per-person marker with a date on it, live only while that date falls in the
 * week being viewed. Nothing ever clears a flag — see `core/chore/flag.ts` for
 * why expiry beats a scheduled sweep, and the migration for why the write side
 * is owner-only where completions are not.
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
 * Not filtered to the current week here: the week boundary depends on
 * `weekStartsOn`, which is a household setting that can change, and baking it
 * into the query would mean the cache held rows selected under the old answer.
 * The engine decides what is live; this just fetches.
 *
 * Stale rows are cheap — one per person per chore, ever — so the whole table
 * is smaller than a single day's completions.
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
 * Lower your own flag.
 *
 * Scoped to `userId` in the statement as well as in the policy. The policy is
 * the guarantee, but a query that relies on it alone reads as though clearing
 * somebody else's were merely unimplemented rather than refused.
 */
export async function lowerFlag(choreId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('chore_flags')
    .delete()
    .eq('chore_id', choreId)
    .eq('user_id', userId);
  if (error) fail(error);
}
