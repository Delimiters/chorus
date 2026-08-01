-- Let a member change an exception they already made.
--
-- Rescheduling an occurrence was completely broken: `rescheduleOccurrence`
-- upserts on `(chore_id, occurrence_key)` so that moving a chore twice replaces
-- the first move rather than colliding with it — and an upsert compiles to
-- `INSERT ... ON CONFLICT DO UPDATE`, which Postgres refuses without the UPDATE
-- privilege. `authenticated` had SELECT, INSERT and DELETE but not UPDATE, so
-- every reschedule returned 403 and the row silently never moved.
--
-- Found by driving the app, not by a test. The integration suite covers skip
-- and complete, which are plain inserts, and never exercised the one write in
-- the app that is an upsert.
--
-- Both halves are needed. A GRANT without a policy is still denied by RLS, and
-- a policy without the GRANT is denied before RLS is ever consulted — which is
-- the error we actually got, and why the message named privileges rather than
-- a policy.

grant update on public.chore_exceptions to authenticated;

-- Either housemate may move a chore, including one the other person moved:
-- there is one shared list and no notion of an exception belonging to the
-- person who happened to create it.
--
-- `using` decides which rows may be updated; `with check` decides what they may
-- become. Both are needed — without the second, a member of household A could
-- update one of their own rows to point at household B.
create policy exceptions_update on public.chore_exceptions
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (
    private.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

comment on policy exceptions_update on public.chore_exceptions is
  'Re-rescheduling replaces the previous exception via upsert, which needs UPDATE.';
