-- ═══════════════════════════════════════════════════════════════════════════
-- Deleting your account
--
-- Apple requires that an app offering account creation also offers deletion
-- from inside the app. It was the largest gap between this app and anything
-- submittable, and it could not simply be bolted on: six foreign keys point at
-- auth.users with no ON DELETE clause, so `delete from auth.users` fails on a
-- constraint violation rather than doing anything.
--
-- The decision those six keys force, and the reason this needed a migration
-- rather than a screen:
--
--   > When the last member of a household deletes their account, the household
--   > and everything in it goes with them. When a member leaves a household
--   > somebody else still uses, their completions must NOT — or the other
--   > person's history acquires holes where the shared chores used to be.
--
-- So completions outlive their author. `completed_by` becomes nullable and
-- nulls out on deletion, and a display-name snapshot is captured at completion
-- time so "Sam did this in March" still reads as Sam afterwards. Attribution
-- that depends on a row that can be deleted is attribution that will one day
-- be wrong.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The name snapshot ──────────────────────────────────────────────────────
-- Denormalised on purpose, and for the same reason `due_on` is: history has to
-- stay readable without joining to rows that may be gone. A trigger fills it,
-- so the app does not have to remember and older clients keep working.
alter table public.chore_completions
  add column completed_by_name text;

update public.chore_completions c
set completed_by_name = p.display_name
from public.profiles p
where p.id = c.completed_by and c.completed_by_name is null;

create or replace function private.snapshot_completed_by_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.completed_by_name is null then
    select display_name into new.completed_by_name
    from public.profiles where id = new.completed_by;
  end if;
  return new;
end;
$$;

create trigger chore_completions_snapshot_name
  before insert on public.chore_completions
  for each row execute function private.snapshot_completed_by_name();

-- ── Let the author be forgotten ────────────────────────────────────────────
--
-- These reference `public.profiles`, not `auth.users`, and that is not
-- incidental: 20260730045436 re-pointed every user-referencing key at profiles
-- because PostgREST cannot embed across the `auth` schema, and the member list
-- came back empty with a 400 until it did. Re-pointing them here would have
-- broken "completed by Sam" again — which an integration test caught, having
-- been written for exactly that reason.
--
-- The cascade still works, one hop longer: profiles.id references
-- auth.users(id) on delete cascade, so deleting the account deletes the
-- profile, which nulls these.
-- Completions are the load-bearing case: they are the append-only log the
-- stats are built from, and they belong to the household as much as to the
-- person who ticked the box.
alter table public.chore_completions
  drop constraint chore_completions_completed_by_fkey,
  alter column completed_by drop not null,
  add constraint chore_completions_completed_by_fkey
    foreign key (completed_by) references public.profiles (id) on delete set null;

-- The rest are provenance rather than history anybody reads. Nulling them
-- keeps the row and loses only "who first typed this in", which nothing in the
-- app displays.
alter table public.households
  drop constraint households_created_by_fkey,
  alter column created_by drop not null,
  add constraint households_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.chores
  drop constraint chores_created_by_fkey,
  alter column created_by drop not null,
  add constraint chores_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.chore_exceptions
  drop constraint chore_exceptions_created_by_fkey,
  alter column created_by drop not null,
  add constraint chore_exceptions_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.household_invites
  drop constraint household_invites_created_by_fkey,
  alter column created_by drop not null,
  add constraint household_invites_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.household_invites
  drop constraint household_invites_redeemed_by_fkey,
  add constraint household_invites_redeemed_by_fkey
    foreign key (redeemed_by) references public.profiles (id) on delete set null;

-- ═══════════════════════════════════════════════════════════════════════════
-- The RPC
--
-- SECURITY DEFINER because deleting from auth.users is not something an
-- `authenticated` role may do, and must never become something it may do
-- generally — the function deletes exactly `auth.uid()` and takes no argument,
-- so there is no id to tamper with.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  emptied uuid[];
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Households where this person is the only member. Collected *before* the
  -- membership goes, and deleted after, because "has no members" is only true
  -- once the row is gone.
  select coalesce(array_agg(hm.household_id), '{}')
  into emptied
  from public.household_members hm
  where hm.user_id = me
    and not exists (
      select 1 from public.household_members other
      where other.household_id = hm.household_id and other.user_id <> me
    );

  delete from public.household_members where user_id = me;

  -- Cascades through chores, completions and exceptions. Nobody is left to
  -- read any of it, and leaving orphaned households behind would be a slow
  -- leak nothing ever cleans up.
  delete from public.households where id = any(emptied);

  -- Everything still pointing at this user now nulls out rather than blocking:
  -- profiles and memberships cascade, completions and authorship set null.
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Deletes the signed-in account. Completions survive with a name snapshot; '
  'households left with no members are removed.';
