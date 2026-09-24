create extension if not exists pgtap with schema extensions;

-- "Actually, this one's mine."
--
-- A per-occurrence override of the rotation, stored as a deviation rather than
-- an edit — the rotation stays a pure function of the date and the engine
-- applies this on top. What the database has to guarantee is the shape of that
-- deviation: one per occurrence, reachable by either housemate, and not
-- reachable at all from outside the household or on a private chore.
--
-- The assertion most likely to be written backwards is that **Bob can change a
-- turn Alice set**. A file that only proved outsiders are locked out would
-- pass just as well against an owner-only policy, which is the wrong feature:
-- "I'll take the bins tonight" is a thing you say about somebody else's turn.

begin;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('c1111111-1111-1111-1111-111111111111', 'pgtap-tn-alice@example.test', '{"display_name":"Alice"}'),
  ('c2222222-2222-2222-2222-222222222222', 'pgtap-tn-bob@example.test',   '{"display_name":"Bob"}'),
  ('c3333333-3333-3333-3333-333333333333', 'pgtap-tn-cara@example.test',  '{"display_name":"Cara"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('cd000000-0000-0000-0000-00000000000a', 'Turn House',
   'c1111111-1111-1111-1111-111111111111', 'UTC'),
  ('cd000000-0000-0000-0000-00000000000b', 'Other House',
   'c3333333-3333-3333-3333-333333333333', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('cd000000-0000-0000-0000-00000000000a', 'c1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('cd000000-0000-0000-0000-00000000000a', 'c2222222-2222-2222-2222-222222222222', 'member', 'pink'),
  ('cd000000-0000-0000-0000-00000000000b', 'c3333333-3333-3333-3333-333333333333', 'owner', 'blue');

insert into public.chores (id, household_id, title, schedule, created_by, private_to)
values
  ('ce000000-0000-0000-0000-000000000001', 'cd000000-0000-0000-0000-00000000000a', 'Bins',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
   'c1111111-1111-1111-1111-111111111111', null),
  -- Alice's alone, to prove `chore_is_visible` is doing work here.
  ('ce000000-0000-0000-0000-000000000002', 'cd000000-0000-0000-0000-00000000000a', 'Journal',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
   'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111');

create or replace function pg_temp.become(uid text) returns void
language plpgsql as $$
begin
  execute 'set local role authenticated';
  execute format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', uid, 'role', 'authenticated')::text
  );
end;
$$;

-- ═══ Alice takes Tuesday ═══════════════════════════════════════════════════
select pg_temp.become('c1111111-1111-1111-1111-111111111111');

insert into public.chore_turns (household_id, chore_id, occurrence_key, user_id, created_by)
values ('cd000000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000001',
        'v1:bins:2026-09-22', 'c1111111-1111-1111-1111-111111111111',
        'c1111111-1111-1111-1111-111111111111');

select is(
  (select user_id from public.chore_turns where occurrence_key = 'v1:bins:2026-09-22'),
  'c1111111-1111-1111-1111-111111111111'::uuid,
  'you can take an occurrence'
);

-- One per occurrence: a double tap must not make two rows disagree.
select throws_ok(
  $$ insert into public.chore_turns (household_id, chore_id, occurrence_key, user_id, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000001',
             'v1:bins:2026-09-22', 'c2222222-2222-2222-2222-222222222222',
             'c1111111-1111-1111-1111-111111111111') $$,
  '23505',
  null,
  'and only once — a second row for the same occurrence is refused'
);

-- ═══ Bob, the housemate — the point of the feature ═════════════════════════
select pg_temp.become('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.chore_turns),
  1,
  'the housemate sees it'
);

update public.chore_turns
   set user_id = 'c2222222-2222-2222-2222-222222222222'
 where occurrence_key = 'v1:bins:2026-09-22';

select is(
  (select user_id from public.chore_turns where occurrence_key = 'v1:bins:2026-09-22'),
  'c2222222-2222-2222-2222-222222222222'::uuid,
  'and can take it off them — "I''ll do the bins tonight"'
);

-- Deleting is how the rotation gets its turn back.
delete from public.chore_turns where occurrence_key = 'v1:bins:2026-09-22';

select is(
  (select count(*)::int from public.chore_turns),
  0,
  'and can give it back to the rotation'
);

-- ═══ A chore Alice keeps to herself ════════════════════════════════════════
select pg_temp.become('c1111111-1111-1111-1111-111111111111');

insert into public.chore_turns (household_id, chore_id, occurrence_key, user_id, created_by)
values ('cd000000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000002',
        'v1:journal:2026-09-22', 'c1111111-1111-1111-1111-111111111111',
        'c1111111-1111-1111-1111-111111111111');

select pg_temp.become('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.chore_turns),
  0,
  'a private chore''s turn is invisible to the housemate'
);

-- Bare, with no WHERE. A `delete … where …` has to read the row to find it, so
-- the SELECT policy refuses it before the DELETE policy is ever consulted —
-- and the assertion would then pass against no delete policy at all. The same
-- discovery is recorded on `chore_flags`, `plan_entries` and `household_notes`.
delete from public.chore_turns;

select pg_temp.become('c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.chore_turns),
  1,
  'nor can they clear it'
);

-- ═══ Somebody in another household ═════════════════════════════════════════
select pg_temp.become('c3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.chore_turns),
  0,
  'an outsider sees nothing'
);

select throws_ok(
  $$ insert into public.chore_turns (household_id, chore_id, occurrence_key, user_id, created_by)
     values ('cd000000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000001',
             'v1:bins:2026-09-23', 'c3333333-3333-3333-3333-333333333333',
             'c3333333-3333-3333-3333-333333333333') $$,
  '42501',
  null,
  'and cannot hand themselves somebody else''s chore'
);

reset role;
select * from finish();
rollback;
