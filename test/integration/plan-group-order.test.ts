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
 *
 * The first version of this file hand-copied `listMembers`'s select string
 * instead of calling it, which bought nothing: a review showed that deleting
 * the column from the real query left typecheck, all 1372 unit tests *and*
 * this suite green, because the unit tests mock the hook and this file was
 * asserting against its own duplicate. Both functions now take an injectable
 * client so the suite can run the real ones as a real signed-in user.
 */

import { listMembersWith, setPlanGroupOrderWith } from '../../src/data/api/members';
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

  /** The real `listMembers`, read as a real signed-in user. */
  const membersFor = (client: typeof owner.client) => listMembersWith(client, householdId);

  it('defaults to chores, which is the order the app already shipped', async () => {
    const members = await membersFor(owner.client);
    expect(members.find((m) => m.userId === owner.userId)?.planGroupOrder).toBe('chores');
  });

  it('survives the round trip through the two functions the app uses', async () => {
    await setPlanGroupOrderWith(owner.client, 'oneOff', owner.userId);

    const members = await membersFor(owner.client);
    expect(members.find((m) => m.userId === owner.userId)?.planGroupOrder).toBe('oneOff');
  });

  it('is per person, so one housemate changing theirs does not move the other', async () => {
    // The whole point of the feature: Jake wants chores first and Emily wants
    // one-time tasks first, at the same time, in the same household.
    await setPlanGroupOrderWith(joiner.client, 'chores', joiner.userId);

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
    await expect(setPlanGroupOrderWith(joiner.client, 'chores', owner.userId)).rejects.toThrow(
      /profile could not be found/i,
    );

    const members = await membersFor(owner.client);
    expect(members.find((m) => m.userId === owner.userId)?.planGroupOrder).toBe('oneOff');
  });

  it('rejects an order that is not one of the two', async () => {
    const { error } = await owner.client
      .from('profiles')
      // Deliberately outside the union the app can produce, so this one goes
      // around `setPlanGroupOrder` — its signature cannot express the value.
      // The CHECK is what stops a bad value reaching a screen that would match
      // no branch on it.
      .update({ plan_group_order: 'sideways' })
      .eq('id', owner.userId);

    expect(error?.code).toBe('23514');
  });

  it('reads the column the screen reads, not merely some column', async () => {
    /*
     * The regression this file exists for, stated directly: drop
     * `plan_group_order` from `listMembers`'s select and every reader falls
     * back to 'chores' silently. Asserting a *non-default* value through the
     * real function is what makes that fail.
     */
    await setPlanGroupOrderWith(joiner.client, 'oneOff', joiner.userId);

    const members = await membersFor(joiner.client);
    expect(members.find((m) => m.userId === joiner.userId)?.planGroupOrder).toBe('oneOff');
  });
});
