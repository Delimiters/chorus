-- ═══════════════════════════════════════════════════════════════════════════
-- Which kind of work leads your day
--
-- The plan splits into recurring chores and one-time tasks. Jake wants the
-- chores first; Emily wants the tasks first. Both are right about their own
-- day, so this is a preference rather than a decision to make once:
--
--   "Emily wants one time tasks first and I want chores first so I think we
--    just need to make it something you can flip if you want."
--
-- ── On the profile, and not in AsyncStorage ────────────────────────────────
--
-- Every other view preference in this app (`arrangement`, `compactRows`) is a
-- device preference in `viewStore`. This one is not, for two reasons.
--
-- It belongs to the *person*: Jake and Emily each want a different answer, and
-- an account is what distinguishes them. A device preference happens to work
-- only because they hold one phone each.
--
-- And a device preference would not survive. The app is signed with a free
-- Apple team, whose provisioning profiles expire every seven days, so it is
-- rebuilt and reinstalled constantly — and an install that ever went through a
-- delete would take the whole AsyncStorage container with it. A column outlives
-- that. See docs/RELEASE.md.
--
-- `profiles` rather than `household_members` because it is not a fact about a
-- household. `accent` moved the other way in 20260730154751 precisely because
-- it *was* — two people in one house cannot share an ink, and that constraint
-- has no analogue here.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column plan_group_order text not null default 'chores';

-- The set is closed and small. A CHECK rather than an enum, matching `accent`
-- and `ink` — an enum needs its own migration to grow, and the app already
-- reads these as strings.
alter table public.profiles
  add constraint profiles_plan_group_order_valid
  check (plan_group_order in ('chores', 'oneOff'));

comment on column public.profiles.plan_group_order is
  'Which group leads the daily plan: recurring chores, or one-time tasks.';

/*
 * No new policy.
 *
 * `profiles_select` already covers reading it — yourself, plus anyone sharing a
 * household — and `profiles_update` is `id = auth.uid()` with the same WITH
 * CHECK, so a person may change their own and nobody else's. Both are
 * column-agnostic, which is the whole reason this lands as a column rather than
 * a table.
 *
 * Worth stating because the reverse would be easy to assume: this does *not*
 * let a housemate reorder your day. Reading Emily's preference is permitted and
 * writing it is not.
 */

/*
 * A one-off backfill for the two accounts that exist.
 *
 * Jake needs nothing — 'chores' is the default and the order the app already
 * shipped, so every existing row is already right for him and for anyone who
 * has never expressed a view. Emily asked for the opposite, and asking her to
 * find and tap a control to get back to what she had just said she wanted is a
 * poor first impression of the feature.
 *
 * Matched on the id rather than the display name, which is editable. Anywhere
 * else this row does not exist the statement is a no-op, so a fresh database —
 * `supabase db reset`, and CI does this on every run — applies it harmlessly.
 */
update public.profiles
set plan_group_order = 'oneOff'
where id = '332316eb-a160-43d7-b0b4-f6703edd8652';
