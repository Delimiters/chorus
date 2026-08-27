-- ═══════════════════════════════════════════════════════════════════════════
-- The day plan: what you have committed to, as opposed to what exists
--
-- Chorus has always answered "what is due". It has never answered "what am I
-- doing today", and those are different objects. Emily, in as many words:
-- "you have 20 things due today that aren't possible to do in 1 day so i just
-- close the app". Fifty true statements and no decision is a report, not a
-- to-do list — and a report is the thing she already had in Notes.
--
-- So the commitment gets a table. It is not a filter over the backlog, not a
-- saved view, and not a flag on `chores`: it is a small ordered set of things
-- somebody chose for one day.
--
-- ── Keyed by occurrence, not by chore ─────────────────────────────────────
--
-- "Water the plants" recurs; what you commit to is Thursday's watering. Keying
-- on `occurrence_key` means planning today's says nothing about tomorrow's,
-- and it is the same key completions, exceptions and subtask ticks already
-- use. A chore-level plan would have needed a rule for what happens when the
-- next occurrence arrives, and every answer to that is wrong.
--
-- ── It never inherits ─────────────────────────────────────────────────────
--
-- There is deliberately no "rollover" anything. A plan that carries unfinished
-- work into tomorrow becomes a backlog again within a fortnight, which is the
-- exact failure this exists to fix. Rows for a past day simply stop being
-- today's; nothing is written at midnight, no job runs, and the work loses
-- nothing — it keeps its due date, its lateness and its flag, and tomorrow's
-- proposal ranks it first *because* it was left over.
--
-- The plan is therefore bounded by construction rather than by discipline,
-- which is what makes it survive a bad week. A bad week is when it most needs
-- to still be five things.
--
-- ── Whose plan ───────────────────────────────────────────────────────────
--
-- Per person. Both of you can see both plans — knowing what your housemate has
-- taken on today is most of the point of sharing a list — but only you can
-- change yours. The same asymmetry as `chore_flags`, and for the same reason:
-- a completion is a household fact either of you may record, whereas a plan is
-- a statement about what somebody intends to do, and nobody gets to make that
-- for them.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.plan_entries (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  chore_id       uuid not null references public.chores (id) on delete cascade,

  /*
   * The occurrence being committed to.
   *
   * Client-computed and deterministic, exactly as `chore_completions` does it.
   * Never re-derived server-side: that would be a second recurrence engine and
   * the two would drift.
   */
  occurrence_key text not null,

  /*
   * The day this is planned *for*, which is not the day it was added.
   *
   * A civil date rather than a timestamp: "which day is this on" is a calendar
   * question, and an instant answers it differently either side of midnight
   * depending on where the phone is standing.
   */
  planned_for    date not null,

  /*
   * Where it sits in the day.
   *
   * `numeric` rather than `integer` so that when drag-to-reorder is built, a
   * row can land between two neighbours by averaging them and write one row
   * instead of renumbering the day. **The gesture does not exist yet** — the
   * column is chosen so that building it needs no migration, which is the only
   * claim this comment makes. Ties break on `occurrence_key` client-side, so
   * the order is total regardless.
   */
  position       numeric not null default 1,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One entry per occurrence per person per day. Makes "add to today" safely
  -- idempotent, which is what lets the button be optimistic and what stops a
  -- double tap producing two rows for one job.
  unique (user_id, occurrence_key, planned_for)
);

comment on table public.plan_entries is
  'What one person committed to on one day. Per-day and never inherited: a past day''s rows are simply not today''s.';

-- The query the plan screen actually makes, every time it opens.
create index plan_entries_day_idx on public.plan_entries (household_id, planned_for);
create index plan_entries_user_idx on public.plan_entries (user_id, planned_for);
create index plan_entries_chore_idx on public.plan_entries (chore_id);

create trigger plan_entries_touch before update on public.plan_entries
  for each row execute function private.touch_updated_at();

alter table public.plan_entries enable row level security;

/*
 * Visible to the household, writable only by its owner.
 *
 * `chore_is_visible` so a plan entry cannot leak the existence — or the timing
 * — of a private chore. Without it, "Sam has 6 things planned" would count
 * something Sam is not allowed to know about.
 */
create policy plan_entries_select on public.plan_entries
  for select to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

create policy plan_entries_insert on public.plan_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
  );

/*
 * `chore_is_visible` on the check as well, matching insert.
 *
 * Repointing an entry at a chore you cannot see is already refused — Postgres
 * tests the new row against the SELECT policy too — so this is safe either way
 * today. But it is safe *by accident* rather than by statement, and it would
 * stop being safe the moment somebody widened the select policy for an
 * unrelated reason. Saying it here costs nothing.
 */
create policy plan_entries_update on public.plan_entries
  for update to authenticated
  using (user_id = (select auth.uid()) and private.is_household_member(household_id))
  with check (
    user_id = (select auth.uid())
    and private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
  );

create policy plan_entries_delete on public.plan_entries
  for delete to authenticated
  using (user_id = (select auth.uid()) and private.is_household_member(household_id));

/*
 * Explicit, not inherited.
 *
 * Postgres grants `authenticated` a default ACL of `arwdDxtm` on every new
 * table created by `postgres` — see 20260827193000_append_only_grants.sql,
 * where relying on that default had quietly made three event-log tables
 * editable. `revoke all` first, then name what this table needs.
 */
revoke all on public.plan_entries from anon;
revoke all on public.plan_entries from authenticated;
grant select, insert, update, delete on public.plan_entries to authenticated;

-- Realtime: a plan built on the laptop should appear on the phone, and seeing
-- your housemate pick something up is half the point of sharing the list.
alter table public.plan_entries replica identity full;
alter publication supabase_realtime add table public.plan_entries;
