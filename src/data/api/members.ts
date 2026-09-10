/**
 * Reading and writing household members, with the client passed in.
 *
 * Split out of `households.ts` for one reason: that module imports the app's
 * configured `supabase` singleton, which imports `react-native`, which the
 * integration project cannot load. So the integration suite used to hand-copy
 * the select string instead of calling the real query — and a review showed
 * what that bought. Deleting `plan_group_order` from the real select left
 * typecheck, all 1372 unit tests (they mock the hook) *and* the integration
 * suite (it asserted against its own duplicate) green, while every reader in
 * the app silently fell back to the default.
 *
 * Nothing here imports the singleton, and the two type-only imports are erased
 * at runtime, so this file loads in a plain Node environment. `households.ts`
 * wraps these with the app's client; the integration suite calls them with a
 * client signed in as a real user. The select string and the row mapping exist
 * exactly once.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { InkName } from '@/design/inks';
import type { Database } from '../database.types';

/** Only what these functions use, so a test client satisfies it. */
export type MemberClient = Pick<SupabaseClient<Database>, 'from'>;

/** Which group leads the daily plan. A person's own preference. */
export type PlanGroupOrder = 'chores' | 'oneOff';

export const PLAN_GROUP_ORDERS: readonly PlanGroupOrder[] = ['chores', 'oneOff'];

export interface Member {
  readonly userId: string;
  readonly displayName: string;
  readonly accent: InkName;
  readonly role: 'owner' | 'admin' | 'member';
  readonly sortOrder: number;
  /**
   * Read for everyone in the house, writable only for yourself.
   *
   * It rides along on this query rather than getting its own, because the join
   * is already fetching each person's profile and the plan already has the
   * member list in hand. Reading a housemate's copy is permitted and useless;
   * `profiles_update` is what stops it being written.
   */
  readonly planGroupOrder: PlanGroupOrder;
}

/**
 * Members of a household, with their profiles.
 *
 * Profiles are readable only for people sharing a household, so this join is
 * itself an RLS check — a member of another household gets an empty list rather
 * than an error.
 */
export async function listMembersWith(
  client: MemberClient,
  householdId: string,
): Promise<Member[]> {
  const { data, error } = await client
    .from('household_members')
    .select('user_id, role, sort_order, accent, profiles!inner(display_name, plan_group_order)')
    .eq('household_id', householdId)
    .order('sort_order');
  if (error) throw error;

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as {
      display_name: string;
      plan_group_order: string;
    };
    return {
      userId: row.user_id,
      displayName: profile.display_name,
      accent: row.accent as InkName,
      role: row.role,
      sortOrder: row.sort_order,
      // Anything the column's CHECK would reject cannot arrive, but a value
      // from a future version could — fall back rather than hand a screen a
      // string it will match no branch on.
      planGroupOrder: PLAN_GROUP_ORDERS.includes(profile.plan_group_order as PlanGroupOrder)
        ? (profile.plan_group_order as PlanGroupOrder)
        : 'chores',
    };
  });
}

/**
 * Sets which group leads *your* daily plan.
 *
 * `profiles_update` is `id = auth.uid()` on both USING and WITH CHECK, so the
 * database chooses the row regardless of `userId` — the argument only narrows
 * the filter, and passing somebody else's id matches nothing rather than
 * reordering their day.
 *
 * `.select('id')` and the zero-row check are the point. RLS filters rather than
 * rejects: an update the caller may not make matches zero rows and returns 204,
 * success with nothing changed, and the preference snaps back on the next
 * refetch with nothing to explain it. `updateHousehold` carries the same guard
 * for the same reason, having shipped without it once.
 */
export async function setPlanGroupOrderWith(
  client: MemberClient,
  order: PlanGroupOrder,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from('profiles')
    .update({ plan_group_order: order })
    .eq('id', userId)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('Your profile could not be found.');
}
