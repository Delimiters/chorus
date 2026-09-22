create extension if not exists pgtap with schema extensions;

-- Flags are a household fact, like completions.
--
-- They used to be the one asymmetry: both people could see both flags and
-- neither could clear the other's, on the reasoning that a flag is a statement
-- about what somebody is worrying about rather than a fact about the house.
--
-- That reasoning did not survive contact. Jake: *"If I flag something does it
-- flag it for both of us? Because I want it to."* Every read was already
-- household-wide — the "!!" showed on both phones and lifted the chore on both
-- plans — so the asymmetry only ever meant Emily could see a flag she could
-- not lift, and was offered "Flag it" on something already flagged.
--
-- So: either housemate may clear any flag in their household. Raising one is
-- still your own row, because who raised it is worth recording. What is tested
-- here is that pair, plus the usual private-chore leak, plus the boundary that
-- did not move — somebody outside the household still cannot touch it.

begin;
select plan(10);

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

-- The reversal. Either housemate may clear any flag in the house, which is
-- what makes one person's flag mean something to the other.
-- A data-modifying statement has to be a CTE; it cannot sit in a subquery.
with deleted as (
  delete from public.chore_flags
   where user_id = 'f1111111-1111-1111-1111-111111111111'
     and chore_id = 'fb000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*)::int from deleted), 1, 'Bob can clear Alice''s flag');

-- The boundary that did *not* move. `chore_is_visible` is still on the delete
-- policy, so widening "whose flag" did not widen "which chores" — Bob cannot
-- reach a flag on a chore Alice has kept private.
--
-- Two traps here, both measured rather than reasoned about.
--
-- `RETURNING` is filtered by the SELECT policy, so a row Bob deleted but
-- cannot see comes back as zero rows whether or not he was stopped. Counted
-- afterwards as *Alice* instead.
--
-- And the delete has to carry **no WHERE clause**. A `delete … where chore_id
-- = …` must read the row to find it, so `chore_flags_select` blocks it before
-- the delete policy is consulted — the assertion passes with
-- `chore_is_visible` removed from the delete policy entirely. A bare delete
-- references no columns, triggers no SELECT policy, and is the only shape
-- where this guard is the thing standing in the way. The same discovery is
-- recorded on `plan_entries_delete` in 20260907210000.
delete from public.chore_flags;

set local request.jwt.claims to '{"sub":"f1111111-1111-1111-1111-111111111111"}';

select is(
  (select count(*)::int from public.chore_flags
   where chore_id = 'fb000000-0000-0000-0000-000000000002'),
  1,
  'Bob cannot clear a flag on a chore he cannot see'
);

-- Back to Bob; everything below is about what he may do.
set local request.jwt.claims to '{"sub":"f2222222-2222-2222-2222-222222222222"}';

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
