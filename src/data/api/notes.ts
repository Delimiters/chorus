/**
 * The shared note board.
 *
 * Jake: *"we want kind of a shared note page somewhere? ... Somewhere to kind
 * of write stuff down that's not quite ready to be a task or isn't a task at
 * all but we can check in on."* He chose several notes over one big board.
 *
 * A note is the thing a chore is not yet. No due date, no assignee, no
 * rotation, and deliberately no completion — the moment a note grows a
 * checkbox it is a chore with worse ergonomics, and two ways to track the same
 * work is how the two come to disagree.
 *
 * Every note belongs to the household rather than its author, so all four
 * verbs are household-wide. See 20260923160000_note_board.sql.
 */

import { describeError, supabase } from '../supabase';

export interface Note {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  readonly createdBy: string | null;
  /** Who touched it last. Stamped by a trigger, never sent by the client. */
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

const COLUMNS = 'id, title, body, created_by, updated_by, updated_at';

function fail(error: { code?: string | undefined; message: string }): never {
  throw new Error(describeError(error));
}

function toNote(row: {
  id: string;
  title: string | null;
  body: string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
}): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/** Newest edit first, which is the order the board reads in. */
export async function listNotes(householdId: string): Promise<readonly Note[]> {
  const { data, error } = await supabase
    .from('household_notes')
    .select(COLUMNS)
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []).map(toNote);
}

export async function createNote(input: {
  householdId: string;
  userId: string;
  title: string | null;
  body: string;
}): Promise<Note> {
  const { data, error } = await supabase
    .from('household_notes')
    .insert({
      household_id: input.householdId,
      title: input.title,
      body: input.body,
      created_by: input.userId,
    })
    .select(COLUMNS)
    .single();
  if (error) fail(error);
  return toNote(data);
}

/**
 * Save an edit.
 *
 * `updated_by` and `updated_at` are deliberately not sent: the trigger stamps
 * them, and the "Emily edited this" footer is the only thing standing between
 * two people typing into one note and a silent overwrite. A field the client
 * could write would make that footer decoration.
 */
export async function updateNote(input: {
  id: string;
  title: string | null;
  body: string;
}): Promise<void> {
  const { data, error } = await supabase
    .from('household_notes')
    .update({ title: input.title, body: input.body })
    .eq('id', input.id)
    .select('id');
  if (error) fail(error);
  /*
   * Zero rows means the policy refused it, which PostgREST reports as success.
   * The same silent no-op cost this app a week on household settings.
   */
  if ((data ?? []).length === 0) {
    /*
     * Two causes, and the common one is not an error worth alarming anybody
     * about: the note was deleted on the other phone while this one had it
     * open. The other is a policy refusal, which cannot happen for a member of
     * the household and would be a bug rather than something to act on.
     */
    throw new Error('That note could not be saved — it may have been deleted.');
  }
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('household_notes').delete().eq('id', id);
  if (error) fail(error);
}
