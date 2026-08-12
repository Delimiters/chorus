/**
 * Routine items and their completions.
 *
 * The same division as chores: this file deals in *stored* rows — the item and
 * its deviations — and never in occurrences, which are computed by the pure
 * projector from what these functions return.
 *
 * Privacy is not enforced here. Every query below would happily read a
 * housemate's private routine if the database let it; it does not, and that is
 * the point. RLS is the guarantee, and these functions are written as if the
 * server were the only thing standing between the two.
 */

import { isTimeBucket, type TimeBucket } from '@/core/routines/buckets';
import type { RoutineCompletionInput, RoutineItemInput } from '@/core/routines/project';
import { safeParseSchedule } from '@/core/recurrence/schema';
import type { Schedule } from '@/core/recurrence/types';
import type { CivilDate, CivilTime } from '@/core/civil/types';
import type { Json } from '../database.types';
import { describeError, isDuplicate, supabase } from '../supabase';

function fail(error: { code?: string | undefined; message: string }): never {
  throw new Error(describeError(error));
}

/** A routine row, plus the parsed schedule the engine will accept. */
export interface RoutineItem extends RoutineItemInput {
  readonly notes: string | null;
  readonly archivedAt: string | null;
  readonly shared: boolean;
}

const ITEM_COLUMNS =
  'id, household_id, user_id, title, notes, icon, schedule, time_of_day, bucket, remind, linked_chore_id, archived_at';

/**
 * Parses a row into something the engine accepts.
 *
 * `schedule` is jsonb, so nothing structurally guarantees it matches what the
 * engine expects — a bad migration or an older client could have written a
 * shape it rejects. An unreadable item is dropped and reported rather than
 * throwing and blanking the whole day, exactly as `toChore` does.
 */
function toItem(
  row: {
    id: string;
    user_id: string;
    title: string;
    notes: string | null;
    icon: string | null;
    schedule: unknown;
    time_of_day: string | null;
    bucket: string | null;
    remind: boolean;
    linked_chore_id: string | null;
    archived_at: string | null;
  },
  shared: boolean,
): { item: RoutineItem } | { error: string } {
  const schedule = safeParseSchedule(row.schedule);
  if (!schedule.success) {
    return { error: `"${row.title}" has a schedule the app cannot read` };
  }
  // The bucket is a generated column, so this only fails if somebody has been
  // in the database by hand. Degrading beats crashing a list.
  if (!isTimeBucket(row.bucket)) {
    return { error: `"${row.title}" is filed under a part of the day the app does not know` };
  }

  return {
    item: {
      id: row.id,
      title: row.title,
      ownerId: row.user_id,
      notes: row.notes,
      icon: row.icon,
      schedule: schedule.data,
      timeOfDay: row.time_of_day as CivilTime | null,
      bucket: row.bucket,
      linkedChoreId: row.linked_chore_id,
      remind: row.remind,
      archived: row.archived_at !== null,
      archivedAt: row.archived_at,
      shared,
    },
  };
}

export interface RoutineListResult {
  readonly items: readonly RoutineItem[];
  /** Rows the engine could not read. Surfaced rather than silently dropped. */
  readonly unreadable: readonly string[];
}

/**
 * Every routine item you are allowed to see: yours, plus any housemate who has
 * switched sharing on.
 *
 * `shared` comes from the membership row rather than the item, because that is
 * where the switch lives. It is carried onto the item so the screen can label a
 * housemate's row without a second lookup.
 */
export async function listRoutineItems(
  householdId: string,
  options: { includeArchived?: boolean } = {},
): Promise<RoutineListResult> {
  let query = supabase
    .from('routine_items')
    .select(ITEM_COLUMNS)
    .eq('household_id', householdId)
    .order('title');

  if (options.includeArchived !== true) query = query.is('archived_at', null);

  const { data, error } = await query;
  if (error) fail(error);

  const { data: members, error: membersError } = await supabase
    .from('household_members')
    .select('user_id, share_routine')
    .eq('household_id', householdId);
  if (membersError) fail(membersError);

  const sharesRoutine = new Map((members ?? []).map((m) => [m.user_id, m.share_routine]));

  const items: RoutineItem[] = [];
  const unreadable: string[] = [];
  for (const row of data ?? []) {
    const parsed = toItem(row, sharesRoutine.get(row.user_id) ?? false);
    if ('item' in parsed) items.push(parsed.item);
    else unreadable.push(parsed.error);
  }
  return { items, unreadable };
}

/** Completions for a window, for everything you can see. */
export async function listRoutineCompletions(
  householdId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<readonly RoutineCompletionInput[]> {
  const { data, error } = await supabase
    .from('routine_completions')
    .select('routine_item_id, occurrence_key, completed_on')
    .eq('household_id', householdId)
    .gte('due_on', from)
    .lte('due_on', to);
  if (error) fail(error);

  return (data ?? []).map((row) => ({
    routineItemId: row.routine_item_id,
    occurrenceKey: row.occurrence_key,
    completedOn: row.completed_on as CivilDate,
  }));
}

export interface RoutineDraft {
  readonly title: string;
  readonly notes: string | null;
  readonly schedule: Schedule;
  /** Exactly one of these is set; the database enforces it too. */
  readonly timeOfDay: CivilTime | null;
  readonly bucketChoice: TimeBucket | null;
  readonly icon: string | null;
  readonly remind: boolean;
  readonly linkedChoreId: string | null;
}

/**
 * A draft, validated and turned into the columns a row is made of.
 *
 * Exported and pure so it can be tested without a database — the same reason
 * `choreRow` is. It is the one piece both writers share, so a mistake here is a
 * mistake in every write.
 */
export function routineRow(draft: RoutineDraft): {
  title: string;
  notes: string | null;
  schedule: Json;
  time_of_day: string | null;
  bucket_choice: string | null;
  icon: string | null;
  remind: boolean;
  linked_chore_id: string | null;
} {
  const title = draft.title.trim();
  if (title.length === 0) throw new Error('A routine item needs a name.');
  if (title.length > 120) throw new Error('That name is too long — 120 characters at most.');

  const schedule = safeParseSchedule(draft.schedule);
  if (!schedule.success) throw new Error('That schedule is not one the app can store.');

  // Exactly one of the two, matching `routine_bucket_source`. Caught here so
  // the message is about the form rather than a 23514 from Postgres.
  const hasTime = draft.timeOfDay !== null;
  const hasBucket = draft.bucketChoice !== null;
  if (hasTime === hasBucket) {
    throw new Error('Pick a time, or a part of the day — not both, and not neither.');
  }

  const notes = draft.notes?.trim();

  return {
    title,
    notes: notes === undefined || notes.length === 0 ? null : notes,
    schedule: schedule.data as unknown as Json,
    time_of_day: draft.timeOfDay,
    bucket_choice: draft.bucketChoice,
    icon: draft.icon,
    remind: draft.remind,
    linked_chore_id: draft.linkedChoreId,
  };
}

export async function createRoutineItem(
  householdId: string,
  userId: string,
  draft: RoutineDraft,
): Promise<string> {
  const { data, error } = await supabase
    .from('routine_items')
    .insert({ household_id: householdId, user_id: userId, ...routineRow(draft) })
    .select('id')
    .single();
  if (error) {
    // The partial unique index on (user_id, linked_chore_id).
    if (isDuplicate(error)) throw new Error('That chore is already in your routine.');
    fail(error);
  }
  return data.id;
}

export async function updateRoutineItem(itemId: string, draft: RoutineDraft): Promise<void> {
  const { error } = await supabase.from('routine_items').update(routineRow(draft)).eq('id', itemId);
  if (error) {
    if (isDuplicate(error)) throw new Error('That chore is already in your routine.');
    fail(error);
  }
}

/** Archive rather than delete, so a day you have already lived keeps its shape. */
export async function archiveRoutineItem(itemId: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('routine_items')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', itemId);
  if (error) fail(error);
}

export async function deleteRoutineItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('routine_items').delete().eq('id', itemId);
  if (error) fail(error);
}

/** Whether this member's routine is visible to the rest of the household. */
export async function setShareRoutine(
  householdId: string,
  userId: string,
  shared: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('household_members')
    .update({ share_routine: shared })
    .eq('household_id', householdId)
    .eq('user_id', userId);
  if (error) fail(error);
}

/**
 * Ticking an item off, and the linked chore with it.
 *
 * One RPC rather than two writes, so there is no half-state to recover from.
 * The chore arguments are passed only when the caller actually found an
 * occurrence of the linked chore due that day — the server does not expand
 * recurrence, because a second implementation of that would drift from the
 * engine.
 *
 * Idempotent in both directions: the RPC uses `on conflict do nothing`, so a
 * double tap or a retry after a timeout is success.
 */
export interface LinkedChoreTick {
  readonly choreId: string;
  readonly occurrenceKey: string;
  readonly dueOn: CivilDate;
}

export async function completeRoutine(input: {
  routineItemId: string;
  occurrenceKey: string;
  dueOn: CivilDate;
  completedOn: CivilDate;
  chore: LinkedChoreTick | null;
}): Promise<void> {
  const { error } = await supabase.rpc('tick_routine', {
    p_item: input.routineItemId,
    p_occurrence: input.occurrenceKey,
    p_due_on: input.dueOn,
    p_completed_on: input.completedOn,
    // Spread rather than `?? undefined`: under exactOptionalPropertyTypes an
    // explicitly-undefined optional is not the same as an absent one.
    ...(input.chore === null
      ? {}
      : {
          p_chore: input.chore.choreId,
          p_chore_occ: input.chore.occurrenceKey,
          p_chore_due_on: input.chore.dueOn,
        }),
  });
  if (error) fail(error);
}

export async function uncompleteRoutine(input: {
  routineItemId: string;
  occurrenceKey: string;
  chore: Pick<LinkedChoreTick, 'choreId' | 'occurrenceKey'> | null;
}): Promise<void> {
  const { error } = await supabase.rpc('untick_routine', {
    p_item: input.routineItemId,
    p_occurrence: input.occurrenceKey,
    ...(input.chore === null
      ? {}
      : { p_chore: input.chore.choreId, p_chore_occ: input.chore.occurrenceKey }),
  });
  if (error) fail(error);
}
