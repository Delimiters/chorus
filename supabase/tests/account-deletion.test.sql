-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- Deleting an account: what goes, and much more importantly what stays.
--
-- The rule being tested is the one the schema was reshaped for: a person who
-- leaves takes their account with them and leaves the household's history
-- intact. Getting this wrong in the other direction is invisible until a
-- housemate opens the stats and finds a hole where March used to be.

begin;
select plan(14);

-- ── Fixture: one shared household, one solo household ─────────────────────
insert into auth.users (id, email, raw_user_meta_data)
values
  ('d1111111-1111-1111-1111-111111111111', 'pgtap-del-alice@example.test', '{"display_name":"Alice"}'),
  ('d2222222-2222-2222-2222-222222222222', 'pgtap-del-bob@example.test',   '{"display_name":"Bob"}'),
  ('d3333333-3333-3333-3333-333333333333', 'pgtap-del-solo@example.test',  '{"display_name":"Solo"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('da000000-0000-0000-0000-000000000001', 'Shared',
   'd1111111-1111-1111-1111-111111111111', 'UTC'),
  ('da000000-0000-0000-0000-000000000002', 'Solo',
   'd3333333-3333-3333-3333-333333333333', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('da000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('da000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'member', 'pink'),
  ('da000000-0000-0000-0000-000000000002', 'd3333333-3333-3333-3333-333333333333', 'owner', 'blue');

insert into public.chores (id, household_id, title, schedule, created_by)
values ('dc000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
        'Dishes', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
        'd1111111-1111-1111-1111-111111111111');

insert into public.chore_completions
  (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
values ('da000000-0000-0000-0000-000000000001', 'dc000000-0000-0000-0000-000000000001',
        'v1:dishes:2026-03-01:0:-', '2026-03-01', '2026-03-01',
        'd1111111-1111-1111-1111-111111111111');

/*
 * A note in the shared household, which this fixture did not have.
 *
 * Its absence made the whole file vacuous about `household_notes`, and the
 * note board's stamping trigger then broke account deletion outright: the
 * `on delete set null` referential update was treated as a client edit, the
 * author id was pinned straight back, and the foreign key refused it. Green
 * everywhere, because nothing here had a note.
 */
insert into public.household_notes (id, household_id, title, body, created_by)
values ('d0e00000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
        'Boiler', 'Chase the landlord.', 'd1111111-1111-1111-1111-111111111111');

create or replace function pg_temp.become(uid text) returns void
language plpgsql as $$
begin
  execute format('set local role authenticated');
  execute format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', uid, 'role', 'authenticated')::text
  );
end;
$$;

-- ── The name snapshot happens on insert ───────────────────────────────────

select is(
  (select completed_by_name from public.chore_completions
   where occurrence_key = 'v1:dishes:2026-03-01:0:-'),
  'Alice',
  'a completion records who did it by name, not only by id'
);

-- ═══ Alice leaves a household Bob still uses ═══════════════════════════════

select pg_temp.become('d1111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.delete_my_account() $$,
  'a member can delete their own account'
);
reset role;

select is(
  (select count(*)::int from auth.users
   where id = 'd1111111-1111-1111-1111-111111111111'),
  0,
  'the account is gone'
);

select is(
  (select count(*)::int from public.profiles
   where id = 'd1111111-1111-1111-1111-111111111111'),
  0,
  'so is the profile'
);

select is(
  (select count(*)::int from public.household_members
   where user_id = 'd1111111-1111-1111-1111-111111111111'),
  0,
  'and the membership'
);

-- The whole point of the migration.
select is(
  (select count(*)::int from public.chore_completions
   where occurrence_key = 'v1:dishes:2026-03-01:0:-'),
  1,
  'the completion survives, because it is Bob''s history too'
);

/*
 * The note survives too, and unattributed rather than not at all.
 *
 * Deleting the account must not take the household's written-down things with
 * it — the boiler still needs chasing — and the author columns are `on delete
 * set null` precisely so the text outlives the person. Reaching this assertion
 * at all is the test: before the stamping trigger was taught to recognise a
 * referential null-out, `delete_my_account()` aborted here with a foreign key
 * violation and none of the rows below existed to be counted.
 */
select is(
  (select body from public.household_notes
   where id = 'd0e00000-0000-0000-0000-000000000001'),
  'Chase the landlord.',
  'the note survives, because it is the household''s and not hers'
);

select ok(
  (select created_by is null and updated_by is null from public.household_notes
   where id = 'd0e00000-0000-0000-0000-000000000001'),
  'with both author columns cleared rather than pointing at a deleted profile'
);

select is(
  (select completed_by from public.chore_completions
   where occurrence_key = 'v1:dishes:2026-03-01:0:-'),
  null,
  'its author is forgotten'
);

select is(
  (select completed_by_name from public.chore_completions
   where occurrence_key = 'v1:dishes:2026-03-01:0:-'),
  'Alice',
  'but the history still says who did it'
);

select is(
  (select count(*)::int from public.chores
   where id = 'dc000000-0000-0000-0000-000000000001'),
  1,
  'the chore survives too'
);

select is(
  (select count(*)::int from public.households
   where id = 'da000000-0000-0000-0000-000000000001'),
  1,
  'and the household, because Bob is still in it'
);

-- ═══ Solo leaves a household nobody else uses ══════════════════════════════

select pg_temp.become('d3333333-3333-3333-3333-333333333333');
select lives_ok(
  $$ select public.delete_my_account() $$,
  'the last member can delete their account too'
);
reset role;

select is(
  (select count(*)::int from public.households
   where id = 'da000000-0000-0000-0000-000000000002'),
  0,
  'a household with nobody left in it goes, rather than leaking forever'
);

select * from finish();
rollback;
