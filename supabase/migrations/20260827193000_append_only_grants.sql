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
-- ── What this is not ──────────────────────────────────────────────────────
--
-- Not a privilege escalation across households: RLS still applies, so a member
-- could only ever have edited rows they can already see. The damage is to
-- integrity rather than to isolation — but "Alice can rewrite the record of who
-- did the washing up, silently" is exactly what an append-only log exists to
-- prevent, and the app has no way to notice it happening.
-- ═══════════════════════════════════════════════════════════════════════════

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
