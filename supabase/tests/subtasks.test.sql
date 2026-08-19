create extension if not exists pgtap with schema extensions;

-- Subtasks, and the two ways they could leak a chore nobody is meant to see.
--
-- A step names its parent chore, and a tick names its step. So a private chore
-- has three tables that must agree about it, not one — the same shape that
-- made private chores a three-table change. The interesting assertions here
-- are the ones about Bob, who is in the household and must still see nothing.

begin;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('e1111111-1111-1111-1111-111111111111', 'pgtap-st-alice@example.test', '{"display_name":"Alice"}'),
  ('e2222222-2222-2222-2222-222222222222', 'pgtap-st-bob@example.test',   '{"display_name":"Bob"}');

insert into public.households (id, name, created_by, time_zone)
values ('ea000000-0000-0000-0000-000000000001', 'Steps House',
        'e1111111-1111-1111-1111-111111111111', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('ea000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('ea000000-0000-0000-0000-000000000001', 'e2222222-2222-2222-2222-222222222222', 'member', 'pink');

-- One shared chore and one Alice keeps to herself. The shared one is the
-- control: without it, "Bob sees one step" could pass by him seeing none.
insert into public.chores (id, household_id, title, schedule, assignment, private_to)
values
  ('eb000000-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-000000000001',
   'Clean the bathroom',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', null),
  ('eb000000-0000-0000-0000-000000000002', 'ea000000-0000-0000-0000-000000000001',
   'Plan the surprise party',
   '{"rule":{"kind":"once","dueOn":"2026-03-01","granularity":"day"},"startsOn":"2026-03-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', 'e1111111-1111-1111-1111-111111111111');

insert into public.chore_subtasks (id, household_id, chore_id, title, position)
values
  ('ec000000-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-000000000001',
   'eb000000-0000-0000-0000-000000000001', 'Scrub the bath', 0),
  ('ec000000-0000-0000-0000-000000000002', 'ea000000-0000-0000-0000-000000000001',
   'eb000000-0000-0000-0000-000000000002', 'Book the venue', 0);

insert into public.chore_subtask_ticks (household_id, subtask_id, occurrence_key, ticked_on, ticked_by)
values
  ('ea000000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-000000000001',
   'v1:bath:2026-02-01:0:-', '2026-02-01', 'e1111111-1111-1111-1111-111111111111'),
  ('ea000000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-000000000002',
   'v1:party:2026-03-01:0:-', '2026-03-01', 'e1111111-1111-1111-1111-111111111111');

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

-- ═══ Alice, who owns the private chore ════════════════════════════════════

select pg_temp.become('e1111111-1111-1111-1111-111111111111');

select is((select count(*)::int from public.chore_subtasks), 2,
          'the owner sees the steps of both chores');
select is((select count(*)::int from public.chore_subtask_ticks), 2,
          'and both ticks');

-- ═══ Bob, in the same household ═══════════════════════════════════════════

select pg_temp.become('e2222222-2222-2222-2222-222222222222');

select is((select count(*)::int from public.chore_subtasks), 1,
          'a housemate sees only the shared chore''s steps');
select is((select title from public.chore_subtasks), 'Scrub the bath',
          'and it is the right one, not merely a count that happens to be 1');

-- The reason this file exists. A step names its chore and a tick names its
-- step, so the obvious policy leaves the secret half-visible.
select is((select count(*)::int from public.chore_subtask_ticks), 1,
          'and only the shared chore''s ticks');

select is_empty(
  $$ select 1 from public.chore_subtasks
     where chore_id = 'eb000000-0000-0000-0000-000000000002' $$,
  'naming the private chore''s id directly returns nothing'
);

select is_empty(
  $$ select 1 from public.chore_subtask_ticks
     where subtask_id = 'ec000000-0000-0000-0000-000000000002' $$,
  'and so does naming its step through a tick'
);

select throws_ok(
  $$ insert into public.chore_subtasks (household_id, chore_id, title, position)
     values ('ea000000-0000-0000-0000-000000000001',
             'eb000000-0000-0000-0000-000000000002', 'Sneaked in', 1) $$,
  '42501', null,
  'and cannot add a step to a chore it cannot see'
);

select throws_ok(
  $$ insert into public.chore_subtask_ticks
       (household_id, subtask_id, occurrence_key, ticked_on)
     values ('ea000000-0000-0000-0000-000000000001',
             'ec000000-0000-0000-0000-000000000002', 'v1:party:2026-03-02:0:-', '2026-03-02') $$,
  '42501', null,
  'nor tick one of its steps'
);

-- ═══ What a housemate may do to a shared chore's steps ════════════════════

select lives_ok(
  $$ insert into public.chore_subtask_ticks
       (household_id, subtask_id, occurrence_key, ticked_on)
     values ('ea000000-0000-0000-0000-000000000001',
             'ec000000-0000-0000-0000-000000000001', 'v1:bath:2026-02-02:0:-', '2026-02-02') $$,
  'a housemate can tick a step on a shared chore'
);

-- Un-ticking is a delete and is deliberately not narrowed to the person who
-- ticked it: a shared chore is shared work, unlike a private routine.
select lives_ok(
  $$ delete from public.chore_subtask_ticks
     where subtask_id = 'ec000000-0000-0000-0000-000000000001'
       and occurrence_key = 'v1:bath:2026-02-01:0:-' $$,
  'and can un-tick one somebody else ticked'
);

select pg_temp.become('e1111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.chore_subtask_ticks
           where subtask_id = 'ec000000-0000-0000-0000-000000000001'
             and occurrence_key = 'v1:bath:2026-02-01:0:-'),
          0,
          'and it really went, checked as the only other person who can see it');

select * from finish();
rollback;
