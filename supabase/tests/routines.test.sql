-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- Routines: who can see what, and who can write it.
--
-- The asymmetry with chores is the feature under test. For a chore, either
-- housemate may complete or un-complete. For a routine, only the owner writes —
-- a housemate may look at a shared routine and may not touch it.
--
-- As everywhere in this suite: RLS filters SELECT silently, so a blocked read
-- asserts "got nothing back" and never "an error was raised". INSERT is
-- rejected outright (42501). UPDATE and DELETE are filtered, so those assert
-- that the row is unchanged — and the check runs as somebody who can see it.

begin;
select plan(16);

-- ── Fixture: one household, two members ───────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data)
values
  ('c1111111-1111-1111-1111-111111111111', 'pgtap-rt-alice@example.test', '{"display_name":"Alice"}'),
  ('c2222222-2222-2222-2222-222222222222', 'pgtap-rt-bob@example.test',   '{"display_name":"Bob"}'),
  ('c3333333-3333-3333-3333-333333333333', 'pgtap-rt-carol@example.test', '{"display_name":"Carol"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('ca000000-0000-0000-0000-000000000001', 'Routine House',
   'c1111111-1111-1111-1111-111111111111', 'UTC'),
  ('ca000000-0000-0000-0000-000000000002', 'Other House',
   'c3333333-3333-3333-3333-333333333333', 'UTC');

insert into public.household_members (household_id, user_id, role, accent, share_routine)
values
  ('ca000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 'owner', 'blue', false),
  ('ca000000-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222', 'member', 'pink', false),
  ('ca000000-0000-0000-0000-000000000002', 'c3333333-3333-3333-3333-333333333333', 'owner', 'blue', false);

-- Alice keeps two items: one she will share, one she never will.
insert into public.routine_items
  (id, household_id, user_id, title, schedule, time_of_day)
values
  ('cb000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
   'c1111111-1111-1111-1111-111111111111', 'Stretch',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}', '07:00'),
  ('cb000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001',
   'c1111111-1111-1111-1111-111111111111', 'Therapy',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}', '18:00');

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

-- ═══ Constraints, as the table owner ══════════════════════════════════════

select is(
  (select bucket from public.routine_items where title = 'Stretch'),
  'morning',
  'a specific time files the item into a bucket without the client saying so'
);

select is(
  (select bucket from public.routine_items where title = 'Therapy'),
  'evening',
  'and 18:00 is evening, not afternoon'
);

select throws_ok(
  $$ insert into public.routine_items (household_id, user_id, title, schedule, time_of_day, bucket_choice)
     values ('ca000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111',
             'Both', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
             '07:00', 'morning') $$,
  '23514', null,
  'an item cannot carry both a time and a bucket'
);

select throws_ok(
  $$ insert into public.routine_items (household_id, user_id, title, schedule)
     values ('ca000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111',
             'Neither', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}') $$,
  '23514', null,
  'nor neither — every item lands somewhere in the day'
);

-- A chore in the *other* household, to prove the link cannot cross.
insert into public.chores (id, household_id, title, schedule, created_by)
values ('cc000000-0000-0000-0000-000000000009', 'ca000000-0000-0000-0000-000000000002',
        'Not yours', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
        'c3333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ update public.routine_items
     set linked_chore_id = 'cc000000-0000-0000-0000-000000000009'
     where id = 'cb000000-0000-0000-0000-000000000001' $$,
  '23503', null,
  'a routine item cannot link to a chore in another household'
);

insert into public.chores (id, household_id, title, schedule, created_by)
values ('cc000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
        'Dishes', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
        'c1111111-1111-1111-1111-111111111111');

update public.routine_items set linked_chore_id = 'cc000000-0000-0000-0000-000000000001'
where id = 'cb000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ update public.routine_items set linked_chore_id = 'cc000000-0000-0000-0000-000000000001'
     where id = 'cb000000-0000-0000-0000-000000000002' $$,
  '23505', null,
  'one chore cannot be linked from two of the same person''s routine items'
);

-- ═══ Bob, in the same household, while Alice shares nothing ═══════════════

select pg_temp.become('c2222222-2222-2222-2222-222222222222');

select is_empty(
  $$ select id from public.routine_items
     where user_id = 'c1111111-1111-1111-1111-111111111111' $$,
  'a housemate sees nothing of a routine that is not shared'
);

select throws_ok(
  $$ insert into public.routine_items (household_id, user_id, title, schedule, bucket_choice)
     values ('ca000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111',
             'Forged', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}', 'morning') $$,
  '42501', null,
  'and cannot create one in somebody else''s name'
);

-- ═══ Alice turns sharing on ═══════════════════════════════════════════════

reset role;
update public.household_members set share_routine = true
where user_id = 'c1111111-1111-1111-1111-111111111111';

select pg_temp.become('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.routine_items
   where user_id = 'c1111111-1111-1111-1111-111111111111'),
  2,
  'once shared, a housemate can read the routine'
);

-- The point of "read-only for others".
select throws_ok(
  $$ insert into public.routine_completions
       (household_id, routine_item_id, user_id, occurrence_key, due_on, completed_on)
     values ('ca000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001',
             'c2222222-2222-2222-2222-222222222222', 'v1:x:2026-03-01:0:-',
             '2026-03-01', '2026-03-01') $$,
  '42501', null,
  'but cannot tick it off'
);

update public.routine_items set title = 'Hijacked'
where id = 'cb000000-0000-0000-0000-000000000001';
delete from public.routine_items where id = 'cb000000-0000-0000-0000-000000000002';

-- ═══ Alice checks the damage, because only she can see the rows ═══════════
--
-- Asserting as Bob would be worthless: he cannot read the rows either way, so
-- "no row is called Hijacked" would hold just as well if his UPDATE had gone
-- through. This suite has made that mistake before.

select pg_temp.become('c1111111-1111-1111-1111-111111111111');

select is(
  (select title from public.routine_items where id = 'cb000000-0000-0000-0000-000000000001'),
  'Stretch',
  'a housemate renaming a shared item changes nothing'
);

select is(
  (select count(*)::int from public.routine_items
   where id = 'cb000000-0000-0000-0000-000000000002'),
  1,
  'and deleting one deletes nothing'
);

select lives_ok(
  $$ insert into public.routine_completions
       (household_id, routine_item_id, user_id, occurrence_key, due_on, completed_on)
     values ('ca000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001',
             'c1111111-1111-1111-1111-111111111111', 'v1:stretch:2026-03-01:0:-',
             '2026-03-01', '2026-03-01') $$,
  'the owner can tick her own item'
);

-- ═══ Bob can see that she did ═════════════════════════════════════════════

select pg_temp.become('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.routine_completions
   where routine_item_id = 'cb000000-0000-0000-0000-000000000001'),
  1,
  'a housemate can see what was ticked on a shared routine'
);

-- Filtered, not rejected: the statement succeeds and touches nothing. Verified
-- as Alice for the same reason as above — Bob cannot read the row either way.
delete from public.routine_completions
where routine_item_id = 'cb000000-0000-0000-0000-000000000001';

select pg_temp.become('c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.routine_completions
   where routine_item_id = 'cb000000-0000-0000-0000-000000000001'),
  1,
  'but un-ticking it does nothing'
);

-- ═══ Carol, in a different household entirely ═════════════════════════════

select pg_temp.become('c3333333-3333-3333-3333-333333333333');

select is_empty(
  $$ select id from public.routine_items
     where household_id = 'ca000000-0000-0000-0000-000000000001' $$,
  'somebody in another household sees nothing, shared or not'
);

select * from finish();
rollback;
