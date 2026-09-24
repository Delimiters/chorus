create extension if not exists pgtap with schema extensions;

-- A note belongs to the house, not to whoever typed it.
--
-- Jake wanted "somewhere to write stuff down that's not quite ready to be a
-- task". The whole value is that the other person can act on it, which means
-- fixing a typo, adding a line, or deleting it once it is dealt with. So all
-- four verbs are household-wide.
--
-- That makes the most important assertion here the one most likely to be
-- written backwards: **Bob CAN edit Alice's note**. A file that only proved
-- outsiders are locked out would pass just as well against an owner-only
-- policy, which is the wrong feature.
--
-- The other half is `updated_by`. The screen shows "Emily edited this 2
-- minutes ago", and that footer is the only thing standing between two people
-- typing into one note and a silent overwrite. If the client could write that
-- column the footer would be decoration, so it is stamped by a trigger and
-- tested by trying to lie about it.

begin;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1111111-1111-1111-1111-111111111111', 'pgtap-nt-alice@example.test', '{"display_name":"Alice"}'),
  ('a2222222-2222-2222-2222-222222222222', 'pgtap-nt-bob@example.test',   '{"display_name":"Bob"}'),
  ('a3333333-3333-3333-3333-333333333333', 'pgtap-nt-cara@example.test',  '{"display_name":"Cara"}');

insert into public.households (id, name, created_by, time_zone)
values
  ('ad000000-0000-0000-0000-00000000000a', 'Note House',
   'a1111111-1111-1111-1111-111111111111', 'UTC'),
  ('ad000000-0000-0000-0000-00000000000b', 'Other House',
   'a3333333-3333-3333-3333-333333333333', 'UTC');

insert into public.household_members (household_id, user_id, role, accent)
values
  ('ad000000-0000-0000-0000-00000000000a', 'a1111111-1111-1111-1111-111111111111', 'owner', 'blue'),
  ('ad000000-0000-0000-0000-00000000000a', 'a2222222-2222-2222-2222-222222222222', 'member', 'pink'),
  ('ad000000-0000-0000-0000-00000000000b', 'a3333333-3333-3333-3333-333333333333', 'owner', 'blue');

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

-- ═══ Alice writes one ══════════════════════════════════════════════════════
select pg_temp.become('a1111111-1111-1111-1111-111111111111');

insert into public.household_notes (id, household_id, title, body, created_by)
values ('ae000000-0000-0000-0000-000000000001',
        'ad000000-0000-0000-0000-00000000000a',
        'Boiler', 'Landlord said he would send someone.',
        'a1111111-1111-1111-1111-111111111111');

-- Stamped, not supplied: the insert above never mentioned `updated_by`.
select is(
  (select updated_by from public.household_notes
   where id = 'ae000000-0000-0000-0000-000000000001'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'the trigger stamps the author on insert'
);

select throws_ok(
  $$ insert into public.household_notes (household_id, body, created_by)
     values ('ad000000-0000-0000-0000-00000000000a', 'not mine',
             'a2222222-2222-2222-2222-222222222222') $$,
  '42501',
  null,
  'you cannot write a note under somebody else''s name'
);

-- ═══ Bob, the housemate — the point of the feature ═════════════════════════
select pg_temp.become('a2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.household_notes),
  1,
  'the housemate sees it'
);

update public.household_notes
   set body = 'Landlord said he would send someone. Chase him Friday.'
 where id = 'ae000000-0000-0000-0000-000000000001';

select is(
  (select body from public.household_notes
   where id = 'ae000000-0000-0000-0000-000000000001'),
  'Landlord said he would send someone. Chase him Friday.',
  'and can edit it — a note is the house''s, not the author''s'
);

-- The footer's whole claim. Bob edited, so Bob is who it says.
select is(
  (select updated_by from public.household_notes
   where id = 'ae000000-0000-0000-0000-000000000001'),
  'a2222222-2222-2222-2222-222222222222'::uuid,
  'editing re-stamps `updated_by` to the editor'
);

-- Asked as an update that *tries* to lie, because `with check` cannot see OLD
-- and the policy would happily allow this. The trigger is what refuses.
update public.household_notes
   set created_by = 'a2222222-2222-2222-2222-222222222222',
       updated_by = 'a1111111-1111-1111-1111-111111111111'
 where id = 'ae000000-0000-0000-0000-000000000001';

select is(
  (select created_by from public.household_notes
   where id = 'ae000000-0000-0000-0000-000000000001'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'authorship cannot be rewritten by an editor'
);

select is(
  (select updated_by from public.household_notes
   where id = 'ae000000-0000-0000-0000-000000000001'),
  'a2222222-2222-2222-2222-222222222222'::uuid,
  'nor can the editor name somebody else as the last editor'
);

-- Moving a note into another household would make it visible to people who
-- were never in the room when it was written.
update public.household_notes
   set household_id = 'ad000000-0000-0000-0000-00000000000b'
 where id = 'ae000000-0000-0000-0000-000000000001';

select is(
  (select household_id from public.household_notes
   where id = 'ae000000-0000-0000-0000-000000000001'),
  'ad000000-0000-0000-0000-00000000000a'::uuid,
  'nor move the note into another household'
);

-- ═══ Cara, who lives somewhere else ════════════════════════════════════════
select pg_temp.become('a3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.household_notes),
  0,
  'somebody in another household sees nothing'
);

-- Bare, with no WHERE. A `delete … where id = …` has to read the row to find
-- it, so the SELECT policy refuses it before the DELETE policy is ever
-- consulted — and the assertion would then pass against no delete policy at
-- all. The same discovery is recorded on `chore_flags` and `plan_entries`.
delete from public.household_notes;

select pg_temp.become('a1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.household_notes),
  1,
  'and cannot delete one'
);

-- ═══ Deleting, by the household ════════════════════════════════════════════
select pg_temp.become('a2222222-2222-2222-2222-222222222222');

delete from public.household_notes
 where id = 'ae000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.household_notes),
  0,
  'but either housemate can delete a note once it is dealt with'
);

-- ═══ Two more, written after every count above ═════════════════════════════
--
-- Appended rather than woven in: the assertions above count rows, and a
-- fixture note added earlier would have made three of them wrong for reasons
-- that have nothing to do with what they test. Measured, not guessed — that is
-- exactly what happened on the first attempt.
select pg_temp.become('a1111111-1111-1111-1111-111111111111');

/*
 * `created_at` is stamped, not accepted.
 *
 * A review found this was the one column the trigger left client-writable on
 * insert — a note could claim to have been written in 1999 — and that removing
 * the pin broke no test, because nothing here mentioned the column. Nothing
 * reads it yet, which is exactly when it is cheap to hold.
 */
insert into public.household_notes (id, household_id, body, created_by, created_at)
values ('ae000000-0000-0000-0000-000000000009',
        'ad000000-0000-0000-0000-00000000000a', 'backdated',
        'a1111111-1111-1111-1111-111111111111', '1999-01-01');

select ok(
  (select created_at > '2020-01-01'::timestamptz from public.household_notes
   where id = 'ae000000-0000-0000-0000-000000000009'),
  'a note cannot claim to have been written in 1999'
);

/*
 * Newest edit first, which `listNotes` depends on and one row cannot show:
 * with a single note every ordering agrees.
 */
insert into public.household_notes (id, household_id, body, created_by)
values ('ae000000-0000-0000-0000-00000000000a',
        'ad000000-0000-0000-0000-00000000000a', 'written second',
        'a1111111-1111-1111-1111-111111111111');

update public.household_notes
   set body = 'edited last'
 where id = 'ae000000-0000-0000-0000-000000000009';

select is(
  (select id from public.household_notes
    where household_id = 'ad000000-0000-0000-0000-00000000000a'
    order by updated_at desc limit 1),
  'ae000000-0000-0000-0000-000000000009'::uuid,
  'the note edited most recently sorts first, not the one written last'
);

reset role;
select * from finish();
rollback;
