/**
 * Household isolation, proven through the real client library.
 *
 * The pgTAP suite already proves this at the SQL level. This suite proves it
 * through PostgREST and supabase-js — the exact path the app takes — because
 * a policy can be correct while a missing GRANT or an exposed view still leaks.
 *
 * THE CRITICAL RULE: RLS filters silently. A blocked SELECT returns
 * `{ data: [], error: null }`, not an error. Every assertion here checks the
 * data is empty; asserting "an error was thrown" would pass forever while
 * proving nothing.
 */

import {
  adminClient,
  anonClient,
  createUser,
  deleteUsers,
  uniqueEmail,
  uniqueInviteCode,
  type Client,
} from './clients';

jest.setTimeout(60_000);

const DAILY = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: '2026-01-04',
  endsOn: null,
  timeOfDay: null,
} as const;

/**
 * The second person in a household is an equal, not a guest.
 *
 * Invites and household settings used to be gated behind owner-or-admin, and
 * nothing in the app ever promotes anybody — so whoever tapped "create" first
 * was permanently the only person who could invite a third housemate or change
 * when weeks start. Worse, the second person's taps did nothing *and said
 * nothing*: RLS filters rather than rejects, so the update matched zero rows,
 * returned 204, and the setting snapped back on the next refetch.
 */
describe('a joined member has the same rights as the founder', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let joiner: Awaited<ReturnType<typeof createUser>>;
  let householdId: string;

  beforeAll(async () => {
    owner = await createUser(uniqueEmail('equal-owner'), 'Owner');
    joiner = await createUser(uniqueEmail('equal-joiner'), 'Joiner');

    const created = await owner.client.rpc('create_household', { household_name: 'Equals' });
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

  it('lets the joiner invite a third person', async () => {
    const { error } = await joiner.client.from('household_invites').insert({
      household_id: householdId,
      code: uniqueInviteCode(),
      created_by: joiner.userId,
    });
    expect(error).toBeNull();
  });

  it('lets the joiner change household settings, and the change sticks', async () => {
    // Asserted by reading the value back, not by the absence of an error — a
    // filtered update reports success while changing nothing, which is the
    // failure this test exists for.
    const { error } = await joiner.client
      .from('households')
      .update({ week_starts_on: 1 })
      .eq('id', householdId);
    expect(error).toBeNull();

    const { data } = await joiner.client
      .from('households')
      .select('week_starts_on')
      .eq('id', householdId)
      .single();
    expect(data?.week_starts_on).toBe(1);
  });

  it('still refuses to let the joiner delete the household', async () => {
    // Equal is not the same as unlimited. Destroying a year of history is not
    // symmetric with changing when weeks start.
    await joiner.client.from('households').delete().eq('id', householdId);
    const { data } = await joiner.client.from('households').select('id').eq('id', householdId);
    expect(data).toHaveLength(1);
  });
});

describe('household isolation', () => {
  let alice: Client;
  let bob: Client;
  let aliceId: string;
  let bobId: string;
  let houseA: string;
  let houseB: string;
  let choreA: string;

  beforeAll(async () => {
    const a = await createUser(uniqueEmail('alice'), 'Alice');
    const b = await createUser(uniqueEmail('bob'), 'Bob');
    alice = a.client;
    bob = b.client;
    aliceId = a.userId;
    bobId = b.userId;

    // Each user creates their own household through the RPC, which is how the
    // app does it — so this also exercises create_household().
    const ra = await alice.rpc('create_household', { household_name: 'House A' });
    if (ra.error) throw new Error(ra.error.message);
    houseA = ra.data as string;

    const rb = await bob.rpc('create_household', { household_name: 'House B' });
    if (rb.error) throw new Error(rb.error.message);
    houseB = rb.data as string;

    const chore = await alice
      .from('chores')
      .insert({
        household_id: houseA,
        title: 'Dishes',
        schedule: DAILY,
        created_by: aliceId,
      })
      .select('id')
      .single();
    if (chore.error) throw new Error(chore.error.message);
    choreA = chore.data.id;
  });

  afterAll(async () => {
    await deleteUsers([aliceId, bobId]);
  });

  describe('reads are filtered, not rejected', () => {
    it('bob sees no chores from house A', async () => {
      const { data, error } = await bob.from('chores').select('*').eq('household_id', houseA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('bob sees no household A row', async () => {
      const { data, error } = await bob.from('households').select('*').eq('id', houseA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('bob sees no house A membership', async () => {
      const { data, error } = await bob
        .from('household_members')
        .select('*')
        .eq('household_id', houseA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('bob sees no house A completions', async () => {
      const { data, error } = await bob
        .from('chore_completions')
        .select('*')
        .eq('household_id', houseA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('bob cannot read alice’s profile', async () => {
      const { data, error } = await bob.from('profiles').select('*').eq('id', aliceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('an unscoped select returns only bob’s own household', async () => {
      // The most important shape of this test: no filter at all. If isolation
      // were broken, this is where every household in the database would appear.
      const { data, error } = await bob.from('chores').select('household_id');
      expect(error).toBeNull();
      expect(data?.every((row) => row.household_id === houseB)).toBe(true);
    });

    it('alice sees exactly her own chore', async () => {
      const { data, error } = await alice.from('chores').select('id, title');
      expect(error).toBeNull();
      expect(data).toEqual([{ id: choreA, title: 'Dishes' }]);
    });
  });

  describe('writes are rejected', () => {
    it('bob cannot insert into house A', async () => {
      const { error } = await bob.from('chores').insert({
        household_id: houseA,
        title: 'Injected',
        schedule: DAILY,
        created_by: bobId,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('bob cannot claim to be alice when inserting into his own household', async () => {
      const { error } = await bob.from('chores').insert({
        household_id: houseB,
        title: 'Spoofed author',
        schedule: DAILY,
        created_by: aliceId,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('bob updating alice’s chore affects nothing', async () => {
      const { data, error } = await bob
        .from('chores')
        .update({ title: 'Hijacked' })
        .eq('id', choreA)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const check = await alice.from('chores').select('title').eq('id', choreA).single();
      expect(check.data?.title).toBe('Dishes');
    });

    it('nobody can hard-delete a chore, not even its own household', async () => {
      // DELETE is revoked outright: cascading it would erase the completion log
      // the stats feature depends on, and the schema comment promises history
      // survives deleting a chore. Archiving is the only removal the app offers.
      for (const [who, client] of [
        ['bob', bob],
        ['alice', alice],
      ] as const) {
        const { error } = await client.from('chores').delete().eq('id', choreA);
        expect(error).not.toBeNull();
        expect(error?.code).toBe('42501');
        expect(who).toBeTruthy();
      }

      const check = await alice.from('chores').select('id').eq('id', choreA);
      expect(check.data).toHaveLength(1);
    });

    it('archiving is the supported way to remove a chore, and keeps completions', async () => {
      const key = 'v1:archive-keeps-history:2026-01-09:0:-';
      await alice.from('chore_completions').insert({
        household_id: houseA,
        chore_id: choreA,
        occurrence_key: key,
        due_on: '2026-01-09',
        completed_on: '2026-01-09',
        completed_by: aliceId,
      });

      const archived = await alice
        .from('chores')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', choreA)
        .select('id, archived_at')
        .single();
      expect(archived.error).toBeNull();
      expect(archived.data?.archived_at).not.toBeNull();

      // The whole point: history outlives the chore's removal.
      const history = await alice
        .from('chore_completions')
        .select('occurrence_key')
        .eq('occurrence_key', key);
      expect(history.data).toHaveLength(1);

      // Put it back so later tests see the chore unarchived.
      await alice.from('chores').update({ archived_at: null }).eq('id', choreA);
      await alice.from('chore_completions').delete().eq('occurrence_key', key);
    });

    it('alice cannot forge a completion attributed to bob', async () => {
      const { error } = await alice.from('chore_completions').insert({
        household_id: houseA,
        chore_id: choreA,
        occurrence_key: 'v1:forged:2026-01-04:0:-',
        due_on: '2026-01-04',
        completed_on: '2026-01-04',
        completed_by: bobId,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });
  });

  describe('completion idempotency', () => {
    const key = 'v1:idem:2026-01-05:0:-';

    it('the same occurrence cannot be completed twice', async () => {
      const row = {
        household_id: houseA,
        chore_id: choreA,
        occurrence_key: key,
        due_on: '2026-01-05',
        completed_on: '2026-01-05',
        completed_by: aliceId,
      };

      const first = await alice.from('chore_completions').insert(row);
      expect(first.error).toBeNull();

      // This is the guarantee optimistic completion depends on: a retry raises
      // 23505 rather than creating a duplicate, and the API layer treats that
      // as success.
      const second = await alice.from('chore_completions').insert(row);
      expect(second.error?.code).toBe('23505');
    });

    it('un-completing is idempotent too', async () => {
      const first = await alice.from('chore_completions').delete().eq('occurrence_key', key);
      expect(first.error).toBeNull();
      const second = await alice.from('chore_completions').delete().eq('occurrence_key', key);
      expect(second.error).toBeNull();
    });
  });

  describe('append-only event log', () => {
    it('completions cannot be updated, only inserted and deleted', async () => {
      // No UPDATE grant, so PostgREST rejects it outright.
      //
      // The code is asserted as well as the presence of an error. This failed
      // once in CI with `error` null and could not be reproduced locally; with
      // only `not.toBeNull()` the report said nothing about *why*, which is the
      // difference between a lead and a shrug. 42501 is insufficient privilege
      // — the grant — and anything else here means something other than the
      // guarantee this test is named for.
      const { error } = await alice
        .from('chore_completions')
        .update({ note: 'rewriting history' })
        .eq('chore_id', choreA);
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });
  });

  describe('invites', () => {
    let code: string;

    beforeAll(async () => {
      code = uniqueInviteCode();
      const admin = adminClient();
      const { error } = await admin.from('household_invites').insert({
        household_id: houseA,
        code,
        created_by: aliceId,
      });
      if (error) throw new Error(error.message);
    });

    it('bob cannot look up an invite by code', async () => {
      const { data, error } = await bob.from('household_invites').select('*').eq('code', code);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('an unknown code is rejected', async () => {
      const { error } = await bob.rpc('redeem_invite', { invite_code: 'ZZZZZZZZ' });
      expect(error).not.toBeNull();
      expect(error?.message).toContain('invalid_invite_code');
    });

    it('bob can redeem a code he cannot read, and then sees the household', async () => {
      const redeem = await bob.rpc('redeem_invite', { invite_code: code });
      expect(redeem.error).toBeNull();
      expect(redeem.data).toBe(houseA);

      // Proof the isolation above was membership-based, not incidental.
      const { data } = await bob.from('chores').select('id').eq('household_id', houseA);
      expect(data).toHaveLength(1);
    });

    it('a redeemed code cannot be reused', async () => {
      const { error } = await bob.rpc('redeem_invite', { invite_code: code });
      expect(error).not.toBeNull();
      expect(error?.message).toContain('invite_already_used');
    });
  });
});

describe('the anonymous role', () => {
  it('cannot read any table', async () => {
    const anon = anonClient();
    for (const table of [
      'chores',
      'households',
      'household_members',
      'chore_completions',
      'chore_exceptions',
      'profiles',
      'push_tokens',
      'household_invites',
    ] as const) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      // Either a hard permission error or an empty set is acceptable; leaking a
      // row is not.
      expect(data ?? []).toEqual([]);
      if (error) expect(['42501', 'PGRST301', '42P01']).toContain(error.code);
    }
  });
});

describe('PostgREST embeds', () => {
  // Regression guard. household_members.user_id originally referenced
  // auth.users, which is not an exposed schema — so PostgREST could not embed
  // profiles and the member list came back as a 400. See the
  // reference_profiles_for_api_embedding migration.
  it('can embed profiles from household_members', async () => {
    const { client, userId } = await createUser(uniqueEmail('embed'), 'Embed');
    const created = await client.rpc('create_household', { household_name: 'Embed House' });
    expect(created.error).toBeNull();

    const { data, error } = await client
      .from('household_members')
      .select('user_id, role, accent, profiles!inner(display_name)')
      .eq('household_id', created.data as string);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.profiles).toMatchObject({ display_name: 'Embed' });
    expect(data?.[0]?.accent).toBe('blue');

    await deleteUsers([userId]);
  });

  it('can embed the completer of a chore', async () => {
    // The same embed the history view needs: "completed by Sam".
    const { client, userId } = await createUser(uniqueEmail('completer'), 'Completer');
    const created = await client.rpc('create_household', { household_name: 'Completer House' });
    const householdId = created.data as string;

    const chore = await client
      .from('chores')
      .insert({
        household_id: householdId,
        title: 'Dishes',
        schedule: DAILY,
        created_by: userId,
      })
      .select('id')
      .single();

    await client.from('chore_completions').insert({
      household_id: householdId,
      chore_id: chore.data?.id as string,
      occurrence_key: 'v1:embed:2026-01-04:0:-',
      due_on: '2026-01-04',
      completed_on: '2026-01-04',
      completed_by: userId,
    });

    const { data, error } = await client
      .from('chore_completions')
      .select('occurrence_key, profiles!inner(display_name)')
      .eq('household_id', householdId);

    expect(error).toBeNull();
    expect(data?.[0]?.profiles).toMatchObject({ display_name: 'Completer' });

    await deleteUsers([userId]);
  });
});

describe('ink assignment', () => {
  // Regression guard. household_members.accent is unique per household, and
  // redeem_invite originally relied on the column default — so every second
  // member arrived as 'blue', collided with the owner, and joining failed
  // outright with a unique violation.
  it('gives each person joining a household a different ink', async () => {
    const owner = await createUser(uniqueEmail('ink-owner'), 'Owner');
    const joiner = await createUser(uniqueEmail('ink-joiner'), 'Joiner');
    const third = await createUser(uniqueEmail('ink-third'), 'Third');

    const created = await owner.client.rpc('create_household', { household_name: 'Ink House' });
    const householdId = created.data as string;

    const admin = adminClient();
    for (const client of [joiner.client, third.client]) {
      const code = uniqueInviteCode();
      const invite = await admin.from('household_invites').insert({
        household_id: householdId,
        code,
        created_by: owner.userId,
      });
      expect(invite.error).toBeNull();

      const redeem = await client.rpc('redeem_invite', { invite_code: code });
      expect(redeem.error).toBeNull();
    }

    const { data } = await owner.client
      .from('household_members')
      .select('accent')
      .eq('household_id', householdId);

    const inks = (data ?? []).map((r) => r.accent);
    expect(inks).toHaveLength(3);
    expect(new Set(inks).size).toBe(3);
    // The founder takes the first ink, so the design's default look survives.
    expect(inks).toContain('blue');

    await deleteUsers([owner.userId, joiner.userId, third.userId]);
  });
});
