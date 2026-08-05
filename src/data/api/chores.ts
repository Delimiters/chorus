/**
 * Chores, completions and exceptions.
 *
 * Note what is *not* here: any notion of an occurrence. Occurrences are computed
 * from these three by the pure engine, never fetched. See docs/ARCHITECTURE.md.
 */

import { safeParseSchedule } from '@/core/recurrence/schema';
import type { Schedule } from '@/core/recurrence/types';
import { safeParseAssignment } from '@/core/rotation/schema';
import type { Assignment } from '@/core/rotation/types';
import type { ChoreInput, CompletionInput, ExceptionInput } from '@/core/occurrence/types';
import type { CivilDate } from '@/core/civil/types';
import { toPriority, type Priority } from '@/core/chore/priority';
import type { Json } from '../database.types';
import { describeError, isDuplicate, supabase } from '../supabase';

function fail(error: { code?: string | undefined; message: string }): never {
  throw new Error(describeError(error));
}

/** A chore row, plus the parsed rule the engine needs. */
export interface Chore extends ChoreInput {
  readonly notes: string | null;
  readonly archivedAt: string | null;
  /**
   * Grouping and ordering, neither of which the engine knows about.
   *
   * `categoryId` is null for the "Other" group, which is the absence of a
   * category rather than a row. `priority` is read through `toPriority`, so a
   * value written by some future version with a fourth level degrades to
   * `normal` instead of scrambling a sort.
   */
  readonly categoryId: string | null;
  readonly priority: Priority;
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
  category_id: string | null;
  priority: unknown;
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
      categoryId: row.category_id,
      priority: toPriority(row.priority),
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
    .select('id, title, notes, schedule, assignment, archived_at, category_id, priority')
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

function toCompletion(row: {
  chore_id: string;
  occurrence_key: string;
  completed_on: string;
  completed_by: string;
}): CompletionInput {
  return {
    choreId: row.chore_id,
    occurrenceKey: row.occurrence_key,
    completedOn: row.completed_on as CivilDate,
    completedBy: row.completed_by,
  };
}

const COMPLETION_COLUMNS = 'chore_id, occurrence_key, completed_on, completed_by';

/**
 * Completions for occurrences **due** in a window, whenever they were done.
 *
 * `due_on`, not `completed_on`, and the distinction is load-bearing. The agenda
 * projects occurrences by due date and then asks "is this one complete?" — so a
 * completion is relevant exactly when its occurrence is on screen, regardless of
 * which day the tick happened.
 *
 * Filtering on `completed_on` instead had a nasty failure: tick a chore early
 * from Upcoming, and by the time its due date came round the completion sat
 * outside the window, so the row read *overdue* forever. Ticking it again hit
 * the unique constraint, which the API maps to success, so the UI never
 * recovered. A completion done outside the window is not noise — it is the
 * answer to the question being asked.
 *
 * Stats will want the other column, and can have its own query when it lands.
 */
export async function listCompletions(
  householdId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<readonly CompletionInput[]> {
  const { data, error } = await supabase
    .from('chore_completions')
    .select(COMPLETION_COLUMNS)
    .eq('household_id', householdId)
    .gte('due_on', from)
    .lte('due_on', to);
  if (error) fail(error);
  return (data ?? []).map(toCompletion);
}

/**
 * Completions for a specific handful of chores, unbounded by date.
 *
 * For the one-time chores that live outside the agenda window — see
 * {@link listOneTimeChores}. They have one occurrence each, so this is a few
 * rows, not a table scan.
 */
export async function listCompletionsForChores(
  householdId: string,
  choreIds: readonly string[],
): Promise<readonly CompletionInput[]> {
  if (choreIds.length === 0) return [];
  const { data, error } = await supabase
    .from('chore_completions')
    .select(COMPLETION_COLUMNS)
    .eq('household_id', householdId)
    .in('chore_id', choreIds);
  if (error) fail(error);
  return (data ?? []).map(toCompletion);
}

/** Exceptions for a specific handful of chores, unbounded by date. */
export async function listExceptionsForChores(
  householdId: string,
  choreIds: readonly string[],
): Promise<readonly ExceptionInput[]> {
  if (choreIds.length === 0) return [];
  const { data, error } = await supabase
    .from('chore_exceptions')
    .select('chore_id, occurrence_key, kind, moved_to')
    .eq('household_id', householdId)
    .in('chore_id', choreIds);
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    choreId: row.chore_id,
    occurrenceKey: row.occurrence_key,
    kind: row.kind as ExceptionInput['kind'],
    movedTo: (row.moved_to as CivilDate | null) ?? null,
  }));
}

/**
 * Every unarchived one-time chore, regardless of date.
 *
 * These cannot come from the agenda window, which is a few weeks wide: "renew
 * the passport", set eight months ago and never done, is outside any sane
 * range. The collapse rule promises a one-time chore never expires, and this is
 * what makes that true rather than merely stated. See docs/DESIGN_SYSTEM.md.
 *
 * Deliberately unfiltered by date. A `once` rule carries its own `dueOn`, which
 * need not equal the schedule's `startsOn`, so a date filter here would quietly
 * drop the very chores this query exists to find. `schedule_kind` is a generated
 * column, so the narrowing is still an index lookup rather than a jsonb scan.
 *
 * Completed ones come back too and are filtered out by projection. If a
 * household ever accumulates enough finished one-time chores for that to matter,
 * the fix is archiving them on completion — not truncating this query, which
 * would silently lose work.
 */
export async function listOneTimeChores(householdId: string): Promise<ChoreListResult> {
  const { data, error } = await supabase
    .from('chores')
    .select('id, title, notes, schedule, assignment, archived_at, category_id, priority')
    .eq('household_id', householdId)
    .eq('schedule_kind', 'once')
    .is('archived_at', null)
    .order('starts_on');
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

// ── Writing chores ──────────────────────────────────────────────────────────

export interface ChoreDraft {
  readonly title: string;
  readonly notes: string | null;
  readonly schedule: Schedule;
  readonly assignment: Assignment;
  /** Null means the "Other" group. See the categories migration. */
  readonly categoryId: string | null;
  readonly priority: Priority;
}

/**
 * A draft, validated and turned into the columns a chore row is made of.
 *
 * Exported and pure so it can be tested without a database — which matters,
 * because the integration suite drives raw queries (the app's Supabase client
 * cannot load in a Node test environment) and so cannot catch a wrong column
 * name here. This is the one piece both writers share, so a mistake in it is a
 * mistake in every write.
 *
 * Validates on the way out, not just on the way in.
 *
 * `schedule` and `assignment` are jsonb, so the database will accept any shape
 * at all — nothing structurally stops a bad write, and a bad write is
 * indistinguishable from a bad migration by the time a reader hits it. Parsing
 * before the insert means a malformed rule fails here, with the field named,
 * rather than becoming a chore that renders as "could not be read".
 *
 * It also normalises: a `once` schedule gets its `startsOn` pinned to the rule's
 * own `dueOn`, which is what keeps the generated `starts_on` column agreeing
 * with the engine. See docs/RECURRENCE.md.
 */
export function choreRow(draft: ChoreDraft): {
  title: string;
  notes: string | null;
  schedule: Json;
  assignment: Json;
  category_id: string | null;
  priority: Priority;
} {
  const title = draft.title.trim();
  if (title.length === 0) throw new Error('A chore needs a name.');
  if (title.length > 120) throw new Error('That name is too long — 120 characters at most.');

  const schedule = safeParseSchedule(draft.schedule);
  if (!schedule.success) throw new Error('That schedule is not one the app can store.');

  const assignment = safeParseAssignment(draft.assignment);
  if (!assignment.success) throw new Error('That assignment is not one the app can store.');

  const notes = draft.notes?.trim();

  return {
    title,
    // Empty notes are null, not '', so "has notes" is one check rather than two.
    notes: notes === undefined || notes.length === 0 ? null : notes,
    schedule: schedule.data as unknown as Json,
    assignment: assignment.data as unknown as Json,
    category_id: draft.categoryId,
    // Normalised on the way out as well as in. The column has a CHECK, so an
    // invalid value would be a 23514 at the database rather than a clear
    // message here, and this is the one function both writers share.
    priority: toPriority(draft.priority),
  };
}

export async function createChore(
  householdId: string,
  userId: string,
  draft: ChoreDraft,
): Promise<string> {
  const { data, error } = await supabase
    .from('chores')
    .insert({ household_id: householdId, ...choreRow(draft), created_by: userId })
    .select('id')
    .single();
  if (error) fail(error);
  return data.id;
}

/**
 * Edits a chore in place, keeping its id.
 *
 * Keeping the id is the whole point: completions and exceptions reference the
 * chore, so replacing it would orphan every one of them and erase the history
 * the stats view is built from.
 *
 * Editing a schedule *does* change which occurrences exist, and therefore which
 * stored completions still correspond to one. That is the honest consequence of
 * a rule change and not something to paper over — a completion whose occurrence
 * no longer exists is simply not projected. It stays in the table, so undoing
 * the edit brings it back.
 */
export async function updateChore(choreId: string, draft: ChoreDraft): Promise<void> {
  const { error } = await supabase.from('chores').update(choreRow(draft)).eq('id', choreId);
  if (error) fail(error);
}

/**
 * Archives a chore. This is the only removal the app offers.
 *
 * `DELETE` is revoked at the database, because deleting a chore would cascade
 * away its completion log — and "how often did we actually do this?" is a
 * question worth being able to answer about a chore nobody does any more.
 */
export async function archiveChore(choreId: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('chores')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', choreId);
  if (error) fail(error);
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
