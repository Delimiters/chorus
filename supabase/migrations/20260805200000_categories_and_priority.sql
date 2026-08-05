-- ═══════════════════════════════════════════════════════════════════════════
-- Categories and priority
--
-- Two independent axes, deliberately not one. A chore can be a kitchen chore
-- *and* crucial, so collapsing them into a single ordered list would force
-- every such chore to pick a side. Category answers "what kind of thing is
-- this", priority answers "how much does it matter".
--
-- Neither reaches the engine. src/core computes *when* a chore is due and
-- *who* does it; how the result is grouped and sorted on screen is
-- presentation, so the expander, the projector and the rotation are untouched
-- by this migration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── chore_categories ───────────────────────────────────────────────────────
-- Household-scoped and user-defined. `position` is a dense integer rewritten
-- wholesale on reorder: a household has a handful of categories, so the
-- fractional-index machinery that makes reordering cheap at scale would be
-- pure overhead here.
create table public.chore_categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 40),

  -- A hex colour, or null to fall back to the theme's neutral. Stored as hex
  -- rather than a design-token name because tokens are renameable and this
  -- data outlives any given version of the design system.
  color        text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),

  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Two categories called "Kitchen" in one household is a mistake every time,
  -- and case-insensitively so.
  constraint chore_categories_name_unique unique (household_id, name)
);

comment on table public.chore_categories is
  'User-defined grouping for chores. Ordering is by `position`, ascending. '
  'A null chores.category_id means the "Other" group, which is not a row here.';

-- Names are free text on purpose. A fixed list would be wrong for every
-- household that keeps chores this one does not.
--
-- Deliberately no `icon` column yet. It is a planned addition — pick from a
-- set of icons per category — but adding the column before anything writes to
-- it is schema for a feature that does not exist. It is one nullable column
-- when the time comes.

create index chore_categories_household_idx
  on public.chore_categories (household_id, position);

create trigger chore_categories_touch before update on public.chore_categories
  for each row execute function private.touch_updated_at();

-- ── chores gains both axes ─────────────────────────────────────────────────
-- Nullable, and null is not an error state — it *is* the "Other" category.
--
-- "Other" is deliberately not a real row. Making it one would mean seeding it
-- into every household including the ones that already exist, keeping it
-- undeletable and unrenameable so it cannot vanish out from under a chore, and
-- giving it a position it should never actually be reordered away from. All of
-- that to represent the absence of a choice.
--
-- As a null it costs nothing: every existing chore is already in Other, a new
-- chore needs no category, and the UI pins the Other section last. The one
-- thing it gives up is renaming Other, which is not worth a backfill.
--
-- `on delete set null`, never cascade — deleting a category must not delete
-- the chores in it, let alone the completion history hanging off them. Those
-- chores fall back into Other, which is exactly the desired behaviour.
alter table public.chores
  add column category_id uuid references public.chore_categories (id) on delete set null;

-- Three levels, defaulting to 'normal' so every existing chore is already
-- valid and nobody has to triage a backlog. Three is what people use
-- consistently; with five the middle levels blur into each other.
alter table public.chores
  add column priority text not null default 'normal'
  check (priority in ('crucial', 'normal', 'minor'));

comment on column public.chores.priority is
  'crucial | normal | minor. Ordering lives in src/core/chore/priority.ts.';

-- Partial, matching chores_household_live_idx: the grouped views only ever ask
-- about chores that are not archived.
create index chores_household_category_idx
  on public.chores (household_id, category_id)
  where archived_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Row level security
--
-- Every policy names its role with TO. A policy without one applies to
-- `public`, which includes `anon` — a pgTAP test caught exactly that omission
-- on an earlier migration, so it is stated rather than assumed here.
--
-- Categories follow the household_members rule established in
-- 20260801104500: members are equals, so any member may add, rename, reorder
-- or remove a category. There is no admin tier for this.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.chore_categories enable row level security;

create policy chore_categories_select on public.chore_categories
  for select to authenticated
  using (private.is_household_member(household_id));

create policy chore_categories_insert on public.chore_categories
  for insert to authenticated
  with check (private.is_household_member(household_id));

create policy chore_categories_update on public.chore_categories
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy chore_categories_delete on public.chore_categories
  for delete to authenticated
  using (private.is_household_member(household_id));

-- Supabase's default privileges hand `anon` TRUNCATE, REFERENCES and TRIGGER
-- on every newly created table in `public`. The core schema revokes them, but
-- it did so in 20260729214817 — before this table existed — so the revoke has
-- to be repeated here. Any future migration adding a table must do the same.
--
-- Not hypothetical: supabase/tests/grants.test.sql failed on exactly these
-- three privileges when this migration first ran, which is what that test is
-- for. RLS would not have saved us; TRUNCATE ignores it entirely.
revoke all on public.chore_categories from anon;

grant select, insert, update, delete on public.chore_categories to authenticated;
