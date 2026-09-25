/**
 * The day plan: what somebody committed to, for one day.
 *
 * Keyed by occurrence rather than by chore, because what you commit to is
 * Thursday's watering rather than "water the plants" in general. See the
 * migration for why it never inherits.
 */

import { civilDate } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import { supabase } from '../supabase';

export interface PlanEntryRow {
  readonly id: string;
  readonly userId: string;
  readonly choreId: string;
  readonly occurrenceKey: string;
  readonly plannedFor: CivilDate;
  readonly position: number;
}

const COLUMNS = 'id, user_id, chore_id, occurrence_key, planned_for, position';

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

/**
 * Every plan entry in a date range, both people's.
 *
 * A range rather than a single day because the screen needs yesterday's
 * leftovers to rank today's proposal, and because paging back a day should not
 * cost a refetch. RLS drops entries for a chore you cannot see, so a private
 * chore's plan never arrives in the first place.
 */
export async function listPlanEntries(
  householdId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<readonly PlanEntryRow[]> {
  const { data, error } = await supabase
    .from('plan_entries')
    .select(COLUMNS)
    .eq('household_id', householdId)
    .gte('planned_for', from)
    .lte('planned_for', to)
    .order('position');
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    choreId: row.chore_id,
    occurrenceKey: row.occurrence_key,
    // A Postgres `date` always renders as YYYY-MM-DD; the brand is applied at
    // the edge because this is the only place that knows it came from a date.
    plannedFor: civilDate(row.planned_for),
    // `numeric` arrives as a string over the wire, and `position` is compared
    // arithmetically everywhere downstream. Without this a drag between 1 and 2
    // would sort "1.5" as a string and land in the wrong place.
    position: Number(row.position),
  }));
}

export interface PlanAddition {
  readonly householdId: string;
  readonly userId: string;
  readonly choreId: string;
  readonly occurrenceKey: string;
  readonly plannedFor: CivilDate;
  readonly position: number;
}

/**
 * Commit to some work.
 *
 * Several at once because that is how the picker works — "Add 4 to today" is
 * one decision, and four round trips would let it half-succeed.
 *
 * `ignoreDuplicates` so re-adding something already planned is a no-op rather
 * than an error. The unique index is what makes that safe, and it is what lets
 * the button be optimistic: a double tap costs nothing.
 */
export async function addToPlan(entries: readonly PlanAddition[]): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabase.from('plan_entries').upsert(
    entries.map((entry) => ({
      household_id: entry.householdId,
      user_id: entry.userId,
      chore_id: entry.choreId,
      occurrence_key: entry.occurrenceKey,
      planned_for: entry.plannedFor,
      position: entry.position,
    })),
    { onConflict: 'user_id,occurrence_key,planned_for', ignoreDuplicates: true },
  );
  if (error) fail(error);
}

/**
 * Take something off today.
 *
 * Deliberately not a delete of the chore, or a completion, or a skip: it means
 * "not today", and the work goes back to the backlog with its due date, its
 * lateness and its flag untouched.
 */
export async function removeFromPlan(
  userId: string,
  occurrenceKey: string,
  plannedFor: CivilDate,
): Promise<void> {
  const { error } = await supabase
    .from('plan_entries')
    .delete()
    .eq('user_id', userId)
    .eq('occurrence_key', occurrenceKey)
    .eq('planned_for', plannedFor);
  if (error) fail(error);
}

/**
 * Move one row, and write one row.
 *
 * The caller computes the position from the row's new neighbours by averaging
 * them, so a drag is a single update rather than a renumbering of the day. Two
 * people dragging at once then stay two independent facts instead of a merge
 * conflict.
 */
export async function movePlanEntry(id: string, position: number): Promise<void> {
  const { error } = await supabase.from('plan_entries').update({ position }).eq('id', id);
  if (error) fail(error);
}

/** Whose day, and which occurrence, was taken off — for one day. */
export interface PlanDismissalRow {
  readonly userId: string;
  readonly occurrenceKey: string;
  readonly dismissedOn: CivilDate;
}

/**
 * What has been taken off either plan, in a date range.
 *
 * Read over the same window as the entries themselves, because a dismissal is
 * only meaningful beside the day it belongs to.
 */
export async function listPlanDismissals(
  householdId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<readonly PlanDismissalRow[]> {
  const { data, error } = await supabase
    .from('plan_dismissals')
    .select('user_id, occurrence_key, dismissed_on')
    .eq('household_id', householdId)
    .gte('dismissed_on', from)
    .lte('dismissed_on', to);
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    occurrenceKey: row.occurrence_key,
    dismissedOn: civilDate(row.dismissed_on),
  }));
}

/**
 * Record that somebody took this off a plan on purpose.
 *
 * Upserted, because taking the same row off twice — a double tap, a retry
 * after a timeout — is one fact rather than two, and the unique key says so.
 * `ignoreDuplicates` so the second write is success rather than 23505.
 */
export async function dismissFromPlan(input: {
  householdId: string;
  userId: string;
  occurrenceKey: string;
  dismissedOn: CivilDate;
}): Promise<void> {
  const { error } = await supabase.from('plan_dismissals').upsert(
    {
      household_id: input.householdId,
      user_id: input.userId,
      occurrence_key: input.occurrenceKey,
      dismissed_on: input.dismissedOn,
    },
    { onConflict: 'user_id,occurrence_key,dismissed_on', ignoreDuplicates: true },
  );
  if (error) fail(error);
}

/**
 * Take the dismissal back, because the chore is being put on the plan again.
 *
 * Called when something is added by hand. Without it, adding a chore you had
 * taken off earlier leaves a record saying you did not want it — harmless
 * while the entry exists, and wrong the moment you take it off and put it
 * back a second time.
 */
export async function undismissFromPlan(input: {
  userId: string;
  occurrenceKeys: readonly string[];
  dismissedOn: CivilDate;
}): Promise<void> {
  if (input.occurrenceKeys.length === 0) return;
  const { error } = await supabase
    .from('plan_dismissals')
    .delete()
    .eq('user_id', input.userId)
    .eq('dismissed_on', input.dismissedOn)
    .in('occurrence_key', [...input.occurrenceKeys]);
  if (error) fail(error);
}
