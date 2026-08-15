-- ═══════════════════════════════════════════════════════════════════════════
-- A chore only its owner can see
--
-- For "get flowers for the anniversary": a real household task, on the real
-- list, that the other person must not read. A shared list with no private
-- corner forces those tasks out of the app entirely, which is how a list stops
-- being trusted.
--
-- One nullable column. Null is the normal case — shared with the household,
-- exactly as every existing row already is — and a uuid means "this belongs to
-- that person alone". Nullable rather than a boolean plus an owner, because a
-- boolean would need `created_by` to be non-null and trustworthy, and it is
-- neither: it has always been nullable and nothing enforces it.
--
-- The visibility rule has to be repeated on three tables, not one. A chore is
-- only half the secret: its completions and its exceptions are household-
-- scoped rows carrying its id, so leaving those policies alone would let the
-- other person watch a chore they cannot name being ticked off — and would
-- quietly inflate their side of the stats screen.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.chores
  add column private_to uuid references public.profiles (id) on delete cascade;

comment on column public.chores.private_to is
  'Null means the whole household sees it. A user id means only that person does — including its completions and exceptions.';

-- Every policy below filters on it, so it earns an index; partial, because the
-- overwhelming majority of rows are null and never match.
create index chores_private_to_idx on public.chores (private_to)
  where private_to is not null;

/*
 * Is this chore mine to see?
 *
 * SECURITY DEFINER, and that is the point: it is called from policies on
 * `chore_completions` and `chore_exceptions`, and a policy expression is an
 * ordinary query, so `chores`' own RLS would apply inside it. Without definer
 * the check would consult a filtered view of `chores`, find nothing for a
 * private row, and deny the owner access to their own completions.
 *
 * `stable` so the planner may cache it within a statement, and `search_path`
 * pinned because an unpinned definer function is a privilege-escalation route.
 */
create or replace function private.chore_is_visible(chore uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chores c
    where c.id = chore
      and private.is_household_member(c.household_id)
      and (c.private_to is null or c.private_to = (select auth.uid()))
  );
$$;

revoke all on function private.chore_is_visible(uuid) from public;
grant execute on function private.chore_is_visible(uuid) to authenticated;

-- ── The three policies ─────────────────────────────────────────────────────

drop policy chores_select on public.chores;
create policy chores_select on public.chores
  for select to authenticated
  using (
    private.is_household_member(household_id)
    and (private_to is null or private_to = (select auth.uid()))
  );

drop policy completions_select on public.chore_completions;
create policy completions_select on public.chore_completions
  for select to authenticated
  using (
    private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
  );

drop policy exceptions_select on public.chore_exceptions;
create policy exceptions_select on public.chore_exceptions
  for select to authenticated
  using (
    private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
  );

/*
 * Writes are left alone on purpose.
 *
 * Insert and update on `chores` still only require household membership, which
 * means either person may in principle write a row marked private to the
 * other. That is not a hole worth a policy: they cannot read it back, cannot
 * discover its id to target it, and the app never offers it. Adding a check
 * here would be a second rule to keep in step with the first for no gain.
 *
 * Completions are already narrowed by `completed_by = auth.uid()`, so nobody
 * can forge a tick against somebody else's private chore even by guessing.
 */
