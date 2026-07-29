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

    it('bob deleting alice’s chore affects nothing', async () => {
      const { error } = await bob.from('chores').delete().eq('id', choreA);
      expect(error).toBeNull();

      const check = await alice.from('chores').select('id').eq('id', choreA);
      expect(check.data).toHaveLength(1);
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
      const { error } = await alice
        .from('chore_completions')
        .update({ note: 'rewriting history' })
        .eq('chore_id', choreA);
      expect(error).not.toBeNull();
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
