-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- The bound on every name you can type, from both sides.
--
-- Emily ran out of room naming a chore, so the cap moved from 120 to 200 — then
-- Jake asked for the rest. A widened CHECK is the kind of change that passes
-- every existing test while silently losing its upper bound, so each table gets
-- both edges: 200 goes in, 201 is rejected, and the floor survives — which for
-- three of these is "not empty" and for a note's heading is "may be absent".
--
-- Four tables, three spellings: `char_length(title)`, `char_length(trim(title))`
-- and `title is null or length(title) <= 200`. Each is asserted against its own
-- table because a single `title` CHECK proves nothing about the other three.

begin;
select plan(13);

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

-- ── Steps ──────────────────────────────────────────────────────────────────

insert into public.chores (id, household_id, title, schedule, assignment)
values ('fb000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001',
        'Parent chore', (select schedule from title_fixture), '{"kind":"anyone"}');

select lives_ok(
  $$ insert into public.chore_subtasks (household_id, chore_id, title, position)
     values ('fa000000-0000-0000-0000-000000000001',
             'fb000000-0000-0000-0000-000000000001', repeat('a', 200), 0) $$,
  'a 200-character step is accepted'
);

select throws_ok(
  $$ insert into public.chore_subtasks (household_id, chore_id, title, position)
     values ('fa000000-0000-0000-0000-000000000001',
             'fb000000-0000-0000-0000-000000000001', repeat('b', 201), 1) $$,
  '23514',
  null,
  'a 201-character step is rejected'
);

select throws_ok(
  $$ insert into public.chore_subtasks (household_id, chore_id, title, position)
     values ('fa000000-0000-0000-0000-000000000001',
             'fb000000-0000-0000-0000-000000000001', '', 2) $$,
  '23514',
  null,
  'an empty step is still rejected'
);

-- ── Routine items ──────────────────────────────────────────────────────────
-- The only one whose CHECK trims first, so a name of spaces is not a name.

select lives_ok(
  $$ insert into public.routine_items
       (household_id, user_id, title, schedule, bucket_choice, remind)
     values ('fa000000-0000-0000-0000-000000000001',
             'f1111111-1111-1111-1111-111111111111', repeat('a', 200),
             (select schedule from title_fixture), 'morning', false) $$,
  'a 200-character routine name is accepted'
);

select throws_ok(
  $$ insert into public.routine_items
       (household_id, user_id, title, schedule, bucket_choice, remind)
     values ('fa000000-0000-0000-0000-000000000001',
             'f1111111-1111-1111-1111-111111111111', repeat('b', 201),
             (select schedule from title_fixture), 'morning', false) $$,
  '23514',
  null,
  'a 201-character routine name is rejected'
);

select throws_ok(
  $$ insert into public.routine_items
       (household_id, user_id, title, schedule, bucket_choice, remind)
     values ('fa000000-0000-0000-0000-000000000001',
             'f1111111-1111-1111-1111-111111111111', '   ',
             (select schedule from title_fixture), 'morning', false) $$,
  '23514',
  null,
  'a routine name of nothing but spaces is still rejected — the trim survived'
);

-- ── Note headings ──────────────────────────────────────────────────────────
-- The only nullable title, and the only one with no floor to keep.

select lives_ok(
  $$ insert into public.household_notes (household_id, title, body, created_by)
     values ('fa000000-0000-0000-0000-000000000001', repeat('a', 200), 'body',
             'f1111111-1111-1111-1111-111111111111') $$,
  'a 200-character note heading is accepted'
);

select throws_ok(
  $$ insert into public.household_notes (household_id, title, body, created_by)
     values ('fa000000-0000-0000-0000-000000000001', repeat('b', 201), 'body',
             'f1111111-1111-1111-1111-111111111111') $$,
  '23514',
  null,
  'a 201-character note heading is rejected'
);

select lives_ok(
  $$ insert into public.household_notes (household_id, title, body, created_by)
     values ('fa000000-0000-0000-0000-000000000001', null, 'just a body',
             'f1111111-1111-1111-1111-111111111111') $$,
  'a note with no heading at all is still fine — this one has no floor'
);

select * from finish();
rollback;
