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
  timesOfDay: [],
};

const ONCE: Schedule = {
  rule: { kind: 'once', dueOn: d('2026-02-14'), granularity: 'day' },
  startsOn: d('2026-02-14'),
  endsOn: null,
  timesOfDay: [],
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

/**
 * Rescheduling, which is the app's only upsert.
 *
 * It was broken in production and no test noticed, because every other write in
 * the app is a plain insert and the suite only covered those. `authenticated`
 * had SELECT, INSERT and DELETE on `chore_exceptions` but not UPDATE, and an
 * upsert compiles to `INSERT ... ON CONFLICT DO UPDATE` — so every reschedule
 * returned 403 and the occurrence silently never moved.
 *
 * These drive the same `on_conflict` shape the app does, as a real member.
 */
describe('a category default icon reaching existing chores', () => {
  let userId: string;
  let householdId: string;
  let token: string;

  beforeAll(async () => {
    const user = await createUser(uniqueEmail('icons'), 'Icon Tester');
    userId = user.userId;
    const created = await user.client.rpc('create_household', { household_name: 'Icon House' });
    if (created.error) throw new Error(created.error.message);
    householdId = created.data as string;
    const session = await user.client.auth.getSession();
    token = session.data.session?.access_token as string;
  });

  afterAll(async () => {
    await deleteUsers([userId]);
  });

  const asUser = () => {
    const stack = localStack();
    return createClient<Database>(stack.apiUrl, stack.publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  };

  const DAILY: Schedule = {
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: civilDate('2026-01-01'),
    endsOn: null,
    timesOfDay: [],
  };

  it('fills in chores with no icon and leaves chosen ones alone', async () => {
    const client = asUser();

    const category = await client
      .from('chore_categories')
      .insert({ household_id: householdId, name: 'Kitchen', position: 0 })
      .select('id')
      .single();
    expect(category.error).toBeNull();
    const categoryId = category.data?.id as string;

    const chores = await client
      .from('chores')
      .insert([
        {
          household_id: householdId,
          title: 'Unset',
          schedule: DAILY as never,
          created_by: userId,
          category_id: categoryId,
        },
        {
          household_id: householdId,
          title: 'Chosen',
          schedule: DAILY as never,
          created_by: userId,
          category_id: categoryId,
          icon: 'dog',
        },
        {
          household_id: householdId,
          title: 'Elsewhere',
          schedule: DAILY as never,
          created_by: userId,
        },
      ])
      .select('id, title');
    expect(chores.error).toBeNull();

    // The write the app makes when a category gains a default icon.
    await client
      .from('chore_categories')
      .update({ icon: 'silverware-fork-knife' })
      .eq('id', categoryId);
    const backfill = await client
      .from('chores')
      .update({ icon: 'silverware-fork-knife' })
      .eq('category_id', categoryId)
      .is('icon', null);
    expect(backfill.error).toBeNull();

    const after = await client.from('chores').select('title, icon').eq('household_id', householdId);
    expect(after.error).toBeNull();
    const byTitle = new Map((after.data ?? []).map((c) => [c.title, c.icon]));

    expect(byTitle.get('Unset')).toBe('silverware-fork-knife');
    // The one that matters: a deliberately chosen icon is never rewritten.
    expect(byTitle.get('Chosen')).toBe('dog');
    // And a chore in no category is untouched, rather than swept up by a
    // filter that forgot to scope itself.
    expect(byTitle.get('Elsewhere')).toBeNull();
  });
});

describe('rescheduling an occurrence', () => {
  let userId: string;
  let householdId: string;
  let choreId: string;
  let client: ReturnType<typeof createClient<Database>>;

  beforeAll(async () => {
    const user = await createUser(uniqueEmail('resched'), 'Resched Tester');
    userId = user.userId;

    const created = await user.client.rpc('create_household', { household_name: 'Resched House' });
    if (created.error) throw new Error(created.error.message);
    householdId = created.data as string;

    const session = await user.client.auth.getSession();
    const stack = localStack();
    client = createClient<Database>(stack.apiUrl, stack.publishableKey, {
      global: { headers: { Authorization: `Bearer ${session.data.session?.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const chore = await client
      .from('chores')
      .insert({
        household_id: householdId,
        title: 'Bins',
        schedule: DAILY as never,
        created_by: userId,
      })
      .select('id')
      .single();
    if (chore.error) throw new Error(chore.error.message);
    choreId = chore.data.id;
  });

  afterAll(async () => {
    await deleteUsers([userId]);
  });

  const move = (movedTo: string) =>
    client.from('chore_exceptions').upsert(
      {
        household_id: householdId,
        chore_id: choreId,
        occurrence_key: 'v1:bins:2026-01-04:0:-',
        kind: 'reschedule',
        due_on: d('2026-01-04'),
        moved_to: movedTo,
        created_by: userId,
      },
      { onConflict: 'chore_id,occurrence_key' },
    );

  it('moves an occurrence', async () => {
    const { error } = await move('2026-01-09');
    expect(error).toBeNull();

    const { data } = await client
      .from('chore_exceptions')
      .select('kind, moved_to')
      .eq('chore_id', choreId)
      .single();
    expect(data?.kind).toBe('reschedule');
    expect(data?.moved_to).toBe('2026-01-09');
  });

  it('moves it again, replacing the first move rather than colliding', async () => {
    // The upsert path — the one that was denied. Changing your mind twice must
    // not leave two exceptions arguing about the same occurrence.
    const { error } = await move('2026-01-11');
    expect(error).toBeNull();

    const { data } = await client
      .from('chore_exceptions')
      .select('moved_to')
      .eq('chore_id', choreId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.moved_to).toBe('2026-01-11');
  });

  it('will not let a stranger move it', async () => {
    const stranger = await createUser(uniqueEmail('resched-stranger'), 'Stranger');
    try {
      const { error } = await stranger.client
        .from('chore_exceptions')
        .update({ moved_to: '2026-02-01' })
        .eq('chore_id', choreId);
      // RLS filters rather than rejecting, so the honest assertion is that the
      // row is unchanged — not that an error was thrown.
      expect(error).toBeNull();

      const { data } = await client
        .from('chore_exceptions')
        .select('moved_to')
        .eq('chore_id', choreId)
        .single();
      expect(data?.moved_to).toBe('2026-01-11');
    } finally {
      await deleteUsers([stranger.userId]);
    }
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
