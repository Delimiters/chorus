/**
 * Chores, completions and exceptions.
 *
 * Note what is *not* here: any notion of an occurrence. Occurrences are computed
 * from these three by the pure engine, never fetched. See docs/ARCHITECTURE.md.
 */

import { safeParseSchedule } from '@/core/recurrence/schema';
import { safeParseAssignment } from '@/core/rotation/schema';
import type { ChoreInput, CompletionInput, ExceptionInput } from '@/core/occurrence/types';
import type { CivilDate } from '@/core/civil/types';
import { describeError, isDuplicate, supabase } from '../supabase';

function fail(error: { code?: string | undefined; message: string }): never {
  throw new Error(describeError(error));
}

/** A chore row, plus the parsed rule the engine needs. */
export interface Chore extends ChoreInput {
  readonly notes: string | null;
  readonly archivedAt: string | null;
}

/**
 * Parses a database row into something the engine will accept.
 *
 * `schedule` and `assignment` are jsonb, so nothing structurally guarantees they
 * match the engine's expectations — a bad migration or an older app version
 * could write a shape it rejects. Rather than throwing and blanking the whole
 * agenda over one bad row, an unparseable chore is dropped and reported.
 */
function toChore(row: {
  id: string;
  title: string;
  notes: string | null;
  schedule: unknown;
  assignment: unknown;
  archived_at: string | null;
}): { chore: Chore } | { error: string } {
  const schedule = safeParseSchedule(row.schedule);
  if (!schedule.success) {
    return { error: `"${row.title}" has a schedule the app cannot read` };
  }
  const assignment = safeParseAssignment(row.assignment);
  if (!assignment.success) {
    return { error: `"${row.title}" has an assignment the app cannot read` };
  }
  return {
    chore: {
      id: row.id,
      title: row.title,
      notes: row.notes,
      schedule: schedule.data,
      assignment: assignment.data,
      archived: row.archived_at !== null,
      archivedAt: row.archived_at,
    },
  };
}

export interface ChoreListResult {
  readonly chores: readonly Chore[];
  /** Rows the engine could not read. Surfaced rather than silently dropped. */
  readonly unreadable: readonly string[];
}

export async function listChores(
  householdId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ChoreListResult> {
  let query = supabase
    .from('chores')
    .select('id, title, notes, schedule, assignment, archived_at')
    .eq('household_id', householdId)
    .order('title');

  if (options.includeArchived !== true) query = query.is('archived_at', null);

  const { data, error } = await query;
  if (error) fail(error);

  const chores: Chore[] = [];
  const unreadable: string[] = [];
  for (const row of data ?? []) {
    const parsed = toChore(row);
    if ('chore' in parsed) chores.push(parsed.chore);
    else unreadable.push(parsed.error);
  }
  return { chores, unreadable };
}

export async function listCompletions(
  householdId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<readonly CompletionInput[]> {
  const { data, error } = await supabase
    .from('chore_completions')
    .select('chore_id, occurrence_key, completed_on, completed_by')
    .eq('household_id', householdId)
    // Filtered on completed_on rather than due_on: a chore done late belongs to
    // the day it was done, which is what the Done section shows.
    .gte('completed_on', from)
    .lte('completed_on', to);
  if (error) fail(error);

  return (data ?? []).map((row) => ({
    choreId: row.chore_id,
    occurrenceKey: row.occurrence_key,
    completedOn: row.completed_on as CivilDate,
    completedBy: row.completed_by,
  }));
}

/**
 * Completions for occurrences *due* in a window, whenever they were done.
 *
 * The agenda needs both: what was done today (for the Done section) and whether
 * a given occurrence is complete (for its checkbox), and those are different
 * date columns.
 */
export async function listCompletionsByDue(
  householdId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<readonly CompletionInput[]> {
  const { data, error } = await supabase
    .from('chore_completions')
    .select('chore_id, occurrence_key, completed_on, completed_by')
    .eq('household_id', householdId)
    .gte('due_on', from)
    .lte('due_on', to);
  if (error) fail(error);

  return (data ?? []).map((row) => ({
    choreId: row.chore_id,
    occurrenceKey: row.occurrence_key,
    completedOn: row.completed_on as CivilDate,
    completedBy: row.completed_by,
  }));
}

export async function listExceptions(
  householdId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<readonly ExceptionInput[]> {
  const { data, error } = await supabase
    .from('chore_exceptions')
    .select('chore_id, occurrence_key, kind, moved_to')
    .eq('household_id', householdId)
    // Either end can fall in the window: an occurrence moved out of it still
    // needs its exception, or it would reappear on its original date.
    .or(`and(due_on.gte.${from},due_on.lte.${to}),and(moved_to.gte.${from},moved_to.lte.${to})`);
  if (error) fail(error);

  return (data ?? []).map((row) => ({
    choreId: row.chore_id,
    occurrenceKey: row.occurrence_key,
    kind: row.kind,
    movedTo: (row.moved_to as CivilDate | null) ?? null,
  }));
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface CompleteInput {
  readonly householdId: string;
  readonly choreId: string;
  readonly occurrenceKey: string;
  readonly dueOn: CivilDate;
  readonly completedOn: CivilDate;
  readonly userId: string;
}

/**
 * Records a completion.
 *
 * A duplicate is treated as success. `unique (chore_id, occurrence_key)` means a
 * double-tap or a retry-after-timeout raises 23505 rather than creating a second
 * row — which is exactly what makes optimistic completion safe, since the client
 * computes the key with no round trip.
 */
export async function completeOccurrence(input: CompleteInput): Promise<void> {
  const { error } = await supabase.from('chore_completions').insert({
    household_id: input.householdId,
    chore_id: input.choreId,
    occurrence_key: input.occurrenceKey,
    due_on: input.dueOn,
    completed_on: input.completedOn,
    completed_by: input.userId,
  });
  if (error && !isDuplicate(error)) fail(error);
}

/** Removes a completion. Also idempotent — deleting nothing is not an error. */
export async function uncompleteOccurrence(choreId: string, occurrenceKey: string): Promise<void> {
  const { error } = await supabase
    .from('chore_completions')
    .delete()
    .eq('chore_id', choreId)
    .eq('occurrence_key', occurrenceKey);
  if (error) fail(error);
}

export interface ExceptionWriteInput {
  readonly householdId: string;
  readonly choreId: string;
  readonly occurrenceKey: string;
  readonly dueOn: CivilDate;
  readonly userId: string;
  readonly reason?: string;
}

/** Skips one occurrence. The rotation is undisturbed — see docs/ROTATION.md. */
export async function skipOccurrence(input: ExceptionWriteInput): Promise<void> {
  const { error } = await supabase.from('chore_exceptions').insert({
    household_id: input.householdId,
    chore_id: input.choreId,
    occurrence_key: input.occurrenceKey,
    kind: 'skip',
    due_on: input.dueOn,
    created_by: input.userId,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
  if (error && !isDuplicate(error)) fail(error);
}

/** Moves one occurrence. It keeps its key, its index, and its assignee. */
export async function rescheduleOccurrence(
  input: ExceptionWriteInput & { movedTo: CivilDate },
): Promise<void> {
  const { error } = await supabase.from('chore_exceptions').upsert(
    {
      household_id: input.householdId,
      chore_id: input.choreId,
      occurrence_key: input.occurrenceKey,
      kind: 'reschedule',
      due_on: input.dueOn,
      moved_to: input.movedTo,
      created_by: input.userId,
    },
    { onConflict: 'chore_id,occurrence_key' },
  );
  if (error) fail(error);
}

/** Undoes a skip or a reschedule, putting the occurrence back where it was. */
export async function clearException(choreId: string, occurrenceKey: string): Promise<void> {
  const { error } = await supabase
    .from('chore_exceptions')
    .delete()
    .eq('chore_id', choreId)
    .eq('occurrence_key', occurrenceKey);
  if (error) fail(error);
}
