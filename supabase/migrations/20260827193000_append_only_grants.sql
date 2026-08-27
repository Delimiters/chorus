-- ═══════════════════════════════════════════════════════════════════════════
-- The append-only tables are only append-only by accident
--
-- `chore_completions`, `routine_completions` and `chore_subtask_ticks` are an
-- event log. A completion is inserted or deleted, never edited: rewriting when
-- something was done, or by whom, would corrupt the household's history in a
-- way nothing else in the app could detect. `rls.test.ts` has asserted that an
-- UPDATE is refused since the completions table existed.
--
-- It was refused for a reason nobody wrote down. Postgres hands `authenticated`
-- a default ACL of `arwdDxtm` — UPDATE, TRUNCATE, REFERENCES and TRIGGER
-- included — on every new table created by `postgres`. Those migrations revoked
-- from `anon` and then *granted* to `authenticated`, and GRANT is additive: it
-- adds SELECT/INSERT/DELETE without removing the UPDATE that was already
-- there. The guarantee held only where the base image happened not to install
-- that default ACL.
--
-- Which is no longer everywhere. On the Supabase image CI now pulls, all three
-- tables are updatable by any authenticated user, and the pgTAP assertion added
-- alongside this migration names all three. A local database built from an
-- older image shows the opposite, which is why this went unnoticed: the machine
-- it was checked on was the machine where it happened to be true.
--
-- So: revoke everything and grant back exactly what each table needs. Explicit
-- rather than inherited, and therefore the same on every image.
--
-- ── What this is and is not, corrected ───────────────────────────────────
--
-- The first version of this comment claimed the three tables were "updatable by
-- any authenticated user" and that "Alice can rewrite the record of who did the
-- washing up, silently". **That was wrong, and a review caught it.**
--
-- None of these tables has an UPDATE policy, and RLS is default-deny — so an
-- UPDATE from `authenticated` matches zero rows and changes nothing even with
-- the grant present. Verified: with the grant restored by hand, the statement
-- returns `UPDATE 0` and no error. The history was never actually writable.
--
-- What the missing revoke really cost is narrower and worth stating plainly:
-- the grant is checked *before* any policy, so its presence turns a refusal
-- (42501) into a silent no-op. `rls.test.ts` asserts the refusal, which is how
-- this surfaced — as a red CI job on an image carrying the default ACL, not as
-- corrupted data.
--
-- The migration is still right: an append-only table should refuse an UPDATE
-- rather than accept and ignore it, and relying on "there happens to be no
-- policy" is one policy away from being untrue. But it is defence in depth, not
-- a breach being closed, and the next person reading this should not be told
-- otherwise.

revoke all on public.chore_completions from authenticated;
grant select, insert, delete on public.chore_completions to authenticated;

revoke all on public.routine_completions from authenticated;
grant select, insert, delete on public.routine_completions to authenticated;

revoke all on public.chore_subtask_ticks from authenticated;
grant select, insert, delete on public.chore_subtask_ticks to authenticated;

-- The same defaults reach `anon`, and migration 1's blanket revoke ran before
-- most of these tables existed. Cheap to repeat and it costs nothing if it is
-- already true.
revoke all on public.chore_completions from anon;
revoke all on public.routine_completions from anon;
revoke all on public.chore_subtask_ticks from anon;
