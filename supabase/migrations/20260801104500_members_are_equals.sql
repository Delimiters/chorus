-- Let any member invite someone and change the household's settings.
--
-- The schema had three roles and gated invites and settings behind
-- owner-or-admin, but nothing in the app ever promotes anybody — so whoever
-- happened to create the household was permanently the only person who could
-- invite a third person or change when weeks start. The second member's taps
-- did nothing, and said nothing: a PostgREST update matching zero rows returns
-- 204, so the setting silently snapped back.
--
-- That hierarchy is wrong for what this app is. Two people sharing a flat are
-- equals; the founder is whoever happened to tap first. A shared chore list
-- where one person cannot invite the third housemate is not shared.
--
-- Destructive operations stay privileged. Deleting the household, and removing
-- somebody other than yourself, remain owner/admin — those are not symmetric
-- and a bad afternoon should not be able to erase a year of history.

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated
  using (private.is_household_member(id))
  with check (private.is_household_member(id));

comment on policy households_update on public.households is
  'Any member may change household settings. Deleting it is still owner-only.';

drop policy if exists invites_insert on public.household_invites;
create policy invites_insert on public.household_invites
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

comment on policy invites_insert on public.household_invites is
  'Any member may invite. A household of two where only one can invite a third is not shared.';
