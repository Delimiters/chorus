-- ═══════════════════════════════════════════════════════════════════════════
-- A shared note board
--
-- Jake: *"Somewhere to kind of write stuff down that's not quite ready to be a
-- task or isn't a task at all but we can check in on."* He chose several notes
-- over one big board.
--
-- A note is the thing a chore is not yet. No due date, no assignee, no
-- rotation, and deliberately **no completion**: the moment a note grows a
-- checkbox it is a chore with worse ergonomics, and two ways to track the same
-- work is how the two come to disagree.
--
-- ── Whose note is it ──────────────────────────────────────────────────────
--
-- The household's. All four verbs are `is_household_member`, so either of you
-- may edit or delete any note. That is the same posture as completions and
-- plan entries, and the opposite of `routine_items`, which are one person's by
-- construction. A note board where you cannot fix your housemate's typo is not
-- a shared note board.
--
-- `created_by` is recorded and never a permission, exactly as `chore_flags`
-- ended up.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.household_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,

  -- Optional, because people paste a sentence and leave. The UI promotes the
  -- first line of the body when there is no title, so a card is never
  -- top-empty — which is a rendering decision, not a reason to force a title.
  title text,
  body text not null default '',

  -- `profiles`, never `auth.users`: PostgREST can only embed a FK it can see,
  -- and every earlier table that pointed at `auth.users` had to be migrated.
  created_by uuid references public.profiles (id) on delete set null,

  -- Who touched it last, and when. Set by the trigger below and never by the
  -- client — the footer ("Emily edited this 2 minutes ago") is the only
  -- protection against a silent last-write-wins overwrite, so the one field it
  -- rests on must not be client-writable.
  updated_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Length caps, because a text column with no bound is a denial-of-service
  -- surface on a table both phones subscribe to over realtime.
  constraint household_notes_title_len check (title is null or length(title) <= 120),
  constraint household_notes_body_len check (length(body) <= 20000)
);

-- The list reads by household, newest edit first, which is the only access
-- path either screen has.
create index household_notes_household_updated_idx
  on public.household_notes (household_id, updated_at desc);

create or replace function private.stamp_note_editor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());

  /*
   * Authorship is not editable. The update policy is household-wide by
   * design, and a `with check` cannot see OLD, so "you may edit this note"
   * would otherwise include "you may claim you wrote it". Pinned here instead,
   * where OLD exists.
   */
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.household_id := old.household_id;
  end if;

  return new;
end;
$$;

revoke all on function private.stamp_note_editor() from public;

create trigger household_notes_stamp_editor
  before insert or update on public.household_notes
  for each row execute function private.stamp_note_editor();

alter table public.household_notes enable row level security;

create policy household_notes_select on public.household_notes
  for select to authenticated
  using (private.is_household_member(household_id));

create policy household_notes_insert on public.household_notes
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

create policy household_notes_update on public.household_notes
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

create policy household_notes_delete on public.household_notes
  for delete to authenticated
  using (private.is_household_member(household_id));

-- Repeated deliberately: the blanket revoke ran in 20260729214817, before this
-- table existed, and grants.test.sql has caught this omission before.
revoke all on public.household_notes from anon;
grant select, insert, update, delete on public.household_notes to authenticated;

-- Both phones render the same board; an edit on one has to reach the other.
-- `replica identity full` because a DELETE otherwise carries only the primary
-- key and the client cannot tell which household it belonged to.
alter publication supabase_realtime add table public.household_notes;
alter table public.household_notes replica identity full;

comment on table public.household_notes is
  'A shared scratch note. The household''s, not the author''s: either member may edit or delete any note.';
comment on column public.household_notes.created_by is
  'Who wrote it first. Recorded, not a permission.';
comment on column public.household_notes.updated_by is
  'Who touched it last. Set by trigger, never by the client — the "edited by" footer is what makes last-write-wins visible.';
