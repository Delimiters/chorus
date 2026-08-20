/**
 * The steps inside a chore, and the ticks against one occurrence of it.
 *
 * Two things, deliberately separate. A subtask is a *definition* — this chore
 * has these steps, in this order — and lives as long as the chore does. A tick
 * belongs to one occurrence, keyed exactly as completions and exceptions are,
 * so a new occurrence starts empty without anything being written and a past
 * one keeps what was really done. See the subtasks migration.
 */

import { supabase } from '../supabase';

export interface Subtask {
  readonly id: string;
  readonly choreId: string;
  readonly title: string;
  readonly position: number;
}

const COLUMNS = 'id, chore_id, title, position';

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

/**
 * Every step in the household, ordered.
 *
 * One query rather than one per chore: the screens that show steps already
 * hold every chore, and RLS drops the steps of a chore you cannot see — so a
 * private chore's list never arrives in the first place.
 */
export async function listSubtasks(householdId: string): Promise<readonly Subtask[]> {
  const { data, error } = await supabase
    .from('chore_subtasks')
    .select(COLUMNS)
    .eq('household_id', householdId)
    .order('position');
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    choreId: row.chore_id,
    title: row.title,
    position: row.position,
  }));
}

/**
 * Which steps are ticked for one occurrence.
 *
 * Scoped to a single key rather than fetched wholesale: this is read when an
 * occurrence is opened, and a household's tick history grows without bound.
 */
export async function listSubtaskTicks(
  householdId: string,
  occurrenceKey: string,
): Promise<readonly string[]> {
  const { data, error } = await supabase
    .from('chore_subtask_ticks')
    .select('subtask_id')
    .eq('household_id', householdId)
    .eq('occurrence_key', occurrenceKey);
  if (error) fail(error);
  return (data ?? []).map((row) => row.subtask_id);
}

/**
 * Ticks for several occurrences at once.
 *
 * The list screens draw steps under every row, so asking per occurrence would
 * be a query per row. Keys are passed in rather than the whole table being
 * fetched: a household's tick history grows without bound, and only what is
 * on screen is ever needed.
 */
export async function listSubtaskTicksForOccurrences(
  householdId: string,
  occurrenceKeys: readonly string[],
): Promise<readonly { subtaskId: string; occurrenceKey: string }[]> {
  if (occurrenceKeys.length === 0) return [];
  const { data, error } = await supabase
    .from('chore_subtask_ticks')
    .select('subtask_id, occurrence_key')
    .eq('household_id', householdId)
    .in('occurrence_key', [...occurrenceKeys]);
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    subtaskId: row.subtask_id,
    occurrenceKey: row.occurrence_key,
  }));
}

/**
 * Ticks a step for an occurrence, or removes the tick.
 *
 * The insert ignores a conflict on the unique key, so a double tap is success
 * rather than an error — which is what makes an optimistic checkbox safe.
 */
export async function setSubtaskTick(input: {
  householdId: string;
  subtaskId: string;
  occurrenceKey: string;
  tickedOn: string;
  userId: string;
  ticked: boolean;
}): Promise<void> {
  if (!input.ticked) {
    const { error } = await supabase
      .from('chore_subtask_ticks')
      .delete()
      .eq('subtask_id', input.subtaskId)
      .eq('occurrence_key', input.occurrenceKey);
    if (error) fail(error);
    return;
  }

  const { error } = await supabase.from('chore_subtask_ticks').upsert(
    {
      household_id: input.householdId,
      subtask_id: input.subtaskId,
      occurrence_key: input.occurrenceKey,
      ticked_on: input.tickedOn,
      ticked_by: input.userId,
    },
    { onConflict: 'subtask_id,occurrence_key', ignoreDuplicates: true },
  );
  if (error) fail(error);
}

/**
 * Replaces a chore's steps with exactly this list.
 *
 * The form edits steps as a whole, so this is a set operation. Rows that keep
 * their id are updated in place, which is what stops renaming step two from
 * throwing away its ticks — those reference the step, not its title.
 */
export async function replaceSubtasks(
  householdId: string,
  choreId: string,
  steps: readonly { id?: string; title: string }[],
): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from('chore_subtasks')
    .select('id')
    .eq('chore_id', choreId);
  if (readError) fail(readError);

  const keep = new Set(steps.map((s) => s.id).filter((id): id is string => id !== undefined));
  const doomed = (existing ?? []).map((r) => r.id).filter((id) => !keep.has(id));

  if (doomed.length > 0) {
    const { error } = await supabase.from('chore_subtasks').delete().in('id', doomed);
    if (error) fail(error);
  }

  for (const [index, step] of steps.entries()) {
    if (step.id === undefined) {
      const { error } = await supabase.from('chore_subtasks').insert({
        household_id: householdId,
        chore_id: choreId,
        title: step.title,
        position: index,
      });
      if (error) fail(error);
    } else {
      const { error } = await supabase
        .from('chore_subtasks')
        .update({ title: step.title, position: index })
        .eq('id', step.id);
      if (error) fail(error);
    }
  }
}
