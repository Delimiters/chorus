-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- The hour a household's day begins.
--
-- Jake asked for a day that ends at 3 AM so late-night work counts as the night
-- it happened. The column is the backstop for the control: the stepper cannot
-- produce an out-of-range hour, and this is what happens if anything else tries.

begin;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data)
values ('a1111111-1111-1111-1111-111111111111', 'pgtap-day-alice@example.test',
        '{"display_name":"Alice"}');

insert into public.households (id, name, created_by, time_zone)
values ('aa000000-0000-0000-0000-000000000001', 'Day House',
        'a1111111-1111-1111-1111-111111111111', 'America/Denver');

select is(
  (select day_starts_at_hour from public.households
    where id = 'aa000000-0000-0000-0000-000000000001'),
  3::smallint,
  'a household defaults to a day that ends at 3 AM, which is what was asked for'
);

select lives_ok(
  $$ update public.households set day_starts_at_hour = 0
     where id = 'aa000000-0000-0000-0000-000000000001' $$,
  'midnight is allowed — the escape hatch back to an ordinary calendar day'
);

select lives_ok(
  $$ update public.households set day_starts_at_hour = 12
     where id = 'aa000000-0000-0000-0000-000000000001' $$,
  'noon is allowed, and is the upper bound'
);

select throws_ok(
  $$ update public.households set day_starts_at_hour = 13
     where id = 'aa000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'past noon is rejected — a day has to contain its own afternoon'
);

select throws_ok(
  $$ update public.households set day_starts_at_hour = -1
     where id = 'aa000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a negative hour is rejected'
);

select throws_ok(
  $$ update public.households set day_starts_at_hour = null
     where id = 'aa000000-0000-0000-0000-000000000001' $$,
  '23502',
  null,
  'the column cannot be emptied — every household has an answer to this'
);

select * from finish();
rollback;
