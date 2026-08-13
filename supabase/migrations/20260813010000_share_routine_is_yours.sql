-- ═══════════════════════════════════════════════════════════════════════════
-- The routine sharing switch belongs to the person it exposes
--
-- `share_routine` was added to `household_members`, a table whose only update
-- policy is `is_household_admin`. Two consequences, both wrong, and neither
-- visible to the tests that existed — both flipped the switch as the household
-- owner, which is the one identity under which the policy looks correct:
--
--   * The owner could set the other member's `share_routine = true` and then
--     read every private routine item and completion they had. One request.
--     The switch the routines migration calls the privacy control was operable
--     by the person it protects against.
--   * A plain member could never turn their own sharing on. The update matched
--     no rows, PostgREST returned no error, and the app reported success.
--
-- The fix is two rules, deliberately expressed as a trigger rather than as
-- column grants. Revoking `update (share_routine)` does not work while a
-- table-wide `grant update` is held — Postgres requires revoking the table
-- privilege and re-granting every other column, which would then need editing
-- on every future column, and forgetting it fails open.
-- ═══════════════════════════════════════════════════════════════════════════

-- Members may update their own membership row. Alone this would let somebody
-- promote themselves to admin, which is why the trigger below is not optional.
create policy household_members_update_self on public.household_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function private.guard_membership_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  -- Yours alone, admin or not. Sharing your routine is a disclosure about you,
  -- so nobody else gets to make it — this is the rule that closes the hole.
  if new.share_routine is distinct from old.share_routine and old.user_id <> me then
    raise exception 'Only you can change whether your routine is shared'
      using errcode = '42501';
  end if;

  -- And the new self-update policy must not become a promotion route.
  if new.role is distinct from old.role and not private.is_household_admin(old.household_id) then
    raise exception 'Only an admin can change roles' using errcode = '42501';
  end if;

  -- Membership is not transferable: rewriting either key would move a row into
  -- a household or onto a person the checks above were evaluated against.
  if new.household_id is distinct from old.household_id or new.user_id is distinct from old.user_id then
    raise exception 'A membership cannot be moved' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_membership_update
  before update on public.household_members
  for each row execute function private.guard_membership_update();

comment on function private.guard_membership_update() is
  'Keeps share_routine in its owner''s hands, and keeps the self-update policy from becoming a promotion route.';
