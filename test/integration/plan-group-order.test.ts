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
import { adminClient, createUser, deleteUsers, uniqueEmail, uniqueInviteCode } from './clients';

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

    /*
     * `sort_order` is set to the *reverse* of user-id order, deliberately.
     *
     * Otherwise `.order('sort_order')` and `.order('user_id')` agree about half
     * the time — depending on which uuid `gen_random_uuid` happened to produce
     * — and a test that catches the wrong sort column only on a coin flip is
     * worse than one that admits it does not. Setting them in opposition makes
     * any user-id-based ordering fail every run.
     *
     * Through `admin` because this is setup, never an assertion.
     */
    const [firstById, secondById] = [owner.userId, joiner.userId].sort();
    const admin = adminClient();
    await admin
      .from('household_members')
      .update({ sort_order: 20 })
      .eq('household_id', householdId)
      .eq('user_id', firstById as string);
    await admin
      .from('household_members')
      .update({ sort_order: 10 })
      .eq('household_id', householdId)
      .eq('user_id', secondById as string);

    /*
     * A second household for the owner alone, so the member list has something
     * it must *not* return. Without it, dropping the `household_id` filter is
     * invisible: RLS confines you to your own households, so with only one
     * there is no difference to see. It becomes a real leak the day
     * multi-household ships.
     */
    const other = await owner.client.rpc('create_household', { household_name: 'Elsewhere' });
    if (other.error) throw new Error(other.error.message);
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

  it('maps the whole row, not only the column this feature added', async () => {
    /*
     * `members.ts` has no unit test — the app tests mock the hook — so this
     * file is the only thing looking at it. A review measured the gap:
     * deleting the household filter, changing the sort column and hard-coding
     * `displayName` all at once left this suite green, because every
     * assertion here was about one field.
     *
     * The household filter is the one with teeth. RLS confines you to your own
     * households today, so losing it is inert; the day multi-household ships
     * it becomes a cross-household leak.
     */
    const members = await membersFor(owner.client);

    // Two, not three: the owner is also in "Elsewhere", which this household's
    // member list must not reach into.
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.displayName).sort()).toEqual(['Joiner', 'Owner']);
    expect(members.map((m) => m.userId).sort()).toEqual([owner.userId, joiner.userId].sort());

    // Ascending `sort_order`, which was set against user-id order in setup —
    // so this fails on any other sort column rather than half the time.
    expect(members.map((m) => m.sortOrder)).toEqual([10, 20]);
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
