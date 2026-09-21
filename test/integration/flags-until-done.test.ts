/**
 * A flag ends when the job is done — through the client, not the trigger.
 *
 * `supabase/tests/flags-cleared-on-completion.test.sql` proves the trigger
 * fires and clears the right rows. It inserts into `chore_completions`
 * directly, so what it cannot show is that the path the *app* takes reaches
 * that trigger at all: the app ticks a box, which goes through RLS as a real
 * signed-in user, and a policy that refused the insert would leave the flag
 * standing with the pgTAP suite still green.
 *
 * So this signs two people in and has one of them tick the other's flagged
 * chore.
 */

import { createUser, deleteUsers, uniqueEmail, uniqueInviteCode } from './clients';

jest.setTimeout(60_000);

const DAILY = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: '2026-01-04',
  endsOn: null,
  timesOfDay: [],
} as const;

describe('a flag and the work it points at', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let joiner: Awaited<ReturnType<typeof createUser>>;
  let householdId: string;
  let choreId: string;
  let otherChoreId: string;

  beforeAll(async () => {
    owner = await createUser(uniqueEmail('flag-owner'), 'Owner');
    joiner = await createUser(uniqueEmail('flag-joiner'), 'Joiner');

    const created = await owner.client.rpc('create_household', { household_name: 'Flags' });
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

    const chores = await owner.client
      .from('chores')
      .insert([
        {
          household_id: householdId,
          title: 'Dishes',
          schedule: DAILY as unknown as never,
          created_by: owner.userId,
        },
        {
          household_id: householdId,
          title: 'Bins',
          schedule: DAILY as unknown as never,
          created_by: owner.userId,
        },
      ])
      .select('id, title');
    if (chores.error) throw new Error(chores.error.message);
    choreId = chores.data.find((c) => c.title === 'Dishes')?.id as string;
    otherChoreId = chores.data.find((c) => c.title === 'Bins')?.id as string;
  });

  afterAll(async () => {
    await deleteUsers([owner.userId, joiner.userId]);
  });

  /**
   * Counted as the owner, never as `admin`.
   *
   * `chore_flags_select` is household-wide rather than per-user — that is what
   * lets a row show your housemate's "!!" — so a real signed-in member can see
   * both flags. Using the service role here would prove nothing about what the
   * app can see, which is the rule this suite is built on.
   */
  const flagsOn = async (id: string): Promise<number> => {
    const { data, error } = await owner.client.from('chore_flags').select('id').eq('chore_id', id);
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  };

  it('survives a day passing, which is what "this week" used to end', async () => {
    /*
     * Dated in January. Under the old rule this was not live at all; the whole
     * point of the change is that age no longer decides.
     */
    const raised = await owner.client.from('chore_flags').insert({
      household_id: householdId,
      chore_id: choreId,
      user_id: owner.userId,
      flagged_on: '2026-01-04',
    });
    expect(raised.error).toBeNull();

    const { data } = await owner.client
      .from('chore_flags')
      .select('id')
      .eq('chore_id', choreId)
      .eq('user_id', owner.userId);
    expect(data).toHaveLength(1);
  });

  it('is cleared when the housemate ticks it off', async () => {
    // The joiner flags it too, so there are two flags from two people.
    const theirs = await joiner.client.from('chore_flags').insert({
      household_id: householdId,
      chore_id: choreId,
      user_id: joiner.userId,
      flagged_on: '2026-09-21',
    });
    expect(theirs.error).toBeNull();
    await expect(flagsOn(choreId)).resolves.toBe(2);

    // And the joiner does the chore — an ordinary completion, through RLS.
    const done = await joiner.client.from('chore_completions').insert({
      household_id: householdId,
      chore_id: choreId,
      occurrence_key: 'v1:dishes:2026-09-21',
      due_on: '2026-09-21',
      completed_on: '2026-09-21',
      completed_by: joiner.userId,
    });
    expect(done.error).toBeNull();

    // Both flags, not just the completer's — the owner cannot delete their own
    // from any screen that no longer lists the chore.
    await expect(flagsOn(choreId)).resolves.toBe(0);
  });

  it('leaves a flag on a chore that was not the one completed', async () => {
    const raised = await owner.client.from('chore_flags').insert({
      household_id: householdId,
      chore_id: otherChoreId,
      user_id: owner.userId,
      flagged_on: '2026-09-21',
    });
    expect(raised.error).toBeNull();

    const done = await owner.client.from('chore_completions').insert({
      household_id: householdId,
      chore_id: choreId,
      occurrence_key: 'v1:dishes:2026-09-22',
      due_on: '2026-09-22',
      completed_on: '2026-09-22',
      completed_by: owner.userId,
    });
    expect(done.error).toBeNull();

    await expect(flagsOn(otherChoreId)).resolves.toBe(1);
  });
});
