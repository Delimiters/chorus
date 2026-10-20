-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- The column behind "keep reminding me until it's done".
--
-- The behaviour lives on each device — a phone plans its own local
-- notifications from this flag — so all the database owes is a per-chore
-- boolean that defaults to off and that either housemate can change.

begin;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('b1111111-1111-1111-1111-111111111111', 'pgtap-nag-alice@example.test', '{"display_name":"Alice"}'),
  ('b2222222-2222-2222-2222-222222222222', 'pgtap-nag-bob@example.test',   '{"display_name":"Bob"}');

insert into public.households (id, name, created_by, time_zone)
values ('ba000000-0000-0000-0000-000000000001', 'Nag House',
        'b1111111-1111-1111-1111-111111111111', 'America/Denver');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('ba000000-0000-0000-0000-000000000001', 'b1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('ba000000-0000-0000-0000-000000000001', 'b2222222-2222-2222-2222-222222222222', 'member', 'pink');

insert into public.chores (id, household_id, title, schedule, assignment)
values ('bb000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001',
        'Take the bins out',
        '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timesOfDay":[]}',
        '{"kind":"anyone"}');

select is(
  (select nag_until_done from public.chores
    where id = 'bb000000-0000-0000-0000-000000000001'),
  false,
  'a chore does not nag unless somebody asks it to'
);

select lives_ok(
  $$ update public.chores set nag_until_done = true
     where id = 'bb000000-0000-0000-0000-000000000001' $$,
  'and it can be asked to'
);

-- ── Either housemate may change it ─────────────────────────────────────────
-- It is a property of the job, and they share the job.

set local role authenticated;
set local request.jwt.claims = '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$ update public.chores set nag_until_done = false
     where id = 'bb000000-0000-0000-0000-000000000001' $$,
  'the other housemate can turn it off — it is the chore''s setting, not a personal one'
);

select is(
  (select nag_until_done from public.chores
    where id = 'bb000000-0000-0000-0000-000000000001'),
  false,
  'and the change took'
);

select * from finish();
rollback;
