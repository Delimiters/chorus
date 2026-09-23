/**
 * The note board, through the client that ships.
 *
 * `supabase/tests/notes.test.sql` proves the policies with `set local role`.
 * What it cannot show is that the path the *app* takes reaches them: the
 * client sends a particular set of columns, and a policy that refused one
 * would leave the pgTAP suite green while the screen showed an error.
 *
 * The assertion that matters is that **Bob can edit Alice's note**. A file
 * that only proved outsiders are locked out would pass against an owner-only
 * policy, which is the wrong feature — a board where you cannot fix your
 * housemate's typo is not a shared board.
 */

import { createUser, deleteUsers, uniqueEmail, uniqueInviteCode } from './clients';

jest.setTimeout(60_000);

describe('a shared note', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let joiner: Awaited<ReturnType<typeof createUser>>;
  let householdId: string;

  beforeAll(async () => {
    owner = await createUser(uniqueEmail('note-owner'), 'Owner');
    joiner = await createUser(uniqueEmail('note-joiner'), 'Joiner');

    const created = await owner.client.rpc('create_household', { household_name: 'Notes' });
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

  it('is written, read by the housemate, and edited by them', async () => {
    const written = await owner.client
      .from('household_notes')
      .insert({
        household_id: householdId,
        title: 'Boiler',
        body: 'Landlord said he would send someone.',
        created_by: owner.userId,
      })
      .select('id, updated_by')
      .single();
    expect(written.error).toBeNull();
    // Stamped by the trigger: the insert never mentioned `updated_by`.
    expect(written.data?.updated_by).toBe(owner.userId);

    const seen = await joiner.client.from('household_notes').select('id, body');
    expect(seen.error).toBeNull();
    expect(seen.data).toHaveLength(1);

    const edited = await joiner.client
      .from('household_notes')
      .update({ body: 'Chase him Friday.' })
      .eq('id', written.data?.id as string)
      .select('body, updated_by, created_by')
      .single();
    expect(edited.error).toBeNull();
    expect(edited.data?.body).toBe('Chase him Friday.');
    // Re-stamped to the editor — the footer's entire claim.
    expect(edited.data?.updated_by).toBe(joiner.userId);
    // And authorship is not rewritten by an edit.
    expect(edited.data?.created_by).toBe(owner.userId);
  });

  it('cannot be written under somebody else’s name', async () => {
    const forged = await joiner.client.from('household_notes').insert({
      household_id: householdId,
      body: 'not mine',
      created_by: owner.userId,
    });

    expect(forged.error).not.toBeNull();
  });

  it('is deleted by either of them', async () => {
    const written = await owner.client
      .from('household_notes')
      .insert({ household_id: householdId, body: 'temporary', created_by: owner.userId })
      .select('id')
      .single();
    expect(written.error).toBeNull();

    const removed = await joiner.client
      .from('household_notes')
      .delete()
      .eq('id', written.data?.id as string)
      .select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
  });
});
