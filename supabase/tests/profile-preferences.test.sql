create extension if not exists pgtap with schema extensions;

-- Who may change which group leads your day.
--
-- `plan_group_order` rides on `profiles`, whose policies are column-agnostic —
-- which is the reason it is a column rather than a table, and also the reason
-- it is worth proving rather than assuming. The claim in the migration is
-- exactly two things: a housemate may *read* your preference, and may not
-- *write* it.
--
-- RLS filters UPDATE silently. A blocked write affects zero rows and raises
-- nothing, so every assertion below reads the value back afterwards. Asserting
-- "no error was raised" would pass forever while proving nothing — see
-- docs/TESTING.md.

begin;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('fbbb1111-1111-1111-1111-111111111111', 'pgtap-pref-jo@example.test',  '{"display_name":"Jo"}'),
  ('fbbb2222-2222-2222-2222-222222222222', 'pgtap-pref-kit@example.test', '{"display_name":"Kit"}');

insert into public.households (id, name, created_by, time_zone)
values ('fbbb0000-0000-0000-0000-000000000001', 'Pref House',
        'fbbb1111-1111-1111-1111-111111111111', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('fbbb0000-0000-0000-0000-000000000001', 'fbbb1111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('fbbb0000-0000-0000-0000-000000000001', 'fbbb2222-2222-2222-2222-222222222222', 'member', 'pink');

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

-- The default is what the app already shipped, so nobody's day reorders itself
-- underneath them when this migration lands.
select is(
  (select plan_group_order from public.profiles
   where id = 'fbbb1111-1111-1111-1111-111111111111'),
  'chores',
  'a new profile leads with chores'
);

-- ═══ Jo may set her own ════════════════════════════════════════════════════
select pg_temp.become('fbbb1111-1111-1111-1111-111111111111');

update public.profiles
set plan_group_order = 'oneOff'
where id = 'fbbb1111-1111-1111-1111-111111111111';

select is(
  (select plan_group_order from public.profiles
   where id = 'fbbb1111-1111-1111-1111-111111111111'),
  'oneOff',
  'jo can put one-time tasks first on her own day'
);

-- ═══ Kit may read Jo's, because they share a household ═════════════════════
select pg_temp.become('fbbb2222-2222-2222-2222-222222222222');

select is(
  (select plan_group_order from public.profiles
   where id = 'fbbb1111-1111-1111-1111-111111111111'),
  'oneOff',
  'kit can read jo''s preference, which is what lets one query serve the screen'
);

-- ═══ …and may not write it ═════════════════════════════════════════════════
update public.profiles
set plan_group_order = 'chores'
where id = 'fbbb1111-1111-1111-1111-111111111111';

select is(
  (select plan_group_order from public.profiles
   where id = 'fbbb1111-1111-1111-1111-111111111111'),
  'oneOff',
  'kit cannot reorder jo''s day'
);

-- The value set is checked, so a typo cannot reach the screen and match no
-- branch. Raised rather than filtered, because a CHECK is not RLS.
select throws_ok(
  $$ update public.profiles
     set plan_group_order = 'sideways'
     where id = 'fbbb2222-2222-2222-2222-222222222222' $$,
  '23514',
  null,
  'an unknown order is rejected by the constraint'
);

select * from finish();
rollback;
