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
select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1111111-1111-1111-1111-111111111111', 'pgtap-pl-alice@example.test', '{"display_name":"Alice"}'),
  ('a2222222-2222-2222-2222-222222222222', 'pgtap-pl-bob@example.test',   '{"display_name":"Bob"}'),
  -- In no household. She is the control for "whose day is this?": without a
  -- real outsider, an assertion about who a row may belong to is an assertion
  -- about the fixture having only one household.
  ('a3333333-3333-3333-3333-333333333333', 'pgtap-pl-carol@example.test', '{"display_name":"Carol"}');

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

/*
 * Alice planning Bob's day is now allowed, and this file asserted the opposite
 * until 2026-09-07. See docs/DECISIONS.md — putting something on your
 * housemate's day is the point of the change, not a hole in it.
 */
select lives_ok(
  $$ insert into public.plan_entries
       (household_id, user_id, chore_id, occurrence_key, planned_for, position)
     values ('aa000000-0000-0000-0000-000000000001',
             'a2222222-2222-2222-2222-222222222222',
             'ab000000-0000-0000-0000-000000000001',
             'v1:dishes:2026-08-28:0:-', '2026-08-28', 1) $$,
  'Alice can plan Bob''s day for him'
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

/*
 * Bob may now edit Alice's day, which is a reversal — this file asserted the
 * opposite until 2026-09-07. See docs/DECISIONS.md: for a two-person household
 * that trusts each other, owner-only writes made "she's out, I'll take that off
 * her day" impossible and protected nothing that needed protecting.
 */
with touched as (
  update public.plan_entries set position = 99
   where user_id = 'a1111111-1111-1111-1111-111111111111'
     and chore_id = 'ab000000-0000-0000-0000-000000000001'
     and planned_for = '2026-08-27'
  returning 1
)
select is((select count(*)::int from touched), 1, 'Bob can reorder Alice''s day');

/*
 * But not onto a chore he cannot see. Widening *who* may write must not widen
 * *what* they may write about — the private chore is the whole reason
 * `chore_is_visible` is on the check as well as the select.
 */
select throws_ok(
  $$ update public.plan_entries
        set chore_id = 'ab000000-0000-0000-0000-000000000002'
      where user_id = 'a1111111-1111-1111-1111-111111111111'
        and chore_id = 'ab000000-0000-0000-0000-000000000001'
        and planned_for = '2026-08-27' $$,
  '42501',
  'new row violates row-level security policy for table "plan_entries"',
  'and cannot repoint one at a chore he is not allowed to know exists'
);

with deleted as (
  delete from public.plan_entries
   where user_id = 'a1111111-1111-1111-1111-111111111111'
     and chore_id = 'ab000000-0000-0000-0000-000000000001'
     and planned_for = '2026-08-27'
  returning 1
)
select is((select count(*)::int from deleted), 1, 'and can take something off it');

/*
 * Whose day it is has to be somebody in the house.
 *
 * The owner-only policy got this for free: `user_id = auth.uid()` plus a
 * membership test meant the owner was a member. Widening the writer left
 * `user_id` constrained only by its foreign key, which points at `profiles` —
 * every user of the app. A review planted a row on a stranger and moved one of
 * Alice's into a household she is not in, both against a live database.
 *
 * Carol (`a3333333…`) exists and is in no household here, which is what makes
 * these two assertions about the policy rather than about the fixture — the
 * previous version of this test compared a count against a single-household
 * fixture and passed with RLS switched off entirely.
 */
select throws_ok(
  $$ insert into public.plan_entries
       (household_id, user_id, chore_id, occurrence_key, planned_for, position)
     values ('aa000000-0000-0000-0000-000000000001',
             'a3333333-3333-3333-3333-333333333333',
             'ab000000-0000-0000-0000-000000000001',
             'v1:dishes:2026-08-29:0:-', '2026-08-29', 1) $$,
  '42501',
  'new row violates row-level security policy for table "plan_entries"',
  'a row cannot be planted on somebody outside the household'
);

select throws_ok(
  $$ update public.plan_entries
        set user_id = 'a3333333-3333-3333-3333-333333333333'
      where user_id = 'a1111111-1111-1111-1111-111111111111'
        and planned_for = '2026-08-28' $$,
  '42501',
  'new row violates row-level security policy for table "plan_entries"',
  'nor handed to one by an update'
);

select * from finish();
rollback;
