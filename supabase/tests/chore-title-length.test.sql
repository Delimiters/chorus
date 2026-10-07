-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- The bound on a chore name, from both sides.
--
-- Emily ran out of room naming a chore, so the cap moved from 120 to 200. A
-- widened CHECK is the kind of change that passes every existing test while
-- silently losing its upper bound — nothing in this suite asserted the old 120
-- either — so both edges are pinned here: 200 goes in, 201 is rejected, and so
-- is the empty string, which is the bound the widening must not drop.

begin;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data)
values ('f1111111-1111-1111-1111-111111111111', 'pgtap-title-alice@example.test',
        '{"display_name":"Alice"}');

insert into public.households (id, name, created_by, time_zone)
values ('fa000000-0000-0000-0000-000000000001', 'Title House',
        'f1111111-1111-1111-1111-111111111111', 'America/Denver');

insert into public.household_members (household_id, user_id, role, accent)
values ('fa000000-0000-0000-0000-000000000001',
        'f1111111-1111-1111-1111-111111111111', 'owner', 'blue');

-- A plain daily schedule; the shape is irrelevant to the title bound, and
-- reusing one keeps the failure unambiguous when a constraint does fire.
create temporary table title_fixture as
select '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timesOfDay":[]}'::jsonb as schedule;

select lives_ok(
  $$ insert into public.chores (household_id, title, schedule, assignment)
     values ('fa000000-0000-0000-0000-000000000001', repeat('a', 200),
             (select schedule from title_fixture), '{"kind":"anyone"}') $$,
  'a 200-character name is accepted — the new upper bound'
);

select lives_ok(
  $$ insert into public.chores (household_id, title, schedule, assignment)
     values ('fa000000-0000-0000-0000-000000000001', repeat('b', 121),
             (select schedule from title_fixture), '{"kind":"anyone"}') $$,
  'a name past the old 120 is accepted, which is the whole point of the change'
);

select throws_ok(
  $$ insert into public.chores (household_id, title, schedule, assignment)
     values ('fa000000-0000-0000-0000-000000000001', repeat('c', 201),
             (select schedule from title_fixture), '{"kind":"anyone"}') $$,
  '23514',
  null,
  'a 201-character name is still rejected — the bound moved, it did not go away'
);

select throws_ok(
  $$ insert into public.chores (household_id, title, schedule, assignment)
     values ('fa000000-0000-0000-0000-000000000001', '',
             (select schedule from title_fixture), '{"kind":"anyone"}') $$,
  '23514',
  null,
  'an empty name is still rejected — the lower bound survived the widening'
);

select * from finish();
rollback;
