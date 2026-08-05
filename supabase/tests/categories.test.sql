-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- Categories and priority: isolation, grants, and the constraints that matter.
--
-- As everywhere in this suite, RLS filters SILENTLY — a blocked SELECT returns
-- zero rows and no error — so reads assert "got nothing back" and never "an
-- error was raised". Writes into another household are rejected outright and
-- assert 42501; UPDATE and DELETE are filtered instead, so those assert that
-- zero rows changed.

begin;
select plan(14);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- Prefixed IDs and emails so they cannot collide with supabase/seed.sql, which
-- `supabase db reset` applies before these tests run.

insert into auth.users (id, email, raw_user_meta_data)
values
  ('e1111111-1111-1111-1111-111111111111', 'pgtap-cat-alice@example.test', '{"display_name":"Alice"}'),
  ('e2222222-2222-2222-2222-222222222222', 'pgtap-cat-bob@example.test',   '{"display_name":"Bob"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('ea000000-0000-0000-0000-000000000001', 'Cat House A',
   'e1111111-1111-1111-1111-111111111111', 'America/Denver'),
  ('eb000000-0000-0000-0000-000000000002', 'Cat House B',
   'e2222222-2222-2222-2222-222222222222', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('ea000000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('eb000000-0000-0000-0000-000000000002', 'e2222222-2222-2222-2222-222222222222', 'owner', 'pink');

insert into public.chore_categories (id, household_id, name, ink, position)
values
  ('ec000000-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-000000000001',
   'Kitchen', 'teal', 0);

insert into public.chores (id, household_id, title, schedule, created_by, category_id, priority)
values
  ('ed000000-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-000000000001',
   'Dishes', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
   'e1111111-1111-1111-1111-111111111111',
   'ec000000-0000-0000-0000-000000000001', 'crucial');

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

-- ═══ Defaults and constraints, as the table owner ══════════════════════════

select is(
  (select priority from public.chores where id = 'ed000000-0000-0000-0000-000000000001'),
  'crucial',
  'a chore stores the priority it was given'
);

insert into public.chores (id, household_id, title, schedule, created_by)
values ('ed000000-0000-0000-0000-000000000002', 'ea000000-0000-0000-0000-000000000001',
        'Unset', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
        'e1111111-1111-1111-1111-111111111111');

select is(
  (select priority from public.chores where id = 'ed000000-0000-0000-0000-000000000002'),
  'normal',
  'a chore created without a priority defaults to normal, so nothing needs backfilling'
);

select is(
  (select category_id from public.chores where id = 'ed000000-0000-0000-0000-000000000002'),
  null,
  'a chore created without a category is in Other, which is null and not a row'
);

select throws_ok(
  $$ update public.chores set priority = 'urgent'
     where id = 'ed000000-0000-0000-0000-000000000002' $$,
  '23514',
  null,
  'a priority outside the three levels is rejected by the CHECK'
);

select throws_ok(
  $$ insert into public.chore_categories (household_id, name, position)
     values ('ea000000-0000-0000-0000-000000000001', 'Kitchen', 1) $$,
  '23505',
  null,
  'two categories cannot share a name within one household'
);

select lives_ok(
  $$ insert into public.chore_categories (household_id, name, position)
     values ('eb000000-0000-0000-0000-000000000002', 'Kitchen', 0) $$,
  'the same category name is fine in a different household'
);

select throws_ok(
  $$ insert into public.chore_categories (household_id, name, ink, position)
     values ('ea000000-0000-0000-0000-000000000001', 'Bad Ink', '#aabbcc', 9) $$,
  '23514',
  null,
  'ink must be one of the named inks, not a raw hex that only suits one theme'
);

-- ── Deleting a category must not delete its chores ────────────────────────
-- The single most important behaviour here: chores fall back into Other, and
-- the completion history hanging off them survives untouched.
delete from public.chore_categories where id = 'ec000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.chores
   where id = 'ed000000-0000-0000-0000-000000000001'),
  1,
  'deleting a category leaves its chores alive'
);

select is(
  (select category_id from public.chores where id = 'ed000000-0000-0000-0000-000000000001'),
  null,
  'a chore whose category was deleted falls back to Other'
);

-- ═══ Bob must not reach House A ════════════════════════════════════════════

insert into public.chore_categories (id, household_id, name, position)
values ('ec000000-0000-0000-0000-000000000009', 'ea000000-0000-0000-0000-000000000001',
        'Outdoors', 3);

select pg_temp.become('e2222222-2222-2222-2222-222222222222');

select is_empty(
  $$ select id from public.chore_categories
     where household_id = 'ea000000-0000-0000-0000-000000000001' $$,
  'bob cannot read categories belonging to house A'
);

select throws_ok(
  $$ insert into public.chore_categories (household_id, name, position)
     values ('ea000000-0000-0000-0000-000000000001', 'Injected', 0) $$,
  '42501',
  null,
  'bob cannot insert a category into house A'
);

-- UPDATE and DELETE are filtered rather than rejected, so bob's statements
-- succeed and affect zero rows.
update public.chore_categories set name = 'Hijacked'
  where id = 'ec000000-0000-0000-0000-000000000009';
delete from public.chore_categories where id = 'ec000000-0000-0000-0000-000000000009';

-- ═══ Alice checks the damage ═══════════════════════════════════════════════
--
-- The verification runs as *alice*, and that is the whole point. Asserting as
-- bob is worthless here: he cannot SELECT house A rows either way, so
-- "count where name = 'Hijacked' is 0" would hold just as well if his UPDATE
-- had gone through. The assertion has to be made by someone who can see the
-- rows. This test failed on exactly that mistake before it was fixed.

select pg_temp.become('e1111111-1111-1111-1111-111111111111');

select is(
  (select name from public.chore_categories
   where id = 'ec000000-0000-0000-0000-000000000009'),
  'Outdoors',
  'bob renaming a house A category changed nothing, as seen by a member who can read it'
);

select is(
  (select count(*)::int from public.chore_categories
   where id = 'ec000000-0000-0000-0000-000000000009'),
  1,
  'bob deleting a house A category deleted nothing, as seen by a member who can read it'
);

-- ═══ Alice, a plain member, may manage her own household's categories ══════
-- Members are equals here, following 20260801104500. There is no admin tier.

select lives_ok(
  $$ update public.chore_categories set position = 7
     where id = 'ec000000-0000-0000-0000-000000000009' $$,
  'a member can reorder a category in her own household'
);

select * from finish();
rollback;
