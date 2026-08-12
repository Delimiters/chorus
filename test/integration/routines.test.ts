/**
 * Routines, against a real database.
 *
 * Two things only a live Postgres can prove, and which the pgTAP suite cannot
 * reach because it speaks SQL rather than PostgREST:
 *
 *   1. The bucket rule is written twice — once as a generated column and once
 *      in src/core/routines/buckets.ts — and the two must agree at every
 *      boundary. A drift here would file a 17:00 item in one place on the
 *      server and another on the phone.
 *   2. Privacy holds through the API layer, not just through `psql`.
 *
 * As everywhere in this suite, `admin` appears only in setup and teardown and
 * never inside an `expect()` — the service role bypasses RLS, so an assertion
 * through it proves nothing. A lint rule enforces this.
 */

import { createClient } from '@supabase/supabase-js';

import { bucketOf } from '../../src/core/routines/buckets';
import type { CivilTime } from '../../src/core/civil/types';
import type { Database } from '../../src/data/database.types';
import { createUser, deleteUsers, localStack, uniqueEmail, uniqueInviteCode } from './clients';

// Per file, not in the project config: a `testTimeout` set on a Jest *project*
// is silently ignored, which cost this repo a day once already.
jest.setTimeout(60_000);

const DAILY = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: '2026-01-01',
  endsOn: null,
  timesOfDay: [],
};

describe('routines', () => {
  let alice: { userId: string; token: string };
  let bob: { userId: string; token: string };
  let householdId: string;

  const clientFor = (token: string) => {
    const stack = localStack();
    return createClient<Database>(stack.apiUrl, stack.publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  };

  beforeAll(async () => {
    const a = await createUser(uniqueEmail('rt-alice'), 'Alice');
    const created = await a.client.rpc('create_household', { household_name: 'Routine House' });
    if (created.error) throw new Error(created.error.message);
    householdId = created.data as string;
    const aSession = await a.client.auth.getSession();
    alice = { userId: a.userId, token: aSession.data.session?.access_token as string };

    const b = await createUser(uniqueEmail('rt-bob'), 'Bob');
    const invite = await a.client
      .from('household_invites')
      .insert({ household_id: householdId, created_by: a.userId, code: uniqueInviteCode() })
      .select('code')
      .single();
    if (invite.error) throw new Error(invite.error.message);
    const redeemed = await b.client.rpc('redeem_invite', { invite_code: invite.data.code });
    if (redeemed.error) throw new Error(redeemed.error.message);
    const bSession = await b.client.auth.getSession();
    bob = { userId: b.userId, token: bSession.data.session?.access_token as string };
  });

  afterAll(async () => {
    await deleteUsers([alice.userId, bob.userId]);
  });

  describe('the bucket rule is the same on both sides', () => {
    // Every boundary, from both sides. If the generated column and
    // `bucketOf` ever disagree, an item shows up in one section on the phone
    // and a different one in anything computed server-side.
    const boundaries = [
      '04:59',
      '05:00',
      '11:59',
      '12:00',
      '16:59',
      '17:00',
      '20:59',
      '21:00',
      '00:00',
      '23:59',
    ];

    it.each(boundaries)('%s lands in the same bucket in the database and in core', async (time) => {
      const client = clientFor(alice.token);
      const { data, error } = await client
        .from('routine_items')
        .insert({
          household_id: householdId,
          user_id: alice.userId,
          title: `Boundary ${time}`,
          schedule: DAILY as never,
          time_of_day: time,
        })
        .select('bucket')
        .single();

      expect(error).toBeNull();
      expect(data?.bucket).toBe(bucketOf(time as CivilTime));
    });
  });

  describe('privacy, through the API rather than through psql', () => {
    let itemId: string;

    beforeAll(async () => {
      const client = clientFor(alice.token);
      const { data, error } = await client
        .from('routine_items')
        .insert({
          household_id: householdId,
          user_id: alice.userId,
          title: 'Private thing',
          schedule: DAILY as never,
          bucket_choice: 'morning',
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      itemId = data.id;
    });

    it('a housemate reads nothing while sharing is off', async () => {
      const { data, error } = await clientFor(bob.token)
        .from('routine_items')
        .select('id')
        .eq('user_id', alice.userId);

      // RLS filters silently: no error, no rows. Asserting on an error here
      // would pass forever while proving nothing.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('and reads them once she shares', async () => {
      await clientFor(alice.token)
        .from('household_members')
        .update({ share_routine: true })
        .eq('household_id', householdId)
        .eq('user_id', alice.userId);

      const { data, error } = await clientFor(bob.token)
        .from('routine_items')
        .select('id')
        .eq('user_id', alice.userId);

      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it('but still cannot tick one off', async () => {
      const { error } = await clientFor(bob.token).from('routine_completions').insert({
        household_id: householdId,
        routine_item_id: itemId,
        user_id: bob.userId,
        occurrence_key: 'v1:x:2026-03-01:0:-',
        due_on: '2026-03-01',
        completed_on: '2026-03-01',
      });

      // Rejected outright rather than filtered, because it is an INSERT.
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('and cannot rename one — verified by the owner, who can see it', async () => {
      await clientFor(bob.token)
        .from('routine_items')
        .update({ title: 'Hijacked' })
        .eq('id', itemId);

      // As Alice: Bob cannot read the row either way, so checking as him would
      // hold just as well if the update had gone through.
      const { data, error } = await clientFor(alice.token)
        .from('routine_items')
        .select('title')
        .eq('id', itemId)
        .single();

      expect(error).toBeNull();
      expect(data?.title).toBe('Private thing');
    });
  });

  describe('the chore link', () => {
    it('cannot point at a chore in another household', async () => {
      // Bob's own household, which Alice is not in.
      const outsider = await createUser(uniqueEmail('rt-outsider'), 'Outsider');
      const theirs = await outsider.client.rpc('create_household', { household_name: 'Elsewhere' });
      if (theirs.error) throw new Error(theirs.error.message);

      const chore = await outsider.client
        .from('chores')
        .insert({
          household_id: theirs.data as string,
          title: 'Not yours',
          schedule: DAILY as never,
          created_by: outsider.userId,
        })
        .select('id')
        .single();
      if (chore.error) throw new Error(chore.error.message);

      const { error } = await clientFor(alice.token)
        .from('routine_items')
        .insert({
          household_id: householdId,
          user_id: alice.userId,
          title: 'Cross-household link',
          schedule: DAILY as never,
          bucket_choice: 'morning',
          linked_chore_id: chore.data.id,
        });

      // The composite foreign key makes this unrepresentable rather than
      // merely forbidden — 23503 is the key, not a policy.
      expect(error?.code).toBe('23503');

      await deleteUsers([outsider.userId]);
    });
  });
});
