create extension if not exists pgtap with schema extensions;

-- A flag ends when the job is done.
--
-- Jake: *"It should stay flagged until you either unflag it or it gets done."*
-- The unflagging half is an ordinary delete and needs no test beyond the policy
-- suite. This is the other half, and it lives in the database because a chore
-- can be completed from Today, from the plan and from the occurrence sheet —
-- three call sites that would each have to remember, and a fourth the day
-- somebody adds another screen.
--
-- The trigger is `security definer`, so the interesting question is not "does
-- it fire" but "does it clear the flags it should and only those": everyone's
-- flag on the completed chore, nothing on any other chore, and nothing in any
-- other household.

begin;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('fccc1111-1111-1111-1111-111111111111', 'pgtap-flag-ali@example.test', '{"display_name":"Ali"}'),
  ('fccc2222-2222-2222-2222-222222222222', 'pgtap-flag-bo@example.test',  '{"display_name":"Bo"}'),
  ('fccc3333-3333-3333-3333-333333333333', 'pgtap-flag-cy@example.test',  '{"display_name":"Cy"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('fccc0000-0000-0000-0000-00000000000a', 'Flag House A',
   'fccc1111-1111-1111-1111-111111111111', 'UTC'),
  ('fccc0000-0000-0000-0000-00000000000b', 'Flag House B',
   'fccc3333-3333-3333-3333-333333333333', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('fccc0000-0000-0000-0000-00000000000a', 'fccc1111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('fccc0000-0000-0000-0000-00000000000a', 'fccc2222-2222-2222-2222-222222222222', 'member', 'pink'),
  ('fccc0000-0000-0000-0000-00000000000b', 'fccc3333-3333-3333-3333-333333333333', 'owner', 'blue');

insert into public.chores (id, household_id, title, schedule, created_by)
values
  ('fccc9999-9999-9999-9999-999999999991', 'fccc0000-0000-0000-0000-00000000000a', 'Dishes',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
   'fccc1111-1111-1111-1111-111111111111'),
  ('fccc9999-9999-9999-9999-999999999992', 'fccc0000-0000-0000-0000-00000000000a', 'Bins',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
   'fccc1111-1111-1111-1111-111111111111'),
  -- Same *title* in the other house, to catch a trigger keyed on anything but ids.
  ('fccc9999-9999-9999-9999-999999999993', 'fccc0000-0000-0000-0000-00000000000b', 'Dishes',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
   'fccc3333-3333-3333-3333-333333333333');

-- Both housemates flag Dishes; Ali also flags Bins; Cy flags his own Dishes.
insert into public.chore_flags (household_id, chore_id, user_id, flagged_on)
values
  ('fccc0000-0000-0000-0000-00000000000a', 'fccc9999-9999-9999-9999-999999999991',
   'fccc1111-1111-1111-1111-111111111111', '2026-09-21'),
  ('fccc0000-0000-0000-0000-00000000000a', 'fccc9999-9999-9999-9999-999999999991',
   'fccc2222-2222-2222-2222-222222222222', '2026-09-21'),
  ('fccc0000-0000-0000-0000-00000000000a', 'fccc9999-9999-9999-9999-999999999992',
   'fccc1111-1111-1111-1111-111111111111', '2026-09-21'),
  ('fccc0000-0000-0000-0000-00000000000b', 'fccc9999-9999-9999-9999-999999999993',
   'fccc3333-3333-3333-3333-333333333333', '2026-09-21');

select is(
  (select count(*)::int from public.chore_flags),
  4,
  'four flags before anything is completed'
);

-- ═══ Bo completes Dishes — a chore Ali also flagged ════════════════════════
insert into public.chore_completions
  (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
values
  ('fccc0000-0000-0000-0000-00000000000a', 'fccc9999-9999-9999-9999-999999999991',
   'v1:dishes:2026-09-21', '2026-09-21', '2026-09-21',
   'fccc2222-2222-2222-2222-222222222222');

select is_empty(
  $$ select id from public.chore_flags
     where chore_id = 'fccc9999-9999-9999-9999-999999999991' $$,
  'completing it clears the flag of the person who did it'
);

-- The one that needs the `security definer`: Ali never touched anything, and
-- `chore_flags_delete` is `user_id = auth.uid()`.
select is(
  (select count(*)::int from public.chore_flags
   where chore_id = 'fccc9999-9999-9999-9999-999999999991'
     and user_id = 'fccc1111-1111-1111-1111-111111111111'),
  0,
  'and the other housemate''s flag on the same chore'
);

select is(
  (select count(*)::int from public.chore_flags
   where chore_id = 'fccc9999-9999-9999-9999-999999999992'),
  1,
  'a flag on a different chore is untouched'
);

-- Not a test of the household predicate, which cannot fail: `chore_id` is a
-- primary key and a chore belongs to exactly one household, so filtering by
-- chore already scopes the delete. Removing `household_id` from the trigger
-- leaves this suite green, and it is worth saying so rather than implying a
-- guard that is not being exercised. What this does check is that a chore
-- sharing a *title* with the completed one is not swept up.
select is(
  (select count(*)::int from public.chore_flags
   where household_id = 'fccc0000-0000-0000-0000-00000000000b'),
  1,
  'a same-titled chore elsewhere keeps its flag'
);

-- ═══ Skipping is not doing ═════════════════════════════════════════════════
--
-- "Not this time" is not "dealt with". If anything a flagged chore you have
-- just skipped is more worth seeing, not less.
insert into public.chore_exceptions
  (household_id, chore_id, occurrence_key, kind, due_on, created_by)
values
  ('fccc0000-0000-0000-0000-00000000000a', 'fccc9999-9999-9999-9999-999999999992',
   'v1:bins:2026-09-21', 'skip', '2026-09-21', 'fccc1111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.chore_flags
   where chore_id = 'fccc9999-9999-9999-9999-999999999992'),
  1,
  'skipping a flagged chore leaves the flag standing'
);

select * from finish();
rollback;
