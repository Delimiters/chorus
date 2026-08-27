-- ═══════════════════════════════════════════════════════════════════════════
-- The flag: "this one, this week"
--
-- Emily's notes are full of ‼️, and some things carry four of them. That is
-- not a scale she is picking from — it is shouting louder, about this week, in
-- a way that will not be true next week. `priority` cannot model it: it is a
-- permanent property of the chore, shared by the household, with three values.
-- Twenty-eight of ninety-nine chores are marked `crucial`, which is what
-- happens when a permanent field is used to say something temporary.
--
-- So the flag is deliberately the opposite of priority in all three respects:
-- **per person**, because "I need to deal with this" is a fact about you and
-- not about the chore; **binary**, because the thing being expressed is
-- attention rather than rank; and **transient**, because attention is.
--
-- ── It expires rather than being cleared ──────────────────────────────────
--
-- No cron, no nightly job, no `is_active` column to keep true. The row stores
-- the date the flag was raised, and the client treats it as live only while
-- `flagged_on` falls inside the current week — which the app already computes,
-- week-start-aware, for every other weekly question it answers.
--
-- That means a flag from three weeks ago is *inert* rather than deleted: it
-- costs one row, it cannot silt up the list, and re-flagging is an upsert
-- rather than a resurrection. A scheduled job that clears flags would be a
-- second source of truth about what "this week" means, and it would drift from
-- the household's `week_starts_on` the first time somebody changed it.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.chore_flags (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  chore_id     uuid not null references public.chores (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- The civil date it was raised, in the household's zone. `date` rather than
  -- `timestamptz` for the same reason due dates are: "which week is this in"
  -- is a calendar question, and an instant would answer it differently either
  -- side of midnight depending on where you were standing.
  flagged_on   date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One per person per chore. Flagging again moves the date rather than
  -- stacking rows, which is what makes re-flagging idempotent and therefore
  -- safe to do optimistically.
  unique (chore_id, user_id)
);

comment on table public.chore_flags is
  'A person marked a chore for attention on a date. Live only while that date is inside the current week; never cleared, only outrun.';

create index chore_flags_household_idx on public.chore_flags (household_id);
create index chore_flags_user_idx on public.chore_flags (user_id);
create index chore_flags_chore_idx on public.chore_flags (chore_id);

create trigger chore_flags_touch before update on public.chore_flags
  for each row execute function private.touch_updated_at();

alter table public.chore_flags enable row level security;

/*
 * Both of you can see both flags, and only you can set yours.
 *
 * Seeing that your housemate has flagged the car inspection is the whole
 * social value of the thing — it is how "this is worrying me" gets said
 * without a conversation. But writing to it is owner-only, like routine items
 * and unlike completions: a completion is a fact about the household that
 * either person may record, whereas a flag is a statement about what somebody
 * else is worrying about, and nobody else gets to make it for them.
 *
 * `chore_is_visible` so a flag cannot leak the existence of a private chore.
 */
create policy chore_flags_select on public.chore_flags
  for select to authenticated
  using (private.is_household_member(household_id) and private.chore_is_visible(chore_id));

create policy chore_flags_insert on public.chore_flags
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
  );

create policy chore_flags_update on public.chore_flags
  for update to authenticated
  using (user_id = (select auth.uid()) and private.is_household_member(household_id))
  with check (user_id = (select auth.uid()) and private.is_household_member(household_id));

create policy chore_flags_delete on public.chore_flags
  for delete to authenticated
  using (user_id = (select auth.uid()) and private.is_household_member(household_id));

-- The blanket revoke ran in migration 1 and does not reach tables created
-- afterwards. grants.test.sql has caught this omission before.
revoke all on public.chore_flags from anon;
grant select, insert, update, delete on public.chore_flags to authenticated;

-- Realtime, so a flag raised on one phone appears on the other. Replica
-- identity full because the delete payload needs more than the primary key to
-- be matched against a cached list.
alter table public.chore_flags replica identity full;
alter publication supabase_realtime add table public.chore_flags;
