-- ═══════════════════════════════════════════════════════════════════════════
-- Routines
--
-- Personal daily routines, alongside household chores rather than inside them.
--
-- The tempting shortcut was `kind = 'routine'` on public.chores, reusing the
-- projector, chore_completions and every screen. It was rejected deliberately:
-- chores RLS is `is_household_member` on all four verbs, so privacy would mean
-- rewriting the policy every existing screen depends on, and routine rows would
-- surface in listChores, useOccurrences, the stats screen and the Chores tab —
-- each one forgotten `.eq()` away from showing somebody's private list to their
-- housemate.
--
-- What IS shared is the bottom of the stack: `schedule` is the same jsonb shape
-- validated by the same Zod schema, and the recurrence engine expands a routine
-- id exactly as it expands a chore id. Sharing happens at the engine, not at
-- the table.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Sharing is one switch per person, per household ────────────────────────
-- Not per item. Two people in a flat either keep their routines to themselves
-- or they do not; a per-item flag is a decision to make forty times instead of
-- once. A per-item column can be added later without touching this one.
alter table public.household_members
  add column share_routine boolean not null default false;

comment on column public.household_members.share_routine is
  'When true, this member''s routine items are visible to the rest of the household (read-only).';

-- ── routine_items ─────────────────────────────────────────────────────────
create table public.routine_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- profiles, not auth.users: PostgREST cannot embed across the auth schema,
  -- which is what 20260730045436 exists to fix. Cascade, because a routine item
  -- belongs to exactly one person and means nothing without them.
  user_id       uuid not null references public.profiles (id) on delete cascade,

  title         text not null check (char_length(trim(title)) between 1 and 120),
  notes         text check (notes is null or char_length(notes) <= 2000),
  icon          text check (icon is null or char_length(icon) between 1 and 60),

  -- The same Schedule shape as chores, validated by the same Zod schema on read
  -- and write. The generated columns mirror chores for the same reason: a
  -- generated expression must be IMMUTABLE, and 'YYYY-MM-DD' compares
  -- lexicographically exactly as it compares chronologically.
  schedule      jsonb not null,
  schedule_kind text generated always as (schedule -> 'rule' ->> 'kind') stored,
  starts_on     text generated always as (
                  case
                    when (schedule -> 'rule' ->> 'kind') = 'once'
                      then schedule -> 'rule' ->> 'dueOn'
                    else schedule ->> 'startsOn'
                  end
                ) stored,
  ends_on       text generated always as (nullif(schedule ->> 'endsOn', 'null')) stored,

  /*
   * A specific time, or a bucket — never both, never neither.
   *
   * `text` rather than `time`, matching the civil-date columns: `time` round
   * trips as '21:00:00' and would need trimming on every read to become a
   * CivilTime, and text keeps the generated expression below immutable.
   */
  time_of_day   text check (time_of_day is null or time_of_day ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  bucket_choice text check (bucket_choice is null
                            or bucket_choice in ('morning', 'afternoon', 'evening', 'night')),
  constraint routine_bucket_source check ((time_of_day is null) <> (bucket_choice is null)),

  /*
   * Which part of the day the item sits in, decided here rather than by the
   * client.
   *
   * A specific time files the item automatically, and if that rule lived only
   * in TypeScript two clients could disagree about where 17:00 belongs. The
   * boundaries match src/core/routines/buckets.ts, and an integration test
   * compares the two across every boundary so they cannot drift.
   */
  bucket        text generated always as (
                  case
                    when time_of_day is null then bucket_choice
                    when time_of_day >= '05:00' and time_of_day < '12:00' then 'morning'
                    when time_of_day >= '12:00' and time_of_day < '17:00' then 'afternoon'
                    when time_of_day >= '17:00' and time_of_day < '21:00' then 'evening'
                    else 'night'
                  end
                ) stored,

  -- Off by default per item. On, the reminder time is the item's own time, or
  -- the start of its bucket.
  remind        boolean not null default false,

  linked_chore_id uuid,

  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint routine_items_schedule_shape check (
    schedule ? 'rule'
    and schedule ? 'startsOn'
    and (schedule -> 'rule' ->> 'kind') in (
      'unscheduled', 'once', 'daily', 'weekly', 'weeklyFloating',
      'monthlyByDay', 'monthlyByWeekday', 'monthlyFloating'
    )
  )
);

comment on table public.routine_items is
  'Personal routine items. Private unless the owner''s household_members.share_routine is true.';

/*
 * The chore link cannot point outside its own household.
 *
 * A plain `references chores (id)` would let a routine item in house A tick a
 * chore in house B — RLS would block the write, but only at the moment of the
 * tick, and the row would have been storable. A composite key makes it
 * unrepresentable instead.
 *
 * The column list on SET NULL is required because household_id is NOT NULL:
 * only the link is cleared. Postgres 15+; this project runs 17.
 */
alter table public.chores
  add constraint chores_id_household_key unique (id, household_id);

alter table public.routine_items
  add constraint routine_items_linked_chore_fkey
  foreign key (linked_chore_id, household_id)
  references public.chores (id, household_id)
  on delete set null (linked_chore_id);

/*
 * One routine item per chore, per person.
 *
 * Two items pointing at the same chore would both tick it, and unticking one
 * would silently untick the other's work.
 */
create unique index routine_items_linked_chore_uniq
  on public.routine_items (user_id, linked_chore_id)
  where linked_chore_id is not null;

create index routine_items_user_live_idx
  on public.routine_items (user_id) where archived_at is null;
create index routine_items_shared_idx
  on public.routine_items (household_id) where archived_at is null;
create index routine_items_linked_chore_idx
  on public.routine_items (household_id, linked_chore_id) where linked_chore_id is not null;

create trigger routine_items_touch before update on public.routine_items
  for each row execute function private.touch_updated_at();

-- ── routine_completions ───────────────────────────────────────────────────
-- Append-only, like chore_completions, and idempotent for the same reason: the
-- occurrence key is computed on the client with no round trip, which is what
-- makes optimistic ticking safe.
--
-- No completed_by_name snapshot. A routine item has exactly one owner, and when
-- they delete their account the item and its completions cascade away with
-- them — there is nobody left to attribute anything to.
create table public.routine_completions (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  routine_item_id uuid not null references public.routine_items (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  occurrence_key  text not null check (char_length(occurrence_key) between 1 and 200),
  due_on          date not null,
  completed_on    date not null,
  completed_at    timestamptz not null default now(),

  unique (routine_item_id, occurrence_key)
);

create index routine_completions_item_due_idx
  on public.routine_completions (routine_item_id, due_on);
create index routine_completions_household_done_idx
  on public.routine_completions (household_id, completed_on desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row level security
--
-- The asymmetry with chores IS the feature. For a chore, either housemate may
-- complete or un-complete: a two-person household is a trust relationship. For
-- a routine, only the owner writes. "Read-only for others" is enforced here,
-- not by a disabled checkbox that a modified client could ignore.
-- ═══════════════════════════════════════════════════════════════════════════

/*
 * Helpers, in `private` for the reasons the existing ones are.
 *
 * `routine_completions` policies must ask about the parent item, and a policy
 * expression is an ordinary query — so a plain subquery on routine_items would
 * evaluate that table's own RLS inside this one, nesting two household lookups
 * into a rule nobody can reason about. A SECURITY DEFINER helper is the
 * established break, and keeps these functions out of the API-exposed schema
 * where grants.test.sql would (rightly) object.
 */
create or replace function private.routine_is_mine(item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.routine_items ri
    where ri.id = item and ri.user_id = (select auth.uid())
  );
$$;

create or replace function private.routine_is_visible(item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.routine_items ri
    join public.household_members hm
      on hm.household_id = ri.household_id and hm.user_id = ri.user_id
    where ri.id = item
      and (
        ri.user_id = (select auth.uid())
        or (hm.share_routine and private.is_household_member(ri.household_id))
      )
  );
$$;

revoke all on function private.routine_is_mine(uuid) from public;
revoke all on function private.routine_is_visible(uuid) from public;
grant execute on function private.routine_is_mine(uuid) to authenticated;
grant execute on function private.routine_is_visible(uuid) to authenticated;

alter table public.routine_items enable row level security;
alter table public.routine_completions enable row level security;

-- Yours always; somebody else's only when they have switched sharing on and you
-- are in their household.
create policy routine_items_select on public.routine_items
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      private.is_household_member(household_id)
      and exists (
        select 1 from public.household_members hm
        where hm.household_id = routine_items.household_id
          and hm.user_id = routine_items.user_id
          and hm.share_routine
      )
    )
  );

create policy routine_items_insert on public.routine_items
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_household_member(household_id)
  );

create policy routine_items_update on public.routine_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_household_member(household_id));

create policy routine_items_delete on public.routine_items
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy routine_completions_select on public.routine_completions
  for select to authenticated
  using (private.routine_is_visible(routine_item_id));

create policy routine_completions_insert on public.routine_completions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.routine_is_mine(routine_item_id)
  );

create policy routine_completions_delete on public.routine_completions
  for delete to authenticated
  using (private.routine_is_mine(routine_item_id));

-- Supabase's default privileges hand `anon` TRUNCATE, REFERENCES and TRIGGER on
-- every new table in `public`. The blanket revoke ran in 20260729214817, before
-- these tables existed, so it has to be repeated — grants.test.sql has already
-- caught this omission once, for chore_categories.
revoke all on public.routine_items from anon;
revoke all on public.routine_completions from anon;

grant select, insert, update, delete on public.routine_items to authenticated;
-- No UPDATE: a completion is an event, not a record to edit.
grant select, insert, delete on public.routine_completions to authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Both, unlike chore_categories, which was deliberately left out. A shared
-- routine's state is exactly what the other phone is rendering, so a tick has
-- to reach it. `replica identity full` because a DELETE otherwise carries only
-- the primary key, and both the client's cache patch and the channel's
-- household_id filter need more than that.
alter publication supabase_realtime add table public.routine_items;
alter publication supabase_realtime add table public.routine_completions;
alter table public.routine_items replica identity full;
alter table public.routine_completions replica identity full;
