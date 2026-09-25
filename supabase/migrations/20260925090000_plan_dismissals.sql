-- ═══════════════════════════════════════════════════════════════════════════
-- "I took that off on purpose"
--
-- The plan filled itself once a day and then stopped, because the fill and the
-- act of removing something pull in opposite directions: run the fill twice and
-- whatever you took off comes straight back. A device-local day marker
-- (`autoPlannedOn`) was what stopped the second run.
--
-- That bought stickiness at the cost of staleness, and Jake hit the cost:
--
--   *"when you create or reassign a chore or really just update it at all the
--   my plan rechecks to see if it should show up on there, or maybe my plan
--   just recalculates every time you open it (leaving off things you
--   specifically took off the plan manually). That way if you mess with
--   something midday you're not confused why it's not there."*
--
-- The parenthesis is the design. Record the *removals* rather than the fact
-- that a fill happened, and the fill becomes idempotent: it can run on every
-- render, forever, and will never hand back something you took off. Create a
-- chore at two in the afternoon and it appears; reassign one and it moves.
--
-- ── Why this is a table and not another device preference ─────────────────
--
-- Both phones now fill *both* people's plans, so a device-local record is
-- wrong by construction: Emily takes the mopping off her plan on her phone,
-- Jake opens the app, his device has no record of it, and the mopping comes
-- back. The removal is a fact about the household's day, so it lives where
-- both phones can see it.
--
-- It also replaces `autoPlannedFlags`, the per-occurrence device record that
-- existed for exactly this reason on the flagged path. One mechanism instead
-- of two, and this one works across devices.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.plan_dismissals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Whose day it was taken off. Not "who took it off" — either housemate may
  -- edit either plan, and what matters is which plan is now missing it.
  user_id uuid not null references public.profiles (id) on delete cascade,

  occurrence_key text not null check (char_length(occurrence_key) between 1 and 200),

  -- The day it was taken off, so tomorrow starts clean. A chore you did not
  -- want today is not a chore you never want.
  dismissed_on date not null,

  created_at timestamptz not null default now(),

  /*
   * The same shape `plan_entries` uses, and for the same reason: taking one
   * row off twice — a double tap, a retry after a timeout — must be one fact,
   * not two rows. Lets the write be an upsert that cannot fail.
   */
  unique (user_id, occurrence_key, dismissed_on)
);

-- The fill asks "what has been taken off this day", for both people at once.
create index plan_dismissals_household_day_idx
  on public.plan_dismissals (household_id, dismissed_on);

alter table public.plan_dismissals enable row level security;

/*
 * Household-wide on every verb, matching `plan_entries` exactly.
 *
 * Either housemate may take something off either plan — that has been true
 * since 2026-09-07 — so the record of having done it has to be writable by
 * whoever did it, not only by whose day it was.
 */
create policy plan_dismissals_select on public.plan_dismissals
  for select to authenticated
  using (private.is_household_member(household_id));

create policy plan_dismissals_insert on public.plan_dismissals
  for insert to authenticated
  with check (private.is_household_member(household_id));

create policy plan_dismissals_delete on public.plan_dismissals
  for delete to authenticated
  using (private.is_household_member(household_id));

/*
 * No update policy, deliberately. A dismissal has nothing editable: it is a
 * day, a person and an occurrence. Putting the chore back is a delete.
 */

-- Repeated deliberately: the blanket revoke ran in 20260729214817, before this
-- table existed, and grants.test.sql has caught this omission before.
revoke all on public.plan_dismissals from anon;
grant select, insert, delete on public.plan_dismissals to authenticated;

-- Both phones fill both plans, so a removal on one has to reach the other
-- before its next fill — otherwise the other phone hands the chore straight
-- back, which is the whole failure this table exists to prevent.
alter publication supabase_realtime add table public.plan_dismissals;
alter table public.plan_dismissals replica identity full;

comment on table public.plan_dismissals is
  'A chore taken off somebody''s plan for one day. What makes the fill idempotent: it records removals rather than the fact that a fill ran, so the plan can recalculate on every open without undoing a deliberate removal.';
