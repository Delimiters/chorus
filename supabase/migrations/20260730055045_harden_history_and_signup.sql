-- ═══════════════════════════════════════════════════════════════════════════
-- Protect the completion log, stop a long name breaking signup, validate the zone
--
-- All three found by a retrospective architectural review of Phases 0-4.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The append-only log was one DELETE away from being erased ───────────────
--
-- `chore_completions.chore_id` cascades, `chores` granted DELETE to
-- `authenticated`, and `chores_delete` allowed any member — so a single hard
-- delete of a chore silently erased its entire completion history. The schema's
-- own comment on `archived_at` says "History must survive deleting a chore", and
-- ROADMAP.md promises the stats feature needs no schema change. Both were untrue.
--
-- Archiving is the only removal the product offers, so DELETE is revoked and the
-- policy dropped. A grant plus a policy permitting something the app never does
-- is only surface area for a later mistake.
revoke delete on public.chores from authenticated;
drop policy if exists chores_delete on public.chores;

comment on column public.chores.archived_at is
  'Soft delete. DELETE is deliberately not granted: hard-deleting a chore would cascade away its completion history, which the stats feature depends on.';

-- ── A 61-character display name aborted signup with an opaque 500 ───────────
--
-- `handle_new_user` inserted the raw metadata value into a column with
-- `check (char_length(display_name) between 1 and 60)`. A longer name raised a
-- check violation *inside the auth trigger*, which aborts the `auth.users` insert
-- — so the user sees a 500 from signup with no hint that their name caused it.
-- `new.email` is also null for non-email providers, which would hit NOT NULL.
--
-- Truncating is right here: the trigger's job is to guarantee a profile exists,
-- not to police input. The form validates length for a good message; this makes
-- it impossible to break signup regardless of what reaches the trigger.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Someone'
      ),
      60
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── The timezone was free text, and Intl throws on an unknown zone ─────────
--
-- An invalid value in `households.time_zone` makes `Intl.DateTimeFormat` throw,
-- which would crash every render of the agenda rather than degrade. The client
-- falls back to UTC defensively (src/data/today.ts), but the column should not
-- accept nonsense in the first place. Postgres has no IANA list without an
-- extension, so this checks the shape: either UTC or Area/Location.
alter table public.households
  add constraint households_time_zone_shape
  check (
    time_zone = 'UTC'
    or time_zone ~ '^[A-Za-z]+(_[A-Za-z]+)*(/[A-Za-z0-9+_-]+)+$'
  );
