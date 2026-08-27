create extension if not exists pgtap with schema extensions;

-- Flags, and the one asymmetry that makes them different from everything else.
--
-- Completions are household facts: either person may record or undo one,
-- because a two-person household is a trust relationship. A flag is not a fact
-- about the household, it is a statement about what somebody is worrying
-- about — so both people can *see* both flags, and neither can set or clear
-- the other's. That read/write split is the whole of what is tested here,
-- along with the usual private-chore leak.

begin;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('f1111111-1111-1111-1111-111111111111', 'pgtap-fl-alice@example.test', '{"display_name":"Alice"}'),
  ('f2222222-2222-2222-2222-222222222222', 'pgtap-fl-bob@example.test',   '{"display_name":"Bob"}');

insert into public.households (id, name, created_by, time_zone)
values ('fa000000-0000-0000-0000-000000000001', 'Flag House',
        'f1111111-1111-1111-1111-111111111111', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('fa000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('fa000000-0000-0000-0000-000000000001', 'f2222222-2222-2222-2222-222222222222', 'member', 'pink');

-- A shared chore and one only Alice can see. The shared one is the control:
-- "Bob sees one flag" could otherwise pass by him seeing none at all.
insert into public.chores (id, household_id, title, schedule, assignment, private_to)
values
  ('fb000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001',
   'Get the car inspected',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', null),
  ('fb000000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000001',
   'Plan the surprise party',
   '{"rule":{"kind":"once","dueOn":"2026-03-01","granularity":"day"},"startsOn":"2026-03-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', 'f1111111-1111-1111-1111-111111111111');

insert into public.chore_flags (id, household_id, chore_id, user_id, flagged_on)
values
  ('fc000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001',
   'fb000000-0000-0000-0000-000000000001', 'f1111111-1111-1111-1111-111111111111', '2026-08-27'),
  ('fc000000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000001',
   'fb000000-0000-0000-0000-000000000002', 'f1111111-1111-1111-1111-111111111111', '2026-08-27');

-- ── Alice ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"f1111111-1111-1111-1111-111111111111"}';

select is(
  (select count(*)::int from public.chore_flags),
  2,
  'Alice sees both of her flags, including the one on her private chore'
);

select lives_ok(
  $$ insert into public.chore_flags (household_id, chore_id, user_id, flagged_on)
     values ('fa000000-0000-0000-0000-000000000001',
             'fb000000-0000-0000-0000-000000000001',
             'f1111111-1111-1111-1111-111111111111', '2026-09-03')
     on conflict (chore_id, user_id) do update set flagged_on = excluded.flagged_on $$,
  'Re-flagging moves the date rather than stacking a second row'
);

select is(
  (select flagged_on::text from public.chore_flags
    where chore_id = 'fb000000-0000-0000-0000-000000000001'
      and user_id = 'f1111111-1111-1111-1111-111111111111'),
  '2026-09-03',
  'and the upsert really moved it'
);

select throws_ok(
  $$ insert into public.chore_flags (household_id, chore_id, user_id, flagged_on)
     values ('fa000000-0000-0000-0000-000000000001',
             'fb000000-0000-0000-0000-000000000001',
             'f2222222-2222-2222-2222-222222222222', '2026-08-27') $$,
  '42501',
  null,
  'Alice cannot raise a flag in Bob''s name'
);

-- ── Bob ──────────────────────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"f2222222-2222-2222-2222-222222222222"}';

select is(
  (select count(*)::int from public.chore_flags),
  1,
  'Bob sees Alice''s flag on the shared chore, and not the one on her private chore'
);

select is(
  (select count(*)::int from public.chore_flags
    where chore_id = 'fb000000-0000-0000-0000-000000000002'),
  0,
  'the private chore''s flag is invisible to him specifically'
);

-- The asymmetry with completions, stated as a test. Either housemate may
-- un-complete a chore; neither may un-worry the other.
-- A data-modifying statement has to be a CTE; it cannot sit in a subquery.
-- RLS makes these no-ops rather than errors: the rows are simply not visible
-- to the USING clause, so nothing matches and nothing is returned.
with deleted as (
  delete from public.chore_flags
   where user_id = 'f1111111-1111-1111-1111-111111111111'
  returning 1
)
select is((select count(*)::int from deleted), 0, 'Bob cannot clear Alice''s flag');

with touched as (
  update public.chore_flags set flagged_on = '2020-01-01'
   where user_id = 'f1111111-1111-1111-1111-111111111111'
  returning 1
)
select is((select count(*)::int from touched), 0, 'nor move its date');

select lives_ok(
  $$ insert into public.chore_flags (household_id, chore_id, user_id, flagged_on)
     values ('fa000000-0000-0000-0000-000000000001',
             'fb000000-0000-0000-0000-000000000001',
             'f2222222-2222-2222-2222-222222222222', '2026-08-27') $$,
  'but he can flag the same chore for himself'
);

select * from finish();
rollback;
