create extension if not exists pgtap with schema extensions;

-- Telling the other phone.
--
-- `pg_net` queues each request in `net.http_request_queue` and a background
-- worker drains it, so a test can read exactly what *would* be sent without
-- anything leaving the machine — which is the only way to assert the payload
-- at all.
--
-- The assertions that matter are about *who* hears: everyone in the household
-- except the person who did the thing, minus anyone who turned it off. Being
-- told you ticked your own chore is noise, and noise is how somebody ends up
-- turning notifications off altogether.

begin;
select plan(21);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('e1111111-1111-1111-1111-111111111111', 'pgtap-pn-alice@example.test', '{"display_name":"Alice"}'),
  ('e2222222-2222-2222-2222-222222222222', 'pgtap-pn-bob@example.test',   '{"display_name":"Bob"}'),
  ('e3333333-3333-3333-3333-333333333333', 'pgtap-pn-cara@example.test',  '{"display_name":"Cara"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('ed000000-0000-0000-0000-00000000000a', 'Push House',
   'e1111111-1111-1111-1111-111111111111', 'UTC'),
  ('ed000000-0000-0000-0000-00000000000b', 'Other House',
   'e3333333-3333-3333-3333-333333333333', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('ed000000-0000-0000-0000-00000000000a', 'e1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('ed000000-0000-0000-0000-00000000000a', 'e2222222-2222-2222-2222-222222222222', 'member', 'pink'),
  ('ed000000-0000-0000-0000-00000000000b', 'e3333333-3333-3333-3333-333333333333', 'owner', 'blue');

insert into public.push_tokens (user_id, token, platform)
values
  ('e1111111-1111-1111-1111-111111111111', 'ExponentPushToken[alice]', 'ios'),
  ('e2222222-2222-2222-2222-222222222222', 'ExponentPushToken[bob]',   'ios'),
  ('e3333333-3333-3333-3333-333333333333', 'ExponentPushToken[cara]',  'ios');

insert into public.chores (id, household_id, title, schedule, created_by)
values ('ec000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-00000000000a',
        'Dishes', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
        'e1111111-1111-1111-1111-111111111111');

-- The chore insert above is itself news, so clear the queue before asking
-- about completions. Tested on its own further down.
delete from net.http_request_queue;

-- ═══ Alice does the dishes ═════════════════════════════════════════════════
insert into public.chore_completions
  (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
values ('ed000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-000000000001',
        'v1:dishes:2026-09-29', '2026-09-29', '2026-09-29',
        'e1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from net.http_request_queue),
  1,
  'one request goes out when a chore is completed'
);

select is(
  (select url from net.http_request_queue limit 1),
  'https://exp.host/--/api/v2/push/send',
  'addressed to Expo''s push service'
);

-- Bob hears about it; Alice does not hear about her own tick.
select is(
  (select jsonb_array_length(convert_from(body, 'utf8')::jsonb) from net.http_request_queue limit 1),
  1,
  'to exactly one person — not to whoever did it'
);

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'to' from net.http_request_queue limit 1),
  'ExponentPushToken[bob]',
  'and that person is the housemate'
);

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'title' from net.http_request_queue limit 1),
  'Dishes',
  'the chore is the headline, because that is what you are being told about'
);

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'body' from net.http_request_queue limit 1),
  'Alice finished this.',
  'and the person is the sentence'
);

-- Cara is in another household entirely.
select is(
  (select count(*)::int from net.http_request_queue
   where convert_from(body, 'utf8')::jsonb::text like '%cara%'),
  0,
  'somebody in another household hears nothing'
);

-- ═══ Turning it off means off ══════════════════════════════════════════════
delete from net.http_request_queue;

update public.household_members
   set push_enabled = false
 where user_id = 'e2222222-2222-2222-2222-222222222222';

insert into public.chore_completions
  (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
values ('ed000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-000000000001',
        'v1:dishes:2026-09-30', '2026-09-30', '2026-09-30',
        'e1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'nothing is sent when the only recipient has turned it off'
);

-- ═══ A private chore is not household news ═════════════════════════════════
update public.household_members
   set push_enabled = true
 where user_id = 'e2222222-2222-2222-2222-222222222222';

delete from net.http_request_queue;

insert into public.chores (id, household_id, title, schedule, created_by, private_to)
values ('ec000000-0000-0000-0000-000000000002', 'ed000000-0000-0000-0000-00000000000a',
        'Journal', '{"rule":{"kind":"daily","everyNDays":1},"startsOn":"2026-01-01"}',
        'e1111111-1111-1111-1111-111111111111', 'e1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'adding a chore you keep to yourself tells nobody its title'
);

-- ═══ Somebody changing your day ════════════════════════════════════════════
--
-- The trap this exists around: both phones fill both plans automatically, so a
-- trigger that announced every `plan_entries` row would fire once per chore
-- per morning. `added_by` is null for the fill, and that is the whole
-- distinction between a decision and housekeeping.
delete from net.http_request_queue;

-- The fill, as it actually writes: nobody decided this.
insert into public.plan_entries
  (household_id, user_id, chore_id, occurrence_key, planned_for, position, added_by)
values ('ed000000-0000-0000-0000-00000000000a', 'e2222222-2222-2222-2222-222222222222',
        'ec000000-0000-0000-0000-000000000001', 'v1:dishes:2026-10-01', '2026-10-01', 1, null);

select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'the automatic fill says nothing, however many rows it writes'
);

-- You, putting something on your own day.
insert into public.plan_entries
  (household_id, user_id, chore_id, occurrence_key, planned_for, position, added_by)
values ('ed000000-0000-0000-0000-00000000000a', 'e2222222-2222-2222-2222-222222222222',
        'ec000000-0000-0000-0000-000000000001', 'v1:dishes:2026-10-02', '2026-10-02', 2,
        'e2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'nor does putting something on your own day — you were there'
);

-- Alice putting something on Bob's day. This is the one worth hearing about.
insert into public.plan_entries
  (household_id, user_id, chore_id, occurrence_key, planned_for, position, added_by)
values ('ed000000-0000-0000-0000-00000000000a', 'e2222222-2222-2222-2222-222222222222',
        'ec000000-0000-0000-0000-000000000001', 'v1:dishes:2026-10-03', '2026-10-03', 3,
        'e1111111-1111-1111-1111-111111111111');

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'to' from net.http_request_queue limit 1),
  'ExponentPushToken[bob]',
  'but somebody else putting work on your day reaches you'
);

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'body' from net.http_request_queue limit 1),
  'Alice put this on your day.',
  'and says who did it'
);

-- ═══ And taking it off ═════════════════════════════════════════════════════
delete from net.http_request_queue;

insert into public.plan_dismissals
  (household_id, user_id, occurrence_key, dismissed_on, dismissed_by, chore_id)
values ('ed000000-0000-0000-0000-00000000000a', 'e2222222-2222-2222-2222-222222222222',
        'v1:dishes:2026-10-03', '2026-10-03', 'e1111111-1111-1111-1111-111111111111',
        'ec000000-0000-0000-0000-000000000001');

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'body' from net.http_request_queue limit 1),
  'Alice took this off your day.',
  'taking something off somebody else''s day says so too'
);

-- ═══ Notes ════════════════════════════════════════════════════════════════
--
-- These have to run *as* somebody. A note's `updated_by` is stamped from
-- `auth.uid()` by its own trigger, and the notification reads that column
-- rather than calling `auth.uid()` again — so with no JWT the stamp is null,
-- the notifier correctly declines to name a ghost, and nothing is sent. Which
-- is exactly what the first version of this test proved, at some length.
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

delete from net.http_request_queue;
select pg_temp.become('e1111111-1111-1111-1111-111111111111');

insert into public.household_notes (id, household_id, title, body, created_by)
values ('ef000000-0000-0000-0000-000000000001', 'ed000000-0000-0000-0000-00000000000a',
        'Boiler', 'Landlord said he would send someone.',
        'e1111111-1111-1111-1111-111111111111');

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'title' from net.http_request_queue limit 1),
  'Boiler',
  'writing a note leads with its title'
);

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'body' from net.http_request_queue limit 1),
  'Alice wrote a note.',
  'and says who wrote it'
);

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'to' from net.http_request_queue limit 1),
  'ExponentPushToken[bob]',
  'to the housemate, not back to the author'
);

-- A note with no title falls back to its first line, the same promotion the
-- card on the board does — so the push and the row it opens agree.
reset role;
delete from net.http_request_queue;
select pg_temp.become('e1111111-1111-1111-1111-111111111111');

insert into public.household_notes (id, household_id, body, created_by)
values ('ef000000-0000-0000-0000-000000000002', 'ed000000-0000-0000-0000-00000000000a',
        E'Ask about the gutters\nand the fence', 'e1111111-1111-1111-1111-111111111111');

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'title' from net.http_request_queue limit 1),
  'Ask about the gutters',
  'an untitled note is announced by its first line'
);

-- ═══ Editing ══════════════════════════════════════════════════════════════
--
-- Straight after writing, so the ten-minute throttle is what is being tested:
-- one person saving twice while thinking is one piece of news.
reset role;
delete from net.http_request_queue;
select pg_temp.become('e1111111-1111-1111-1111-111111111111');

update public.household_notes
   set body = 'Landlord said he would send someone. Chase him Friday.'
 where id = 'ef000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'editing a note somebody just wrote says nothing — it is the same news'
);

-- Now with the note left alone for a while.
--
-- The stamp trigger has to come off to age a note: it sets `updated_at :=
-- now()` on every update, so an `update ... set updated_at = <2 hours ago>`
-- lands as *now* and the throttle keeps firing. Which is what the first
-- version of this test measured, and read as the throttle being wrong.
reset role;
alter table public.household_notes disable trigger household_notes_stamp_editor;
update public.household_notes
   set updated_at = now() - interval '2 hours'
 where id = 'ef000000-0000-0000-0000-000000000001';
alter table public.household_notes enable trigger household_notes_stamp_editor;
delete from net.http_request_queue;
select pg_temp.become('e1111111-1111-1111-1111-111111111111');

update public.household_notes
   set body = 'He came. Fixed.'
 where id = 'ef000000-0000-0000-0000-000000000001';

select is(
  (select convert_from(body, 'utf8')::jsonb -> 0 ->> 'body' from net.http_request_queue limit 1),
  'Alice updated a note.',
  'but coming back to it later is news again'
);

-- Touching a note without changing what it says is not news at all. Aged
-- first, so the throttle is not the thing suppressing it.
reset role;
alter table public.household_notes disable trigger household_notes_stamp_editor;
update public.household_notes
   set updated_at = now() - interval '2 hours'
 where id = 'ef000000-0000-0000-0000-000000000001';
alter table public.household_notes enable trigger household_notes_stamp_editor;
delete from net.http_request_queue;
select pg_temp.become('e1111111-1111-1111-1111-111111111111');

update public.household_notes
   set title = title
 where id = 'ef000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'and an edit that changes neither the title nor the body is not an edit'
);

reset role;
select * from finish();
rollback;
