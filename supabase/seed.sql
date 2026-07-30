-- Local development seed.
--
-- Creates one household with two members and one chore of every recurrence
-- shape, so the app has something realistic to render and so the recurrence
-- picker can be exercised by hand. Applied automatically by `supabase db reset`.
--
-- Passwords for both users: password123

-- Supabase's auth schema needs the encrypted password and a confirmed email for
-- password sign-in to work locally.
--
-- The empty strings below are load-bearing and non-obvious. GoTrue scans these
-- token columns into non-nullable Go strings, so a NULL makes every sign-in fail
-- with a 500 "Database error querying schema" — which looks like a server problem
-- rather than a bad seed. They must be '' and not left to default.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'jake@example.test',
   crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Jake"}',
   '', '', '', '', '', '', '', ''),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sam@example.test',
   crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Sam"}',
   '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111', 'email',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"jake@example.test","email_verified":true}',
   now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222',
   '22222222-2222-2222-2222-222222222222', 'email',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"sam@example.test","email_verified":true}',
   now(), now(), now())
on conflict do nothing;

update public.profiles set accent = 'blue'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set accent = 'pink'
  where id = '22222222-2222-2222-2222-222222222222';

insert into public.households (id, name, time_zone, week_starts_on, created_by)
values ('a0000000-0000-0000-0000-00000000000a', 'The House',
        'America/Denver', 0, '11111111-1111-1111-1111-111111111111');

insert into public.household_members (household_id, user_id, role, sort_order)
values
  ('a0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'owner', 0),
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'member', 1);

-- One chore per recurrence shape. `startsOn` is a Sunday so weekly anchoring is
-- easy to reason about by hand.
insert into public.chores (household_id, title, schedule, assignment, created_by)
values
  -- daily, anyone
  ('a0000000-0000-0000-0000-00000000000a', 'Dishes',
   '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":"20:00"}',
   '{"kind":"anyone"}', '11111111-1111-1111-1111-111111111111'),

  -- weekly on chosen days, rotating weekly — the flagship case
  ('a0000000-0000-0000-0000-00000000000a', 'Take out the trash',
   '{"rule":{"kind":"weekly","everyNWeeks":1,"weekdays":[1,3,5]},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":"07:30"}',
   '{"kind":"rotate","cadence":{"unit":"week","every":1},"segments":[{"effectiveFrom":"2026-01-04","memberIds":["11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222"],"offset":0}]}',
   '11111111-1111-1111-1111-111111111111'),

  -- every other week, fixed person
  ('a0000000-0000-0000-0000-00000000000a', 'Clean the bathroom',
   '{"rule":{"kind":"weekly","everyNWeeks":2,"weekdays":[0]},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"fixed","memberId":"22222222-2222-2222-2222-222222222222"}',
   '11111111-1111-1111-1111-111111111111'),

  -- floating weekly: 3x a week, any day
  ('a0000000-0000-0000-0000-00000000000a', 'Water the plants',
   '{"rule":{"kind":"weeklyFloating","everyNWeeks":1,"timesPerPeriod":3},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"anyone"}', '11111111-1111-1111-1111-111111111111'),

  -- everyone does their own
  ('a0000000-0000-0000-0000-00000000000a', 'Laundry',
   '{"rule":{"kind":"weekly","everyNWeeks":1,"weekdays":[6]},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"everyone"}', '11111111-1111-1111-1111-111111111111'),

  -- every N days
  ('a0000000-0000-0000-0000-00000000000a', 'Change the sheets',
   '{"rule":{"kind":"daily","everyNDays":14},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"rotate","cadence":{"unit":"occurrence","every":1},"segments":[{"effectiveFrom":"2026-01-04","memberIds":["11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222"],"offset":0}]}',
   '11111111-1111-1111-1111-111111111111'),

  -- monthly on the 31st, clamped — the February case, visible in the app
  ('a0000000-0000-0000-0000-00000000000a', 'Deep clean the fridge',
   '{"rule":{"kind":"monthlyByDay","everyNMonths":1,"dayOfMonth":31,"overflow":"clamp"},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"anyone"}', '11111111-1111-1111-1111-111111111111'),

  -- monthly by Nth weekday
  ('a0000000-0000-0000-0000-00000000000a', 'Water bill',
   '{"rule":{"kind":"monthlyByWeekday","everyNMonths":1,"nth":1,"weekday":1},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"fixed","memberId":"11111111-1111-1111-1111-111111111111"}',
   '11111111-1111-1111-1111-111111111111'),

  -- floating monthly
  ('a0000000-0000-0000-0000-00000000000a', 'Vacuum the whole house',
   '{"rule":{"kind":"monthlyFloating","everyNMonths":1,"timesPerPeriod":2},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"anyone"}', '11111111-1111-1111-1111-111111111111'),

  -- one-time, dated
  ('a0000000-0000-0000-0000-00000000000a', 'Cancel the gym membership',
   '{"rule":{"kind":"once","dueOn":"2026-02-14","granularity":"day"},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"fixed","memberId":"22222222-2222-2222-2222-222222222222"}',
   '11111111-1111-1111-1111-111111111111'),

  -- someday, never scheduled
  ('a0000000-0000-0000-0000-00000000000a', 'Clear out the garage',
   '{"rule":{"kind":"unscheduled"},"startsOn":"2026-01-04","endsOn":null,"timeOfDay":null}',
   '{"kind":"anyone"}', '11111111-1111-1111-1111-111111111111');

insert into public.household_invites (household_id, code, created_by)
values ('a0000000-0000-0000-0000-00000000000a', 'K7M4PQ2X',
        '11111111-1111-1111-1111-111111111111');
