create extension if not exists pgtap with schema extensions;

-- A chore only its owner can see, and the two tables that would otherwise
-- leak it.
--
-- The chore row is the easy half. The half worth testing is that its
-- completions and exceptions vanish too: both are household-scoped rows
-- carrying the chore's id, so a policy left alone there would let the other
-- person watch an unnameable chore being ticked off, and would inflate their
-- side of the stats screen with work they cannot see.
--
-- As everywhere in this suite: RLS filters SELECT silently, so a blocked read
-- asserts "got nothing back" and never "an error was raised".

begin;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('d1111111-1111-1111-1111-111111111111', 'pgtap-pc-alice@example.test', '{"display_name":"Alice"}'),
  ('d2222222-2222-2222-2222-222222222222', 'pgtap-pc-bob@example.test',   '{"display_name":"Bob"}');

insert into public.households (id, name, created_by, time_zone)
values ('da000000-0000-0000-0000-000000000001', 'Private House',
        'd1111111-1111-1111-1111-111111111111', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('da000000-0000-0000-0000-000000000001', 'd1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('da000000-0000-0000-0000-000000000001', 'd2222222-2222-2222-2222-222222222222', 'member', 'pink');

-- One shared chore and one Alice keeps to herself. The shared one is the
-- control: without it, "Bob sees one chore" could pass because he sees none.
insert into public.chores (id, household_id, title, schedule, assignment, private_to)
values
  ('db000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
   'Take out the bins',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', null),
  ('db000000-0000-0000-0000-000000000002', 'da000000-0000-0000-0000-000000000001',
   'Get anniversary flowers',
   '{"rule":{"kind":"once","dueOn":"2026-03-01","granularity":"day"},"startsOn":"2026-03-01","endsOn":null,"timesOfDay":[]}',
   '{"kind":"anyone"}', 'd1111111-1111-1111-1111-111111111111');

insert into public.chore_completions
  (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
values
  ('da000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001',
   'v1:bins:2026-02-01:0:-', '2026-02-01', '2026-02-01', 'd1111111-1111-1111-1111-111111111111'),
  ('da000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000002',
   'v1:flowers:2026-03-01:0:-', '2026-03-01', '2026-03-01', 'd1111111-1111-1111-1111-111111111111');

insert into public.chore_exceptions (household_id, chore_id, occurrence_key, due_on, kind)
values
  ('da000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001',
   'v1:bins:2026-02-02:0:-', '2026-02-02', 'skip'),
  ('da000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000002',
   'v1:flowers:2026-03-02:0:-', '2026-03-02', 'skip');

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

-- ═══ Alice, who owns the private chore ════════════════════════════════════

select pg_temp.become('d1111111-1111-1111-1111-111111111111');

select is((select count(*)::int from public.chores), 2,
          'the owner sees both her shared and her private chore');
select is((select count(*)::int from public.chore_completions), 2,
          'and both completions');
select is((select count(*)::int from public.chore_exceptions), 2,
          'and both exceptions');

-- ═══ Bob, who is in the same household ════════════════════════════════════

select pg_temp.become('d2222222-2222-2222-2222-222222222222');

select is((select count(*)::int from public.chores), 1,
          'a housemate sees only the shared chore');
select is((select title from public.chores), 'Take out the bins',
          'and it is the right one — not merely a count that happens to be 1');

-- The reason this file exists. A completion is a household-scoped row naming
-- the chore, so the obvious policy leaves the secret half-visible.
select is((select count(*)::int from public.chore_completions), 1,
          'and only the shared chore''s completions');
select is((select count(*)::int from public.chore_exceptions), 1,
          'and only the shared chore''s exceptions');

select is_empty(
  $$ select 1 from public.chores where id = 'db000000-0000-0000-0000-000000000002' $$,
  'naming the private chore''s id directly still returns nothing'
);

select is_empty(
  $$ select 1 from public.chore_completions
     where chore_id = 'db000000-0000-0000-0000-000000000002' $$,
  'and so does naming it through a completion'
);

-- Filtered, not rejected. Verified as Alice below, because a count Bob cannot
-- influence would prove nothing either way.
update public.chores set title = 'Hijacked'
where id = 'db000000-0000-0000-0000-000000000002';
delete from public.chore_completions
where chore_id = 'db000000-0000-0000-0000-000000000002';

select pg_temp.become('d1111111-1111-1111-1111-111111111111');

select is((select title from public.chores where id = 'db000000-0000-0000-0000-000000000002'),
          'Get anniversary flowers',
          'a housemate renaming a private chore changes nothing');
select is((select count(*)::int from public.chore_completions), 2,
          'and deleting its completion deletes nothing');

-- ═══ Making one private, and making it shared again ═══════════════════════

update public.chores set private_to = 'd1111111-1111-1111-1111-111111111111'
where id = 'db000000-0000-0000-0000-000000000001';

select pg_temp.become('d2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.chores), 0,
          'marking the last shared chore private empties his list');

select pg_temp.become('d1111111-1111-1111-1111-111111111111');
update public.chores set private_to = null
where id = 'db000000-0000-0000-0000-000000000001';

select pg_temp.become('d2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.chores), 1,
          'and sharing it again brings it back');
select is((select count(*)::int from public.chore_completions), 1,
          'along with its completions');

select * from finish();
rollback;
