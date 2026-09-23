-- ═══════════════════════════════════════════════════════════════════════════
-- "Actually, this one's mine"
--
-- Jake: *"We also need a way to just one tap change who's turn it is. Like oh
-- actually this is going to be my turn this time."*
--
-- ── Why a table and not a column, and not an exception kind ───────────────
--
-- Rule 4: **rotation is a pure function of the date, never a stored pointer.**
-- An unfinished rotation must still advance. So the rotation is not edited;
-- a *deviation from it* is recorded, exactly as completions and skips are, and
-- the engine applies it on top. Take the override away and the rotation is
-- still whatever the date says it is.
--
-- Not a third value on `exception_kind` either, tempting as that looks.
-- `chore_exceptions` carries `unique (chore_id, occurrence_key)` and a CHECK
-- tying `moved_to` to the kind, so "skipped *and* reassigned" would be
-- unrepresentable — and those are independent facts about one occurrence.
-- Moving a chore and changing whose it is are different sentences.
--
-- ── Who may change it ─────────────────────────────────────────────────────
--
-- Either housemate, for anyone. Same posture as plan entries, completions and
-- flags: this is a two-person house, not an access-control problem, and "I'll
-- take the bins tonight" is a thing you say about your own turn *or* offer to
-- take off somebody else's.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.chore_turns (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  chore_id uuid not null references public.chores (id) on delete cascade,
  occurrence_key text not null check (char_length(occurrence_key) between 1 and 200),

  /*
   * Whose turn it is instead.
   *
   * `profiles`, never `auth.users`: PostgREST can only embed a FK it can see,
   * and every earlier table that pointed at `auth.users` had to be migrated.
   *
   * `on delete cascade` rather than `set null`: an override naming nobody is
   * not "nobody's turn", it is a row the projector would have to guess about.
   * If the person leaves, the rotation is the honest answer again.
   */
  user_id uuid not null references public.profiles (id) on delete cascade,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  -- One override per occurrence, and the idempotency guarantee a double-tap
  -- needs — the same shape completions use.
  unique (chore_id, occurrence_key)
);

-- The projector reads every override for a household in the window.
create index chore_turns_household_idx on public.chore_turns (household_id);
create index chore_turns_chore_idx on public.chore_turns (chore_id);

alter table public.chore_turns enable row level security;

create policy chore_turns_select on public.chore_turns
  for select to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

create policy chore_turns_insert on public.chore_turns
  for insert to authenticated
  with check (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

create policy chore_turns_update on public.chore_turns
  for update to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id))
  with check (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

/*
 * Delete is how you put the rotation back — "no, it is whoever's turn it
 * was". Household-wide like the rest, and still gated on `chore_is_visible`
 * so a private chore's overrides cannot be reached.
 */
create policy chore_turns_delete on public.chore_turns
  for delete to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

-- Repeated deliberately: the blanket revoke ran in 20260729214817, before this
-- table existed, and grants.test.sql has caught this omission before.
revoke all on public.chore_turns from anon;
grant select, insert, update, delete on public.chore_turns to authenticated;

-- Both phones render whose turn it is; a change on one has to reach the other.
-- `replica identity full` because a DELETE otherwise carries only the primary
-- key, and the client cannot tell which occurrence went back to the rotation.
alter publication supabase_realtime add table public.chore_turns;
alter table public.chore_turns replica identity full;

comment on table public.chore_turns is
  'Whose turn one occurrence is, overriding the rotation. A deviation from the rule, never an edit to it — remove the row and the rotation answers again.';
comment on column public.chore_turns.user_id is
  'Who is taking it this time. Either housemate may set or clear this, for either of them.';
