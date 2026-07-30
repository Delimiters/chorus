-- ═══════════════════════════════════════════════════════════════════════════
-- Point user references at public.profiles instead of auth.users
--
-- Why: PostgREST can only embed a related table across a foreign key it can see,
-- and `auth` is not an exposed schema. So this, which is the obvious way to read
-- a member list with names attached —
--
--   .from('household_members').select('user_id, role, profiles!inner(display_name)')
--
-- — fails with PGRST200 "Could not find a relationship between
-- 'household_members' and 'profiles'", because the only foreign key on `user_id`
-- points into `auth.users`.
--
-- Found by running the app: the member list on Today came back empty with a 400.
--
-- The fix is to reference `public.profiles`, which is the API-visible identity for
-- a user. Cascade behaviour is unchanged, because `profiles.id` itself references
-- `auth.users(id) on delete cascade` — so deleting an auth user still deletes the
-- profile, which now still deletes the memberships. The chain is one hop longer
-- and identical in effect.
--
-- Applied to every user-referencing column rather than only the one that failed,
-- because `chore_completions.completed_by` needs exactly the same embed to render
-- "completed by Sam" in the next phase, and finding this twice would be silly.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── household_members ──────────────────────────────────────────────────────
alter table public.household_members
  drop constraint household_members_user_id_fkey;

alter table public.household_members
  add constraint household_members_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ── households ─────────────────────────────────────────────────────────────
alter table public.households
  drop constraint households_created_by_fkey;

alter table public.households
  add constraint households_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete cascade;

-- ── chores ─────────────────────────────────────────────────────────────────
alter table public.chores
  drop constraint chores_created_by_fkey;

alter table public.chores
  add constraint chores_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete cascade;

-- ── chore_completions ──────────────────────────────────────────────────────
-- The one the history view will need: "who did this".
alter table public.chore_completions
  drop constraint chore_completions_completed_by_fkey;

alter table public.chore_completions
  add constraint chore_completions_completed_by_fkey
  foreign key (completed_by) references public.profiles (id) on delete cascade;

-- ── chore_exceptions ───────────────────────────────────────────────────────
alter table public.chore_exceptions
  drop constraint chore_exceptions_created_by_fkey;

alter table public.chore_exceptions
  add constraint chore_exceptions_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete cascade;

-- ── household_invites ──────────────────────────────────────────────────────
alter table public.household_invites
  drop constraint household_invites_created_by_fkey;

alter table public.household_invites
  add constraint household_invites_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete cascade;

alter table public.household_invites
  drop constraint household_invites_redeemed_by_fkey;

alter table public.household_invites
  add constraint household_invites_redeemed_by_fkey
  foreign key (redeemed_by) references public.profiles (id) on delete set null;

-- ── push_tokens ────────────────────────────────────────────────────────────
alter table public.push_tokens
  drop constraint push_tokens_user_id_fkey;

alter table public.push_tokens
  add constraint push_tokens_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- Note: `profiles.id -> auth.users(id) on delete cascade` is deliberately left
-- alone. That is the single anchor between Supabase's auth schema and ours, and
-- it is the reason every cascade above still reaches an auth user deletion.

-- Foreign keys are checked on write, so the referencing columns want indexes to
-- keep the constraint checks and the embeds cheap. Most already have one via a
-- unique constraint or an existing index; these are the ones that did not.
create index if not exists chores_created_by_idx on public.chores (created_by);
create index if not exists exceptions_created_by_idx on public.chore_exceptions (created_by);
create index if not exists invites_created_by_idx on public.household_invites (created_by);
