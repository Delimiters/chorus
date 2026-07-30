-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- Household isolation, proven by impersonating real users in-transaction.
--
-- The critical thing to understand about testing RLS: it filters SILENTLY.
-- A blocked SELECT returns zero rows and no error. So the assertion has to be
-- "got nothing back", never "an error was raised" — the latter passes forever
-- while proving nothing. See docs/TESTING.md.

begin;
select plan(18);

-- ── Fixture: two households, three users ──────────────────────────────────
--
-- IDs and emails are prefixed so they cannot collide with supabase/seed.sql, which
-- `supabase db reset` applies before these tests run. An earlier version reused
-- the seed's UUIDs and failed only in CI, where reset-then-test is the order.
-- Inserted as the table owner, bypassing RLS, which is exactly what setup is
-- for. Every assertion below runs as alice or bob.

insert into auth.users (id, email, raw_user_meta_data)
values
  ('f1111111-1111-1111-1111-111111111111', 'pgtap-alice@example.test', '{"display_name":"Alice"}'),
  ('f2222222-2222-2222-2222-222222222222', 'pgtap-bob@example.test',   '{"display_name":"Bob"}'),
  ('f3333333-3333-3333-3333-333333333333', 'pgtap-sam@example.test',   '{"display_name":"Sam"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('fa000000-0000-0000-0000-000000000001', 'House A',
   'f1111111-1111-1111-1111-111111111111', 'America/Denver'),
  ('fb000000-0000-0000-0000-000000000002', 'House B',
   'f2222222-2222-2222-2222-222222222222', 'UTC');

insert into public.household_members (household_id, user_id, role)
values
  ('fa000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111111', 'owner'),
  ('fa000000-0000-0000-0000-000000000001', 'f3333333-3333-3333-3333-333333333333', 'member'),
  ('fb000000-0000-0000-0000-000000000002', 'f2222222-2222-2222-2222-222222222222', 'owner');

insert into public.chores (id, household_id, title, schedule, created_by)
values
  ('fc000000-0000-0000-0000-000000000001',
   'fa000000-0000-0000-0000-000000000001', 'Dishes',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timeOfDay":null}',
   'f1111111-1111-1111-1111-111111111111'),
  ('fc000000-0000-0000-0000-000000000002',
   'fb000000-0000-0000-0000-000000000002', 'Bob''s bins',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timeOfDay":null}',
   'f2222222-2222-2222-2222-222222222222');

insert into public.chore_completions
  (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
values
  ('fa000000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001',
   'v1:fc000000-0000-0000-0000-000000000001:2026-01-01:0:-',
   '2026-01-01', '2026-01-01', 'f1111111-1111-1111-1111-111111111111');

insert into public.household_invites (household_id, code, created_by)
values ('fa000000-0000-0000-0000-000000000001', 'JN4PQ7XK',
        'f1111111-1111-1111-1111-111111111111');

-- ── Helper to become a user ───────────────────────────────────────────────
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

-- ═══ Bob (House B) must see nothing belonging to House A ═══════════════════
select pg_temp.become('f2222222-2222-2222-2222-222222222222');

select is_empty(
  $$ select id from public.chores
     where household_id = 'fa000000-0000-0000-0000-000000000001' $$,
  'bob cannot read house A chores'
);

select is_empty(
  $$ select id from public.households
     where id = 'fa000000-0000-0000-0000-000000000001' $$,
  'bob cannot read house A itself'
);

select is_empty(
  $$ select id from public.household_members
     where household_id = 'fa000000-0000-0000-0000-000000000001' $$,
  'bob cannot read house A membership'
);

select is_empty(
  $$ select id from public.chore_completions
     where household_id = 'fa000000-0000-0000-0000-000000000001' $$,
  'bob cannot read house A completions'
);

select is_empty(
  $$ select id from public.household_invites where code = 'JN4PQ7XK' $$,
  'bob cannot look up an invite code he was not given'
);

-- Sam is in house A but not in house B, so bob must not see sam's profile.
select is_empty(
  $$ select id from public.profiles
     where id = 'f3333333-3333-3333-3333-333333333333' $$,
  'bob cannot read the profile of someone he shares no household with'
);

select ok(
  not private.is_household_member('fa000000-0000-0000-0000-000000000001'),
  'the membership helper says bob is not in house A'
);

-- ── Bob must not be able to write into House A ────────────────────────────
select throws_ok(
  $$ insert into public.chores (household_id, title, schedule, created_by)
     values ('fa000000-0000-0000-0000-000000000001', 'Injected',
             '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
             'f2222222-2222-2222-2222-222222222222') $$,
  '42501',
  null,
  'bob cannot insert a chore into house A'
);

-- UPDATE and DELETE are filtered, not rejected: zero rows affected.
update public.chores set title = 'Hijacked'
  where id = 'fc000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.chores where title = 'Hijacked'),
  0,
  'bob updating a house A chore affects nothing'
);

-- DELETE on chores is revoked entirely: a hard delete would cascade away the
-- completion log the stats feature depends on. Archiving is the only removal.
select throws_ok(
  $$ delete from public.chores where id = 'fc000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'nobody can hard-delete a chore, because it would erase its completion history'
);

-- ═══ Alice (House A) sees her own data, and only hers ══════════════════════
select pg_temp.become('f1111111-1111-1111-1111-111111111111');

select is(
  (select title from public.chores
   where id = 'fc000000-0000-0000-0000-000000000001'),
  'Dishes',
  'the chore bob tried to hijack and delete is untouched'
);

select is(
  (select count(*)::int from public.chores),
  1,
  'alice sees exactly her one chore, not house B''s'
);

select is(
  (select count(*)::int from public.profiles),
  2,
  'alice sees her own profile and her housemate''s, not bob''s'
);

-- A member must not be able to attribute a completion to someone else.
select throws_ok(
  $$ insert into public.chore_completions
       (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
     values ('fa000000-0000-0000-0000-000000000001',
             'fc000000-0000-0000-0000-000000000001',
             'v1:forged:2026-02-01:0:-', '2026-02-01', '2026-02-01',
             'f3333333-3333-3333-3333-333333333333') $$,
  '42501',
  null,
  'alice cannot forge a completion attributed to her housemate'
);

-- Idempotency: the same occurrence cannot be completed twice.
select throws_ok(
  $$ insert into public.chore_completions
       (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
     values ('fa000000-0000-0000-0000-000000000001',
             'fc000000-0000-0000-0000-000000000001',
             'v1:fc000000-0000-0000-0000-000000000001:2026-01-01:0:-',
             '2026-01-01', '2026-01-01', 'f1111111-1111-1111-1111-111111111111') $$,
  '23505',
  null,
  'completing the same occurrence twice raises a unique violation'
);

-- ═══ Invite redemption ════════════════════════════════════════════════════
select pg_temp.become('f2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ select public.redeem_invite('NOTACODE') $$,
  'P0002', null,
  'redeeming an unknown code fails'
);

select is(
  public.redeem_invite('JN4PQ7XK'),
  'fa000000-0000-0000-0000-000000000001'::uuid,
  'bob can redeem a valid code without ever being able to read it'
);

-- Having joined, bob can now see house A — which proves the isolation above
-- was membership-based rather than an artefact of something else being broken.
select is(
  (select count(*)::int from public.chores
   where household_id = 'fa000000-0000-0000-0000-000000000001'),
  1,
  'after joining, bob can read house A chores'
);

select * from finish();
rollback;
