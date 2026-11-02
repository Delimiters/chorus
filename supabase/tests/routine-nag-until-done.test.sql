-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- The column behind "keep asking" on a routine item.
--
-- The behaviour lives on each device — a phone plans its own local
-- notifications from this flag — so all the database owes is a boolean that
-- defaults to off.
--
-- The one thing worth proving here is the difference from the chore version.
-- A chore's nag flag is a property of a shared job, so either housemate may
-- change it. A routine item belongs to **one person**, so this is personal by
-- construction: the existing owner-only write policies are what make it so,
-- and this asserts that they actually do.

begin;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('d1111111-1111-1111-1111-111111111111', 'pgtap-rnag-alice@example.test', '{"display_name":"Alice"}'),
  ('d2222222-2222-2222-2222-222222222222', 'pgtap-rnag-bob@example.test',   '{"display_name":"Bob"}');

insert into public.households (id, name, created_by, time_zone)
values ('da000000-0000-0000-0000-000000000001', 'Routine Nag House',
        'd1111111-1111-1111-1111-111111111111', 'America/Denver');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('da000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('da000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'member', 'pink');

-- Alice's, and shared so Bob can read it. Reading is not writing, which is the
-- distinction this file exists to pin.
update public.household_members set share_routine = true
  where user_id = 'd1111111-1111-1111-1111-111111111111';

insert into public.routine_items
  (id, household_id, user_id, title, schedule, time_of_day)
values
  ('db000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
   'd1111111-1111-1111-1111-111111111111', 'Stretch',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}', '07:00');

select is(
  (select nag_until_done from public.routine_items
    where id = 'db000000-0000-0000-0000-000000000001'),
  false,
  'a routine item does not nag unless somebody asks it to'
);

-- ── Its owner may turn it on ───────────────────────────────────────────────

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ update public.routine_items set nag_until_done = true
     where id = 'db000000-0000-0000-0000-000000000001' $$,
  'its owner can ask it to'
);

select is(
  (select nag_until_done from public.routine_items
    where id = 'db000000-0000-0000-0000-000000000001'),
  true,
  'and the change took'
);

-- ── The housemate may not ──────────────────────────────────────────────────
-- Unlike a chore. A routine is one person's day, and being nagged is something
-- you choose for yourself.

set local request.jwt.claims = '{"sub":"d2222222-2222-2222-2222-222222222222","role":"authenticated"}';

update public.routine_items set nag_until_done = false
  where id = 'db000000-0000-0000-0000-000000000001';

-- Not an error: PostgREST and Postgres both report an RLS-filtered update as a
-- successful statement affecting no rows, which is exactly why this asserts the
-- *value* rather than that the statement raised. A test expecting a throw here
-- would pass against a policy that allowed the write.
select is(
  (select nag_until_done from public.routine_items
    where id = 'db000000-0000-0000-0000-000000000001'),
  true,
  'the housemate cannot turn off somebody else''s nagging'
);

select is(
  (select count(*)::int from public.routine_items
    where id = 'db000000-0000-0000-0000-000000000001'),
  1,
  'and can still see the shared item — reading is not writing'
);

select * from finish();
rollback;
