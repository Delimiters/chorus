-- ═══════════════════════════════════════════════════════════════════════════
-- Inks belong to a membership, not a profile
--
-- Each person in a household is drawn in an ink, and the ink is what makes
-- "whose turn is it" readable at a glance. Two people sharing one defeats that,
-- so it must be unique within a household.
--
-- That uniqueness is impossible to enforce while the colour lives on the
-- profile: if you belong to two households, changing your ink to resolve a clash
-- in one could create a clash in the other. There is no value satisfying both.
-- Moving it to the membership makes it a plain unique constraint — enforced by
-- the database rather than by app logic that might forget — and makes
-- per-household inks free if multi-household ever ships.
--
-- Also removes overdue_horizon_days. The overdue rule is now derived from each
-- chore's own cadence (show only the most recent due-or-past occurrence of a
-- recurring chore; never expire a one-time one), so a fixed day count has
-- nothing left to decide. See docs/DESIGN_SYSTEM.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The ink moves to the membership ────────────────────────────────────────
alter table public.household_members
  add column accent text not null default 'blue';

-- Eight curated inks. Not a free colour: an arbitrary hex has no hand-tuned dark
-- variant, and roughly half would be illegible on one theme or the other. The
-- set and its light/dark pairs live in src/design/tokens.ts.
alter table public.household_members
  add constraint household_members_accent_valid
  check (accent in ('blue', 'pink', 'teal', 'ochre', 'plum', 'green', 'rust', 'slate'));

-- Carry across whatever people already had.
update public.household_members hm
set accent = p.accent
from public.profiles p
where p.id = hm.user_id and p.accent in ('blue', 'pink');

-- Resolve duplicates the old model allowed, before the constraint lands. Keeps
-- the earliest member's ink and moves later ones to the first free colour.
with ranked as (
  select
    id,
    row_number() over (
      partition by household_id, accent order by joined_at, id
    ) as dup_rank
  from public.household_members
)
update public.household_members hm
set accent = coalesce(
  (
    select ink
    from unnest(array['blue', 'pink', 'teal', 'ochre', 'plum', 'green', 'rust', 'slate'])
      with ordinality as p(ink, slot)
    where not exists (
      select 1
      from public.household_members other
      where other.household_id = hm.household_id
        and other.accent = p.ink
        and other.id <> hm.id
    )
    order by p.slot
    limit 1
  ),
  hm.accent
)
from ranked r
where r.id = hm.id and r.dup_rank > 1;

alter table public.household_members
  add constraint household_members_accent_unique unique (household_id, accent);

comment on column public.household_members.accent is
  'Which ink this person is drawn in, within this household. Unique per household: a shared ink identifies nobody. See docs/DESIGN_SYSTEM.md.';

alter table public.profiles drop column accent;

-- ── overdue_horizon_days is no longer meaningful ───────────────────────────
alter table public.households drop column overdue_horizon_days;

-- ── Joining must pick a free ink ───────────────────────────────────────────
--
-- Found immediately by the integration suite: with a plain column default,
-- every new member arrived as 'blue' and collided with the owner, so redeeming
-- an invite failed with a unique violation. Every path that creates a membership
-- has to choose an unused ink.
create or replace function private.next_available_ink(hid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ink
  from unnest(array['blue', 'pink', 'teal', 'ochre', 'plum', 'green', 'rust', 'slate'])
    with ordinality as p(ink, slot)
  where not exists (
    select 1 from public.household_members hm
    where hm.household_id = hid and hm.accent = p.ink
  )
  order by p.slot
  limit 1;
$$;

revoke all on function private.next_available_ink(uuid) from public;
grant execute on function private.next_available_ink(uuid) to authenticated;

create or replace function public.redeem_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.household_invites;
  v_uid uuid := (select auth.uid());
  v_ink text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

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

  -- Already a member: nothing to do, and no ink to allocate.
  if exists (
    select 1 from public.household_members
    where household_id = v_invite.household_id and user_id = v_uid
  ) then
    update public.household_invites
    set redeemed_by = v_uid, redeemed_at = now()
    where id = v_invite.id;
    return v_invite.household_id;
  end if;

  v_ink := private.next_available_ink(v_invite.household_id);
  if v_ink is null then
    -- Eight inks, so eight people. Better to say so than to silently reuse one
    -- and make the colour stop identifying anybody.
    raise exception 'household_full' using errcode = 'P0001';
  end if;

  insert into public.household_members (household_id, user_id, role, accent)
  values (v_invite.household_id, v_uid, 'member', v_ink);

  update public.household_invites
  set redeemed_by = v_uid, redeemed_at = now()
  where id = v_invite.id;

  return v_invite.household_id;
end;
$$;

revoke all on function public.redeem_invite(text) from public;
grant execute on function public.redeem_invite(text) to authenticated;

-- The founder takes the first ink.
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

  insert into public.household_members (household_id, user_id, role, accent)
  values (v_id, v_uid, 'owner', 'blue');

  return v_id;
end;
$$;

revoke all on function public.create_household(text, text, smallint) from public;
grant execute on function public.create_household(text, text, smallint) to authenticated;
