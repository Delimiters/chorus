create extension if not exists pgtap with schema extensions;

-- The day plan, and the three things that must hold about it.
--
-- Both people can see both plans — knowing what your housemate has taken on is
-- most of the point of sharing a list — but a plan is a statement about what
-- somebody intends to do, so only its owner may write it. That is the same
-- asymmetry as flags and the opposite of completions, which either housemate
-- may record because they are facts about the household rather than intentions.
--
-- And a plan entry must not leak a private chore: "Alice has 6 things planned"
-- would otherwise count something Bob is not allowed to know exists.

begin;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1111111-1111-1111-1111-111111111111', 'pgtap-pl-alice@example.test', '{"display_name":"Alice"}'),
  ('a2222222-2222-2222-2222-222222222222', 'pgtap-pl-bob@example.test',   '{"display_name":"Bob"}');

insert into public.households (id, name, created_by, time_zone)
values ('aa000000-0000-0000-0000-000000000001', 'Plan House',
        'a1111111-1111-1111-1111-111111111111', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('aa000000-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('aa000000-0000-0000-0000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'member', 'pink');

-- A shared chore and one only Alice can see. The shared one is the control:
-- "Bob sees one entry" could otherwise pass by him seeing none at all.
insert into public.chores (id, household_id, title, schedule, assignment, private_to)
values
  ('ab000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001',
   'Wash the dishes',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', null),
  ('ab000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001',
   'Plan the surprise party',
   '{"rule":{"kind":"once","dueOn":"2026-03-01","granularity":"day"},"startsOn":"2026-03-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', 'a1111111-1111-1111-1111-111111111111');

insert into public.plan_entries
  (id, household_id, user_id, chore_id, occurrence_key, planned_for, position)
values
  ('ac000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001',
   'a1111111-1111-1111-1111-111111111111', 'ab000000-0000-0000-0000-000000000001',
   'v1:dishes:2026-08-27:0:-', '2026-08-27', 1),
  ('ac000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001',
   'a1111111-1111-1111-1111-111111111111', 'ab000000-0000-0000-0000-000000000002',
   'v1:party:2026-08-27:0:-', '2026-08-27', 2);

-- ── Alice ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111"}';

select is(
  (select count(*)::int from public.plan_entries),
  2,
  'Alice sees her whole plan, including the private chore she planned'
);

select lives_ok(
  $$ update public.plan_entries set position = 0.5
      where id = 'ac000000-0000-0000-0000-000000000001' $$,
  'and can reorder it, which is the commonest write this table takes'
);

select throws_ok(
  $$ insert into public.plan_entries
       (household_id, user_id, chore_id, occurrence_key, planned_for, position)
     values ('aa000000-0000-0000-0000-000000000001',
             'a2222222-2222-2222-2222-222222222222',
             'ab000000-0000-0000-0000-000000000001',
             'v1:dishes:2026-08-28:0:-', '2026-08-28', 1) $$,
  '42501',
  null,
  'Alice cannot plan Bob''s day for him'
);

select throws_ok(
  $$ insert into public.plan_entries
       (household_id, user_id, chore_id, occurrence_key, planned_for, position)
     values ('aa000000-0000-0000-0000-000000000001',
             'a1111111-1111-1111-1111-111111111111',
             'ab000000-0000-0000-0000-000000000001',
             'v1:dishes:2026-08-27:0:-', '2026-08-27', 9) $$,
  '23505',
  null,
  'planning the same occurrence twice in a day is refused, so the button can be optimistic'
);

select lives_ok(
  $$ insert into public.plan_entries
       (household_id, user_id, chore_id, occurrence_key, planned_for, position)
     values ('aa000000-0000-0000-0000-000000000001',
             'a1111111-1111-1111-1111-111111111111',
             'ab000000-0000-0000-0000-000000000001',
             'v1:dishes:2026-08-28:0:-', '2026-08-28', 1) $$,
  'but the same occurrence key on a different day is a different commitment'
);

-- ── Bob ──────────────────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222"}';

select is(
  (select count(*)::int from public.plan_entries
    where planned_for = '2026-08-27'),
  1,
  'Bob sees Alice planned the dishes, and not that she planned the party'
);

-- A plan entry names a chore, so without `chore_is_visible` the count alone
-- would tell Bob a chore exists that he cannot see.
select is(
  (select count(*)::int from public.plan_entries
    where chore_id = 'ab000000-0000-0000-0000-000000000002'),
  0,
  'the private chore''s entry is invisible to him specifically'
);

with touched as (
  update public.plan_entries set position = 99
   where user_id = 'a1111111-1111-1111-1111-111111111111'
  returning 1
)
select is((select count(*)::int from touched), 0, 'Bob cannot reorder Alice''s day');

with deleted as (
  delete from public.plan_entries
   where user_id = 'a1111111-1111-1111-1111-111111111111'
  returning 1
)
select is((select count(*)::int from deleted), 0, 'nor take something off it');

select * from finish();
rollback;
