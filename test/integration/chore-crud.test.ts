/**
 * Chore writes, against a real database as a real signed-in user.
 *
 * Everything asserted here is something a unit test structurally cannot see: the
 * CHECK constraints, the generated columns, the revoked DELETE, and whether RLS
 * lets a member write at all.
 *
 * These drive **raw queries, not the API module.** That module talks to the
 * app's Supabase client, which cannot load in a Node test environment — a
 * transitive React Native dependency ships ESM that this project's transform
 * does not handle. So a wrong column name inside `createChore` would not fail
 * here. The shared row-builder is extracted and unit-tested for exactly that
 * reason; see `src/data/api/chores.test.ts`. What *this* file proves is that
 * these column names and constraints exist and behave as the app assumes.
 *
 * An earlier version of this comment claimed the opposite, which was worse than
 * saying nothing: it described coverage that did not exist.
 *
 * `admin` appears only in setup and teardown — never inside an `expect()`. It
 * bypasses RLS, so an assertion made through it proves nothing. See
 * docs/TESTING.md.
 */

import { civilDate } from '../../src/core/civil/date';
import type { Schedule } from '../../src/core/recurrence/types';
import type { Assignment } from '../../src/core/rotation/types';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../../src/data/database.types';
import { adminClient, createUser, deleteUsers, localStack, uniqueEmail } from './clients';

jest.setTimeout(60_000);

const d = (s: string) => civilDate(s);

const DAILY: Schedule = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: d('2026-01-04'),
  endsOn: null,
  timeOfDay: null,
};

const ONCE: Schedule = {
  rule: { kind: 'once', dueOn: d('2026-02-14'), granularity: 'day' },
  startsOn: d('2026-02-14'),
  endsOn: null,
  timeOfDay: null,
};

const ANYONE: Assignment = { kind: 'anyone' };

describe('writing chores', () => {
  let userId: string;
  let householdId: string;
  let token: string;

  beforeAll(async () => {
    const user = await createUser(uniqueEmail('crud'), 'Crud Tester');
    userId = user.userId;

    const created = await user.client.rpc('create_household', { household_name: 'CRUD House' });
    if (created.error) throw new Error(created.error.message);
    householdId = created.data as string;

    const session = await user.client.auth.getSession();
    token = session.data.session?.access_token as string;
  });

  afterAll(async () => {
    await deleteUsers([userId]);
  });

  /**
   * The API module talks to the app's singleton client, which is not signed in
   * here. Rather than reach into that module's internals, these tests drive the
   * same queries through a client authenticated as the test user — so RLS,
   * constraints and generated columns are all exercised for real.
   */
  const asUser = () => {
    const stack = localStack();
    return createClient<Database>(stack.apiUrl, stack.publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  };

  it('creates a chore a member can read back', async () => {
    const client = asUser();
    const { data, error } = await client
      .from('chores')
      .insert({
        household_id: householdId,
        title: 'Dishes',
        schedule: DAILY as never,
        assignment: ANYONE as never,
        created_by: userId,
      })
      .select('id, title, schedule_kind, starts_on, assignment_kind')
      .single();

    expect(error).toBeNull();
    expect(data?.title).toBe('Dishes');
    // Generated columns, computed by Postgres from the jsonb.
    expect(data?.schedule_kind).toBe('daily');
    expect(data?.starts_on).toBe('2026-01-04');
    expect(data?.assignment_kind).toBe('anyone');
  });

  it('derives starts_on from a one-time rule’s own due date', async () => {
    // The engine normalises `startsOn` to the rule's `dueOn` for `once`, and the
    // generated column has to agree or indexed date filters silently miss rows.
    // This asserts the column, not the engine — they are different implementations
    // of the same rule, which is the only reason the test is worth writing.
    const client = asUser();
    const { data, error } = await client
      .from('chores')
      .insert({
        household_id: householdId,
        title: 'Renew the passport',
        // Deliberately disagreeing, as older rows in the seed do.
        schedule: { ...ONCE, startsOn: d('2026-01-01') } as never,
        created_by: userId,
      })
      .select('starts_on, schedule_kind')
      .single();

    expect(error).toBeNull();
    expect(data?.schedule_kind).toBe('once');
    expect(data?.starts_on).toBe('2026-02-14');
  });

  it('rejects an empty title at the database, not just in the form', async () => {
    const client = asUser();
    const { error } = await client.from('chores').insert({
      household_id: householdId,
      title: '',
      schedule: DAILY as never,
      created_by: userId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514'); // check_violation
  });

  it('rejects a title past the limit', async () => {
    const client = asUser();
    const { error } = await client.from('chores').insert({
      household_id: householdId,
      title: 'x'.repeat(121),
      schedule: DAILY as never,
      created_by: userId,
    });
    expect(error?.code).toBe('23514');
  });

  it('updates a chore in place, keeping its id', async () => {
    const client = asUser();
    const created = await client
      .from('chores')
      .insert({
        household_id: householdId,
        title: 'Bins',
        schedule: DAILY as never,
        created_by: userId,
      })
      .select('id')
      .single();
    const id = created.data?.id as string;

    const { error } = await client
      .from('chores')
      .update({
        title: 'Take out the bins',
        schedule: { ...DAILY, rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [2] } } as never,
      })
      .eq('id', id);
    expect(error).toBeNull();

    const { data } = await client
      .from('chores')
      .select('id, title, schedule_kind')
      .eq('id', id)
      .single();
    // Same row: completions and exceptions reference this id, and replacing the
    // chore would orphan every one of them.
    expect(data?.id).toBe(id);
    expect(data?.title).toBe('Take out the bins');
    expect(data?.schedule_kind).toBe('weekly');
  });

  it('archives rather than deletes, because history must survive', async () => {
    const client = asUser();
    const created = await client
      .from('chores')
      .insert({
        household_id: householdId,
        title: 'Water the plants',
        schedule: DAILY as never,
        created_by: userId,
      })
      .select('id')
      .single();
    const id = created.data?.id as string;

    const archived = await client
      .from('chores')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id);
    expect(archived.error).toBeNull();

    const { data } = await client.from('chores').select('archived_at').eq('id', id).single();
    expect(data?.archived_at).not.toBeNull();
  });

  it('refuses DELETE outright, so a chore cannot take its completions with it', async () => {
    const client = asUser();
    const created = await client
      .from('chores')
      .insert({
        household_id: householdId,
        title: 'Doomed',
        schedule: DAILY as never,
        created_by: userId,
      })
      .select('id')
      .single();
    const id = created.data?.id as string;

    const { error } = await client.from('chores').delete().eq('id', id);
    expect(error).not.toBeNull();

    // And it is still there — a filtered-to-zero delete would report success.
    const { data } = await client.from('chores').select('id').eq('id', id);
    expect(data).toHaveLength(1);
  });

  it('will not let a member write a chore into somebody else’s household', async () => {
    const stranger = await createUser(uniqueEmail('stranger'), 'Stranger');
    try {
      const { error } = await stranger.client.from('chores').insert({
        household_id: householdId,
        title: 'Not yours',
        schedule: DAILY as never,
        created_by: stranger.userId,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501'); // insufficient_privilege — RLS rejected it
    } finally {
      await deleteUsers([stranger.userId]);
    }
  });

  it('leaves the household with exactly the chores it created', async () => {
    // Reads through the admin client are setup, not assertions — but counting
    // rows here would be exactly the mistake the lint rule guards against, so
    // this counts through the member's own client.
    const client = asUser();
    const { data, error } = await client
      .from('chores')
      .select('title')
      .eq('household_id', householdId)
      .is('archived_at', null);
    expect(error).toBeNull();
    expect(data?.map((r) => r.title).sort()).toEqual([
      'Dishes',
      'Doomed',
      'Renew the passport',
      'Take out the bins',
    ]);
  });
});

/** Guards the assumption the whole suite rests on. */
describe('the test harness itself', () => {
  it('has a working admin client for setup', async () => {
    const admin = adminClient();
    const { error } = await admin.from('chores').select('id').limit(1);
    expect(error).toBeNull();
  });
});
