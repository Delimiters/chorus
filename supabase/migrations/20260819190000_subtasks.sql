-- ═══════════════════════════════════════════════════════════════════════════
-- Subtasks: the steps inside a chore, ticked per occurrence
--
-- "Clean the bathroom" is really four things, and ticking them off one at a
-- time is how you know where you got to when you are interrupted. They are
-- deliberately *not* a way to complete the chore: finishing every step does
-- not finish it, because the chore is done when the person doing it says so.
-- "Follow up with John when you're done" is a step you tick afterwards.
--
-- Two tables, and the split is the point. `chore_subtasks` is the *definition*
-- — the steps this chore has, in order, edited on the chore form. Ticks are
-- separate and keyed by `occurrence_key`, exactly as completions and
-- exceptions already are.
--
-- ── Why ticks are per occurrence ──────────────────────────────────────────
--
-- The alternative was a single `ticked_at` on the definition, with "is it
-- done" derived by comparing it to the chore's last completion. It was tried
-- and abandoned: every question about it needed another rule — what happens
-- after completing, what happens on the next occurrence, what happens to a
-- step ticked after the chore was finished — and none of them could answer
-- "what did I actually do last Tuesday", because a single timestamp has no
-- history in it.
--
-- Keyed by occurrence, all of that disappears. A new occurrence has no ticks,
-- so it starts fresh with nothing written. A past occurrence keeps its own, so
-- looking back at last week on Upcoming shows what was really done. Undoing a
-- completion changes nothing, because ticks were never tied to completion.
--
-- The trade, stated: progress on an occurrence that is later superseded stays
-- with that occurrence rather than following you forward. Tick two steps on
-- Tuesday, never finish, and Friday's occurrence starts clean. That is the
-- honest answer — a week has passed and the work needs doing again — and
-- Tuesday's ticks are still there on Tuesday.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.chore_subtasks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  chore_id     uuid not null references public.chores (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  -- Always set, unlike a routine item's: a list of steps is a sequence from
  -- the moment it is written, so there is no fallback for null to mean.
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.chore_subtasks is
  'The steps a chore has. Ticks live in chore_subtask_ticks, keyed by occurrence.';

create index chore_subtasks_chore_idx on public.chore_subtasks (chore_id, position);
create index chore_subtasks_household_idx on public.chore_subtasks (household_id);

create trigger chore_subtasks_touch before update on public.chore_subtasks
  for each row execute function private.touch_updated_at();

create table public.chore_subtask_ticks (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  subtask_id     uuid not null references public.chore_subtasks (id) on delete cascade,
  /*
   * The occurrence this was ticked against.
   *
   * Client-computed and deterministic, the same key `chore_completions` uses.
   * Never re-derived server-side: that would be a second recurrence engine,
   * and the two would drift.
   */
  occurrence_key text not null,
  ticked_on      date not null,
  ticked_by      uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  -- One tick per step per occurrence. Makes a double tap idempotent, which is
  -- what lets the checkbox be optimistic.
  unique (subtask_id, occurrence_key)
);

comment on table public.chore_subtask_ticks is
  'A step ticked off for one occurrence. Absence is "not done"; a new occurrence starts empty.';

create index chore_subtask_ticks_occurrence_idx
  on public.chore_subtask_ticks (occurrence_key);
create index chore_subtask_ticks_household_idx
  on public.chore_subtask_ticks (household_id);

alter table public.chore_subtasks enable row level security;
alter table public.chore_subtask_ticks enable row level security;

/*
 * Visibility is the parent chore's, exactly.
 *
 * `chore_is_visible` is the same SECURITY DEFINER helper the completions and
 * exceptions policies use, and it already accounts for a private chore.
 * Without it a subtask would leak the existence — and the title — of a chore
 * the other person is not allowed to see.
 */
create policy chore_subtasks_select on public.chore_subtasks
  for select to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

create policy chore_subtasks_insert on public.chore_subtasks
  for insert to authenticated
  with check (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

create policy chore_subtasks_update on public.chore_subtasks
  for update to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id))
  with check (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

create policy chore_subtasks_delete on public.chore_subtasks
  for delete to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

/*
 * A tick inherits its step's visibility, which inherits the chore's.
 *
 * SECURITY DEFINER again, and for the same reason: this is called from a
 * policy, a policy expression is an ordinary query, and `chore_subtasks`' own
 * RLS would otherwise apply inside it — hiding your own ticks from you.
 */
create or replace function private.subtask_is_visible(subtask uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chore_subtasks s
    where s.id = subtask
      and private.is_household_member(s.household_id)
      and private.chore_is_visible(s.chore_id)
  );
$$;

revoke all on function private.subtask_is_visible(uuid) from public;
grant execute on function private.subtask_is_visible(uuid) to authenticated;

create policy subtask_ticks_select on public.chore_subtask_ticks
  for select to authenticated
  using (private.is_household_member(household_id) and private.subtask_is_visible(subtask_id));

create policy subtask_ticks_insert on public.chore_subtask_ticks
  for insert to authenticated
  with check (private.is_household_member(household_id) and private.subtask_is_visible(subtask_id));

-- Either housemate may un-tick a step, as either may un-complete a chore: a
-- two-person household is a trust relationship, and the asymmetry that exists
-- for routines is because those are private, which these are not.
create policy subtask_ticks_delete on public.chore_subtask_ticks
  for delete to authenticated
  using (private.is_household_member(household_id) and private.subtask_is_visible(subtask_id));

revoke all on public.chore_subtasks from anon;
revoke all on public.chore_subtask_ticks from anon;
grant select, insert, update, delete on public.chore_subtasks to authenticated;
grant select, insert, delete on public.chore_subtask_ticks to authenticated;

-- Ticking a step has to reach the other phone, the same as ticking a chore.
-- FULL on the ticks table because un-ticking is a delete, and a delete emits
-- only the primary key otherwise — with no household_id for the channel filter.
alter table public.chore_subtasks replica identity full;
alter table public.chore_subtask_ticks replica identity full;
alter publication supabase_realtime add table public.chore_subtasks;
alter publication supabase_realtime add table public.chore_subtask_ticks;
