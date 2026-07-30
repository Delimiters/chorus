-- ═══════════════════════════════════════════════════════════════════════════
-- Chorus — core schema
--
-- Design notes that matter for reading this file:
--
--   * Occurrences are NEVER stored. Only the recurrence *rule* (chores.schedule)
--     and *deviations from it* (chore_completions, chore_exceptions) are
--     persisted. "What is due today and whose turn is it" is computed by the
--     pure engine in src/core. See docs/ARCHITECTURE.md.
--
--   * Due dates are civil dates (`date`, no timezone). Only "when did this
--     actually happen" is a `timestamptz`. See docs/RECURRENCE.md.
--
--   * RLS helper functions live in the `private` schema, which is NOT exposed
--     through the Data API. A SECURITY DEFINER function in an exposed schema is
--     callable by any client, which Supabase explicitly warns against.
--
--   * The project has "automatically expose new tables" disabled, so every
--     table needs an explicit GRANT. Access is stated out loud rather than
--     inherited by default.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── Private schema for RLS helpers ─────────────────────────────────────────
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tables
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles ───────────────────────────────────────────────────────────────
-- One row per auth user, created by a trigger on signup so the app never has to
-- handle "signed in but has no profile".
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 60),
  -- Which of the two household inks this person is drawn in.
  accent        text not null default 'blue' check (accent in ('blue', 'pink')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Public profile per auth user. Readable by anyone sharing a household.';

-- ── households ─────────────────────────────────────────────────────────────
create table public.households (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 60),
  -- IANA zone. The single source of truth for what "today" means; the engine
  -- receives today as a parameter computed from this.
  time_zone             text not null default 'UTC',
  -- 0 = Sunday .. 6 = Saturday. A setting, never hardcoded — the previous
  -- implementation assumed Sunday and got weekly scheduling wrong.
  week_starts_on        smallint not null default 0 check (week_starts_on between 0 and 6),
  default_reminder_time time,
  -- How far back a neglected chore keeps appearing on Today. Without a bound, a
  -- year-old daily chore floods the list with 365 overdue rows.
  overdue_horizon_days  smallint not null default 14
                          check (overdue_horizon_days between 1 and 90),
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── household_members ──────────────────────────────────────────────────────
create type public.member_role as enum ('owner', 'admin', 'member');

create table public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.member_role not null default 'member',
  -- Display order only. Rotation order lives in chores.assignment segments, so
  -- reordering members here can never rewrite who was responsible last month.
  sort_order    integer not null default 0,
  joined_at     timestamptz not null default now(),
  unique (household_id, user_id)
);

-- ── household_invites ──────────────────────────────────────────────────────
-- Redeemed only through public.redeem_invite(). There is deliberately no policy
-- letting a non-member look up a code, which would allow enumerating invites.
create table public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- No vowels or ambiguous glyphs: it gets read aloud across a kitchen.
  code          text not null unique check (code ~ '^[0-9A-HJ-NP-Z]{8}$'),
  created_by    uuid not null references auth.users (id),
  expires_at    timestamptz not null default (now() + interval '7 days'),
  redeemed_by   uuid references auth.users (id),
  redeemed_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- ── chores ─────────────────────────────────────────────────────────────────
-- `schedule` and `assignment` are jsonb because the eight recurrence variants
-- have disjoint fields. Modelling them as ~12 sparse nullable columns would
-- need a CHECK nobody could read, and still could not express "if kind =
-- 'weekly' then weekdays is required". Zod validates the shape on read and
-- write; the CHECKs below are a coarse backstop.
create table public.chores (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  notes           text check (notes is null or char_length(notes) <= 2000),

  schedule        jsonb not null,
  assignment      jsonb not null default '{"kind":"anyone"}'::jsonb,

  -- Generated columns so the hot filters stay cheap and indexable while the
  -- shape stays flexible.
  --
  -- starts_on/ends_on are `text`, not `date`, and deliberately so: a generated
  -- column's expression must be IMMUTABLE, and casting text to date is only
  -- STABLE because it depends on the DateStyle setting. Postgres rejects the
  -- `date` version outright.
  --
  -- Keeping them as text costs nothing here, because civil dates are
  -- 'YYYY-MM-DD' and so compare lexicographically exactly as they compare
  -- chronologically. `where ends_on >= '2026-07-29'` is correct and indexed.
  -- That is the same property the engine relies on. See docs/DATA_MODEL.md.
  schedule_kind   text generated always as (schedule -> 'rule' ->> 'kind') stored,
  starts_on       text generated always as (schedule ->> 'startsOn') stored,
  ends_on         text generated always as (nullif(schedule ->> 'endsOn', 'null')) stored,
  assignment_kind text generated always as (assignment ->> 'kind') stored,

  -- Soft delete. History must survive deleting a chore.
  archived_at     timestamptz,
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint chores_schedule_shape check (
    schedule ? 'rule'
    and schedule ? 'startsOn'
    and (schedule -> 'rule' ->> 'kind') in (
      'unscheduled', 'once', 'daily', 'weekly', 'weeklyFloating',
      'monthlyByDay', 'monthlyByWeekday', 'monthlyFloating'
    )
  ),
  constraint chores_assignment_shape check (
    (assignment ->> 'kind') in ('anyone', 'fixed', 'everyone', 'rotate')
  )
);

comment on column public.chores.schedule is
  'Recurrence rule + anchor. Validated by Zod (src/core/recurrence/schema.ts).';
comment on column public.chores.assignment is
  'Assignment mode, including append-only rotation segments. Never mutated in place.';

-- ── chore_completions ──────────────────────────────────────────────────────
-- An append-only event log, and the entire basis of the future stats feature:
-- no schema change will be needed for streaks or on-time rate.
create table public.chore_completions (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  chore_id        uuid not null references public.chores (id) on delete cascade,
  -- v1:{choreId}:{periodKey}:{slot}:{subject} — computed on the client with no
  -- round trip, which is what makes optimistic completion safe.
  occurrence_key  text not null check (char_length(occurrence_key) between 1 and 200),
  -- Denormalised from the rule so stats never need to re-expand history.
  due_on          date not null,
  completed_on    date not null,
  completed_at    timestamptz not null default now(),
  completed_by    uuid not null references auth.users (id),
  note            text check (note is null or char_length(note) <= 500),

  -- The idempotency guarantee. A double-tap or a retry-after-timeout raises
  -- 23505, which the API layer maps to success.
  unique (chore_id, occurrence_key)
);

-- ── chore_exceptions ───────────────────────────────────────────────────────
create type public.exception_kind as enum ('skip', 'reschedule');

create table public.chore_exceptions (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  chore_id        uuid not null references public.chores (id) on delete cascade,
  occurrence_key  text not null check (char_length(occurrence_key) between 1 and 200),
  kind            public.exception_kind not null,
  -- The date the rule originally produced.
  due_on          date not null,
  -- Where it moved to. A rescheduled occurrence keeps its key and index, so it
  -- keeps its rotation turn and any existing completion still matches.
  moved_to        date,
  reason          text check (reason is null or char_length(reason) <= 500),
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),

  unique (chore_id, occurrence_key),
  constraint exception_moved_to_iff_reschedule check (
    (kind = 'reschedule' and moved_to is not null)
    or (kind = 'skip' and moved_to is null)
  )
);

-- ── push_tokens ────────────────────────────────────────────────────────────
-- Unused in v1 (local notifications only, since remote push needs a paid Apple
-- account). Created now so enabling push later is not a migration.
create table public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  token         text not null unique,
  platform      text not null check (platform in ('ios', 'android')),
  device_name   text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Indexes
--
-- Supabase's guidance is explicit: index every column used in a policy. The
-- first one below is the most load-bearing in the schema — the membership
-- helper hits it on every RLS check on every table.
-- ═══════════════════════════════════════════════════════════════════════════

create index household_members_user_idx on public.household_members (user_id);
create index household_members_household_idx on public.household_members (household_id);
create index households_created_by_idx on public.households (created_by);

-- Primary read path: every live chore in my household.
create index chores_household_live_idx on public.chores (household_id)
  where archived_at is null;
create index chores_household_kind_idx on public.chores (household_id, schedule_kind);

-- Primary read path: completions in a date window. Also the stats path.
create index completions_household_due_idx on public.chore_completions (household_id, due_on);
create index completions_household_done_idx
  on public.chore_completions (household_id, completed_on desc);
create index completions_by_user_idx
  on public.chore_completions (completed_by, completed_on desc);

create index exceptions_household_due_idx on public.chore_exceptions (household_id, due_on);
create index exceptions_household_moved_idx on public.chore_exceptions (household_id, moved_to)
  where moved_to is not null;

create index invites_household_idx on public.household_invites (household_id);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS helper functions
--
-- The pitfall these exist to avoid: a policy on household_members that
-- subqueries household_members re-triggers itself and aborts with
--   42P17: infinite recursion detected in policy for relation "household_members"
-- A SECURITY DEFINER function executes as its owner, so RLS is not applied to
-- the query inside it, which breaks the cycle.
--
-- Three details that are easy to get wrong and all matter:
--   * `set search_path = ''` plus fully-qualified names. Without it, a
--     SECURITY DEFINER function is a privilege-escalation vector via a
--     hijacked search_path.
--   * `stable`, not volatile, so Postgres caches the result per statement.
--   * `(select auth.uid())` in subselect form, so the planner hoists it into an
--     InitPlan and evaluates it once per query rather than once per row.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function private.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = hid
      and hm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_household_admin(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = hid
      and hm.user_id = (select auth.uid())
      and hm.role in ('owner', 'admin')
  );
$$;

create or replace function private.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = hid
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
  );
$$;

create or replace function private.household_ids_for_current_user()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id
  from public.household_members hm
  where hm.user_id = (select auth.uid());
$$;

revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.is_household_admin(uuid) from public;
revoke all on function private.is_household_owner(uuid) from public;
revoke all on function private.household_ids_for_current_user() from public;

grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.is_household_admin(uuid) to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;
grant execute on function private.household_ids_for_current_user() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers
-- ═══════════════════════════════════════════════════════════════════════════

-- Keep updated_at honest without trusting clients.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger households_touch before update on public.households
  for each row execute function private.touch_updated_at();
create trigger chores_touch before update on public.chores
  for each row execute function private.touch_updated_at();

-- Every auth user gets a profile immediately, so the app never has to render a
-- signed-in state with no profile.
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
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row level security
--
-- Every policy names its role with TO, which stops Postgres evaluating it for
-- roles that could never match.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;
alter table public.chore_exceptions enable row level security;
alter table public.push_tokens enable row level security;

-- ── profiles ───────────────────────────────────────────────────────────────
-- Yourself, plus anyone who shares a household with you. Not the whole table: a
-- chore app has no reason to let you enumerate everyone who ever signed up.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.household_members hm
      where hm.user_id = public.profiles.id
        and hm.household_id in (select private.household_ids_for_current_user())
    )
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── households ─────────────────────────────────────────────────────────────
create policy households_select on public.households
  for select to authenticated
  using (private.is_household_member(id));

create policy households_insert on public.households
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy households_update on public.households
  for update to authenticated
  using (private.is_household_admin(id))
  with check (private.is_household_admin(id));

create policy households_delete on public.households
  for delete to authenticated
  using (private.is_household_owner(id));

-- ── household_members ──────────────────────────────────────────────────────
-- Uses the SECURITY DEFINER helper rather than a self-referential subquery.
create policy household_members_select on public.household_members
  for select to authenticated
  using (private.is_household_member(household_id));

-- Bootstrap: you may create your own membership row for a household you just
-- created. Everyone else joins through redeem_invite().
create policy household_members_insert_self on public.household_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.households h
      where h.id = household_id
        and h.created_by = (select auth.uid())
    )
  );

create policy household_members_update on public.household_members
  for update to authenticated
  using (private.is_household_admin(household_id))
  with check (private.is_household_admin(household_id));

-- You can always remove yourself; admins can remove others.
create policy household_members_delete on public.household_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_household_admin(household_id)
  );

-- ── household_invites ──────────────────────────────────────────────────────
create policy invites_select on public.household_invites
  for select to authenticated
  using (private.is_household_member(household_id));

create policy invites_insert on public.household_invites
  for insert to authenticated
  with check (
    private.is_household_admin(household_id)
    and created_by = (select auth.uid())
  );

create policy invites_delete on public.household_invites
  for delete to authenticated
  using (private.is_household_admin(household_id));

-- ── chores ─────────────────────────────────────────────────────────────────
create policy chores_select on public.chores
  for select to authenticated
  using (private.is_household_member(household_id));

create policy chores_insert on public.chores
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

create policy chores_update on public.chores
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy chores_delete on public.chores
  for delete to authenticated
  using (private.is_household_member(household_id));

-- ── chore_completions ──────────────────────────────────────────────────────
create policy completions_select on public.chore_completions
  for select to authenticated
  using (private.is_household_member(household_id));

-- `completed_by = auth.uid()` is load-bearing: without it a member could forge
-- a completion attributed to their partner.
create policy completions_insert on public.chore_completions
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and completed_by = (select auth.uid())
  );

-- Either housemate may un-complete. A two-person household is a trust
-- relationship, not an access-control problem, and "I ticked the wrong one"
-- needs to be fixable by whoever notices.
create policy completions_delete on public.chore_completions
  for delete to authenticated
  using (private.is_household_member(household_id));

-- ── chore_exceptions ───────────────────────────────────────────────────────
create policy exceptions_select on public.chore_exceptions
  for select to authenticated
  using (private.is_household_member(household_id));

create policy exceptions_insert on public.chore_exceptions
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

create policy exceptions_delete on public.chore_exceptions
  for delete to authenticated
  using (private.is_household_member(household_id));

-- ── push_tokens ────────────────────────────────────────────────────────────
-- Strictly private. Nobody sees anyone else's device tokens.
create policy push_tokens_select on public.push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_tokens_insert on public.push_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy push_tokens_update on public.push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_tokens_delete on public.push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════
-- Invite redemption
--
-- A non-member must be able to redeem a code without being able to enumerate
-- invites or read the household first. No table policy can thread that needle,
-- so redemption is a SECURITY DEFINER RPC and the invites table has no
-- non-member SELECT path at all.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.redeem_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.household_invites;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- FOR UPDATE so two people racing the same code cannot both redeem it.
  select * into v_invite
  from public.household_invites
  where code = upper(trim(invite_code))
  for update;

  if not found then
    raise exception 'invalid_invite_code' using errcode = 'P0002';
  end if;
  if v_invite.redeemed_at is not null then
    raise exception 'invite_already_used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_uid, 'member')
  on conflict (household_id, user_id) do nothing;

  update public.household_invites
  set redeemed_by = v_uid,
      redeemed_at = now()
  where id = v_invite.id;

  return v_invite.household_id;
end;
$$;

revoke all on function public.redeem_invite(text) from public;
grant execute on function public.redeem_invite(text) to authenticated;

-- Creating a household and joining it are one atomic operation. Doing it in two
-- client round trips can leave a household with no members, which nothing can
-- then read or delete.
create or replace function public.create_household(
  household_name text,
  tz text default 'UTC',
  week_start smallint default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  insert into public.households (name, time_zone, week_starts_on, created_by)
  values (trim(household_name), tz, week_start, v_uid)
  returning id into v_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

revoke all on function public.create_household(text, text, smallint) from public;
grant execute on function public.create_household(text, text, smallint) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants
--
-- "Automatically expose new tables" is off, so nothing is reachable through the
-- Data API without appearing here. RLS still decides which *rows*; these decide
-- which tables exist at all.
-- ═══════════════════════════════════════════════════════════════════════════

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.households to authenticated;
grant select, insert, update, delete on public.household_members to authenticated;
grant select, insert, delete on public.household_invites to authenticated;
grant select, insert, update, delete on public.chores to authenticated;
grant select, insert, delete on public.chore_completions to authenticated;
grant select, insert, delete on public.chore_exceptions to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

-- Note the deliberate omissions: no INSERT on profiles (the signup trigger owns
-- that), and no UPDATE on completions or exceptions (they are append-only
-- events, so correcting one means deleting and re-inserting).

-- `anon` is granted nothing, but that needs saying explicitly rather than
-- assuming. Supabase's default privileges hand `anon` TRUNCATE, REFERENCES and
-- TRIGGER on new tables in `public`. None of those are reachable through
-- PostgREST, so this is not a live hole — but an unauthenticated role holding
-- TRUNCATE on the completions log is not something to leave lying around.
--
-- supabase/tests/grants.test.sql asserts anon holds zero privileges on every
-- table in public, so a table added later cannot quietly skip this.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- `service_role` also needs explicit grants once auto-expose is off — the
-- default privileges hand it only TRUNCATE/REFERENCES/TRIGGER, same as anon.
-- It bypasses RLS by design and is used for admin tooling, migrations, and
-- test setup. It must never appear in a client bundle.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime
-- ═══════════════════════════════════════════════════════════════════════════

alter publication supabase_realtime add table public.chores;
alter publication supabase_realtime add table public.chore_completions;
alter publication supabase_realtime add table public.chore_exceptions;
alter publication supabase_realtime add table public.household_members;
alter publication supabase_realtime add table public.households;

-- DELETE events only carry the primary key unless replica identity is full, and
-- the client needs occurrence_key to know which row vanished.
alter table public.chore_completions replica identity full;
alter table public.chore_exceptions replica identity full;
