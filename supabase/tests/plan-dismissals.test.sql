create extension if not exists pgtap with schema extensions;

-- "I took that off on purpose", as a fact the household shares.
--
-- The plan fills itself, and the fill and the act of removing something pull
-- in opposite directions: run the fill twice and whatever you took off comes
-- straight back. This table is what makes the fill idempotent — it records the
-- removals, so the fill can run on every open without undoing a decision.
--
-- The assertion that matters most is the one a device-local record could never
-- satisfy: **Jake can see that Emily took something off her own plan.** That is
-- the whole reason this is a table rather than another phone preference — both
-- devices now fill both plans, so a removal only one phone knows about lasts
-- until the other one opens.

begin;
select plan(8);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('b1111111-1111-1111-1111-111111111111', 'pgtap-pd-alice@example.test', '{"display_name":"Alice"}'),
  ('b2222222-2222-2222-2222-222222222222', 'pgtap-pd-bob@example.test',   '{"display_name":"Bob"}'),
  ('b3333333-3333-3333-3333-333333333333', 'pgtap-pd-cara@example.test',  '{"display_name":"Cara"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('bd000000-0000-0000-0000-00000000000a', 'Plan House',
   'b1111111-1111-1111-1111-111111111111', 'UTC'),
  ('bd000000-0000-0000-0000-00000000000b', 'Other House',
   'b3333333-3333-3333-3333-333333333333', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('bd000000-0000-0000-0000-00000000000a', 'b1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('bd000000-0000-0000-0000-00000000000a', 'b2222222-2222-2222-2222-222222222222', 'member', 'pink'),
  ('bd000000-0000-0000-0000-00000000000b', 'b3333333-3333-3333-3333-333333333333', 'owner', 'blue');

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

-- ═══ Alice takes something off her own day ═════════════════════════════════
select pg_temp.become('b1111111-1111-1111-1111-111111111111');

insert into public.plan_dismissals (household_id, user_id, occurrence_key, dismissed_on)
values ('bd000000-0000-0000-0000-00000000000a', 'b1111111-1111-1111-1111-111111111111',
        'v1:mop:2026-09-25', '2026-09-25');

select is(
  (select count(*)::int from public.plan_dismissals),
  1,
  'you can record taking something off your own plan'
);

-- One fact, not two. A double tap must not make two rows.
select throws_ok(
  $$ insert into public.plan_dismissals (household_id, user_id, occurrence_key, dismissed_on)
     values ('bd000000-0000-0000-0000-00000000000a', 'b1111111-1111-1111-1111-111111111111',
             'v1:mop:2026-09-25', '2026-09-25') $$,
  '23505',
  null,
  'and recording it twice is refused rather than duplicated'
);

-- ═══ Bob, on the other phone — the point of the table ══════════════════════
select pg_temp.become('b2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.plan_dismissals
   where user_id = 'b1111111-1111-1111-1111-111111111111'),
  1,
  'the housemate can see it, which a device-local record could never manage'
);

-- Either housemate may edit either plan, so either may record having done so.
insert into public.plan_dismissals (household_id, user_id, occurrence_key, dismissed_on)
values ('bd000000-0000-0000-0000-00000000000a', 'b1111111-1111-1111-1111-111111111111',
        'v1:bins:2026-09-25', '2026-09-25');

select is(
  (select count(*)::int from public.plan_dismissals
   where occurrence_key = 'v1:bins:2026-09-25'),
  1,
  'and can take something off *her* day, as the plan itself already allows'
);

-- Putting it back is a delete, and either of them can do that too.
delete from public.plan_dismissals where occurrence_key = 'v1:bins:2026-09-25';

select is(
  (select count(*)::int from public.plan_dismissals),
  1,
  'putting it back on the plan clears the record'
);

-- ═══ Cara, who lives somewhere else ════════════════════════════════════════
select pg_temp.become('b3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.plan_dismissals),
  0,
  'somebody in another household sees nothing'
);

-- Bare, with no WHERE. A `delete … where …` has to read the row to find it, so
-- the SELECT policy refuses it before the DELETE policy is ever consulted —
-- and the assertion would then pass against no delete policy at all. The same
-- discovery is recorded on `chore_flags`, `plan_entries` and `household_notes`.
delete from public.plan_dismissals;

select pg_temp.become('b1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.plan_dismissals),
  1,
  'nor can they clear one'
);

select pg_temp.become('b3333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.plan_dismissals (household_id, user_id, occurrence_key, dismissed_on)
     values ('bd000000-0000-0000-0000-00000000000a', 'b1111111-1111-1111-1111-111111111111',
             'v1:dishes:2026-09-25', '2026-09-25') $$,
  '42501',
  null,
  'and cannot take something off a plan in a house they are not in'
);

reset role;
select * from finish();
rollback;
