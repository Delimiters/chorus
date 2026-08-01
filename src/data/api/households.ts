/**
 * Household and membership reads/writes.
 *
 * Every function here returns plain data or throws. Mapping database errors to
 * readable messages happens once, here, rather than in every component.
 */

import type { InkName } from '@/design/inks';
import { describeError, supabase } from '../supabase';

export interface Household {
  readonly id: string;
  readonly name: string;
  readonly timeZone: string;
  readonly weekStartsOn: number;
}

export interface Member {
  readonly userId: string;
  readonly displayName: string;
  readonly accent: InkName;
  readonly role: 'owner' | 'admin' | 'member';
  readonly sortOrder: number;
}

function fail(error: { code?: string | undefined; message: string }): never {
  throw new Error(describeError(error));
}

/** Every household the signed-in user belongs to. */
export async function listMyHouseholds(): Promise<Household[]> {
  const { data, error } = await supabase
    .from('households')
    .select('id, name, time_zone, week_starts_on')
    .order('created_at');
  if (error) fail(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    weekStartsOn: row.week_starts_on,
  }));
}

export async function getHousehold(householdId: string): Promise<Household | null> {
  const { data, error } = await supabase
    .from('households')
    .select('id, name, time_zone, week_starts_on')
    .eq('id', householdId)
    .maybeSingle();
  if (error) fail(error);
  if (data === null) return null;

  return {
    id: data.id,
    name: data.name,
    timeZone: data.time_zone,
    weekStartsOn: data.week_starts_on,
  };
}

/**
 * Creates a household and joins it, atomically.
 *
 * Goes through the RPC rather than two inserts: a failure between them would
 * leave a household with no members, which no policy then permits anyone to read
 * or delete. See docs/DATA_MODEL.md.
 */
export async function createHousehold(input: {
  name: string;
  timeZone: string;
  weekStartsOn: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_household', {
    household_name: input.name,
    tz: input.timeZone,
    week_start: input.weekStartsOn,
  });
  if (error) fail(error);
  return data as string;
}

/**
 * Members of a household, with their profiles.
 *
 * Profiles are readable only for people sharing a household, so this join is
 * itself an RLS check — a member of another household gets an empty list rather
 * than an error.
 */
export async function listMembers(householdId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, role, sort_order, accent, profiles!inner(display_name)')
    .eq('household_id', householdId)
    .order('sort_order');
  if (error) fail(error);

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { display_name: string };
    return {
      userId: row.user_id,
      displayName: profile.display_name,
      accent: row.accent as InkName,
      role: row.role,
      sortOrder: row.sort_order,
    };
  });
}

/**
 * Changes household settings.
 *
 * `overdueHorizonDays` is gone from the accepted patch: the column was dropped
 * when the overdue rule became cadence-derived, and this signature went on
 * advertising a field the function silently ignored.
 *
 * Note the `.select()`. Row-level security *filters* rather than rejects, so an
 * update the caller is not allowed to make matches zero rows and returns 204 —
 * success, with nothing changed. The setting then snapped back on the next
 * refetch with no explanation, which is how "only the founder can change
 * anything" stayed invisible. Asking for the row back turns a silent no-op into
 * a sentence.
 */
export async function updateHousehold(
  householdId: string,
  patch: Partial<{ name: string; timeZone: string; weekStartsOn: number }>,
): Promise<void> {
  const { data, error } = await supabase
    .from('households')
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.timeZone !== undefined ? { time_zone: patch.timeZone } : {}),
      ...(patch.weekStartsOn !== undefined ? { week_starts_on: patch.weekStartsOn } : {}),
    })
    .eq('id', householdId)
    .select('id');
  if (error) fail(error);
  if ((data ?? []).length === 0) {
    throw new Error('That change was not allowed. Try signing out and back in.');
  }
}
