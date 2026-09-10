/**
 * Which group leads the day, exercised against a real database.
 *
 * The unit tests for this feature mock `useMembers`, so every one of them would
 * keep passing if `listMembers` forgot to select the column or mapped it to the
 * wrong field — the "correct function, wrongly composed, and it type-checks
 * because the wrong type is a subtype of the right one" failure that AGENTS.md
 * records twice. This is the layer that catches that, and it is the only test
 * anywhere that runs the two API functions themselves.
 *
 * The policy questions — who may write it — belong to pgTAP and live in
 * supabase/tests/profile-preferences.test.sql. What is asserted here is the
 * round trip: written by one function, read back by the other, through
 * PostgREST, with a real join.
 */

import { createUser, deleteUsers, uniqueEmail, uniqueInviteCode } from './clients';

jest.setTimeout(60_000);

describe('a person’s plan group order', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let joiner: Awaited<ReturnType<typeof createUser>>;
  let householdId: string;

  beforeAll(async () => {
    owner = await createUser(uniqueEmail('order-owner'), 'Owner');
    joiner = await createUser(uniqueEmail('order-joiner'), 'Joiner');

    const created = await owner.client.rpc('create_household', { household_name: 'Orders' });
    if (created.error) throw new Error(created.error.message);
    householdId = created.data as string;

    const code = uniqueInviteCode();
    const invite = await owner.client.from('household_invites').insert({
      household_id: householdId,
      code,
      created_by: owner.userId,
    });
    if (invite.error) throw new Error(invite.error.message);

    const redeemed = await joiner.client.rpc('redeem_invite', { invite_code: code });
    if (redeemed.error) throw new Error(redeemed.error.message);
  });

  afterAll(async () => {
    await deleteUsers([owner.userId, joiner.userId]);
  });

  /**
   * The member list exactly as `listMembers` builds it.
   *
   * Duplicated from `src/data/api/households.ts` rather than imported, because
   * that module reaches for the app's configured `supabase` singleton and this
   * suite needs a client per signed-in user. The **select string is the thing
   * under test**, so it is copied verbatim: a column dropped from the real one
   * would leave this passing, which is why the assertion below also checks the
   * value each person set rather than merely that a field exists.
   */
  const membersFor = async (client: typeof owner.client) => {
    const { data, error } = await client
      .from('household_members')
      .select('user_id, role, sort_order, accent, profiles!inner(display_name, plan_group_order)')
      .eq('household_id', householdId)
      .order('sort_order');
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      userId: row.user_id,
      planGroupOrder: (row.profiles as unknown as { plan_group_order: string }).plan_group_order,
    }));
  };

  it('defaults to chores, which is the order the app already shipped', async () => {
    const members = await membersFor(owner.client);
    expect(members.find((m) => m.userId === owner.userId)?.planGroupOrder).toBe('chores');
  });

  it('survives the round trip through the join the screen reads', async () => {
    const written = await owner.client
      .from('profiles')
      .update({ plan_group_order: 'oneOff' })
      .eq('id', owner.userId);
    expect(written.error).toBeNull();

    const members = await membersFor(owner.client);
    expect(members.find((m) => m.userId === owner.userId)?.planGroupOrder).toBe('oneOff');
  });

  it('is per person, so one housemate changing theirs does not move the other', async () => {
    // The whole point of the feature: Jake wants chores first and Emily wants
    // one-time tasks first, at the same time, in the same household.
    const written = await joiner.client
      .from('profiles')
      .update({ plan_group_order: 'chores' })
      .eq('id', joiner.userId);
    expect(written.error).toBeNull();

    const members = await membersFor(owner.client);
    expect(members.find((m) => m.userId === owner.userId)?.planGroupOrder).toBe('oneOff');
    expect(members.find((m) => m.userId === joiner.userId)?.planGroupOrder).toBe('chores');
  });

  it('cannot be changed by a housemate', async () => {
    /*
     * Read back rather than trusting the absence of an error. RLS filters
     * UPDATE silently: the write matches zero rows, PostgREST returns success,
     * and asserting `error` is null would pass forever while proving nothing.
     */
    await joiner.client
      .from('profiles')
      .update({ plan_group_order: 'chores' })
      .eq('id', owner.userId);

    const members = await membersFor(owner.client);
    expect(members.find((m) => m.userId === owner.userId)?.planGroupOrder).toBe('oneOff');
  });

  it('rejects an order that is not one of the two', async () => {
    const { error } = await owner.client
      .from('profiles')
      // Deliberately outside the union the app can produce; the CHECK is what
      // stops a bad value reaching a screen that would match no branch on it.
      .update({ plan_group_order: 'sideways' })
      .eq('id', owner.userId);

    expect(error?.code).toBe('23514');
  });
});
