/*
 * Either housemate may edit either plan.
 *
 * `plan_entries` shipped with a household-wide SELECT and owner-only writes, and
 * that asymmetry was argued for at the time: "read-only for others is enforced
 * in the database, not by a disabled checkbox." Jake asked for the opposite —
 * *"I want to see both of our plans fully editable by each other"* — and for a
 * two-person household that trusts each other, the guard was protecting nothing
 * that needed protecting while making the ordinary case impossible: she is out,
 * he takes something off her day.
 *
 * See docs/DECISIONS.md. If this app ever has households that are not couples,
 * this policy is the first thing to revisit: a flatshare of five is a different
 * trust model, and nothing else in the schema encodes that difference.
 *
 * ── What stays ────────────────────────────────────────────────────────────
 *
 * `is_household_member` and `chore_is_visible` both remain on every policy. The
 * second is the one that matters and is easy to drop by accident: without it, a
 * plan entry can leak the existence — and the timing — of a chore the writer is
 * not allowed to see. Widening *who* may write must not widen *what* they may
 * write about.
 *
 * `user_id` is still whose day the row is on, and must still be somebody in the
 * house. It is no longer who may *change* it.
 */

/*
 * Whose day a row is on has to be somebody in the house.
 *
 * The owner-only policy enforced this incidentally: `user_id = auth.uid()` and
 * a membership test together meant the row's owner was a member. Widening the
 * writer without replacing that guarantee left `user_id` constrained only by
 * its foreign key — which points at `profiles`, i.e. every user of the app.
 *
 * A review demonstrated both consequences against a live database: a row
 * planted on a stranger inside your household, and — for a writer who belongs
 * to two households — somebody else's row *moved* into a household its owner
 * is not in, which vanishes from both and is a deletion wearing a disguise.
 *
 * `security definer` for the same reason the other helpers are: the check has
 * to see `household_members` rows the caller cannot select.
 */
create or replace function private.is_household_member_of(hid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
   * Only answers about a household the caller is in.
   *
   * Every other helper here is implicitly about `auth.uid()`; this one takes an
   * arbitrary user, so without the first clause it answers "is X a member of
   * Y?" for any pair a caller can name — a membership oracle. Not reachable
   * today (PostgREST exposes only `public`, and `anon` has no USAGE on
   * `private`), but the policies only ever call it with a household the caller
   * already belongs to, so the restriction costs nothing.
   */
  select private.is_household_member(hid)
     and exists (
       select 1
       from public.household_members hm
       where hm.household_id = hid
         and hm.user_id = uid
     );
$$;

revoke all on function private.is_household_member_of(uuid, uuid) from public;
-- The policy expression runs as the querying role, so `authenticated` needs
-- EXECUTE. Without it every write fails with "permission denied for function",
-- which is how this was caught the first time.
grant execute on function private.is_household_member_of(uuid, uuid) to authenticated;

drop policy plan_entries_insert on public.plan_entries;
drop policy plan_entries_update on public.plan_entries;
drop policy plan_entries_delete on public.plan_entries;

/*
 * Insert: onto anybody's day in your household.
 *
 * `user_id` is unchecked against `auth.uid()` on purpose — that is the whole
 * change — but it is *not* unchecked. It has to be a member of the household
 * the row is in, which is what the old policy was getting for free.
 */
create policy plan_entries_insert on public.plan_entries
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and private.is_household_member_of(household_id, user_id)
    and private.chore_is_visible(chore_id)
  );

/*
 * Update: reordering, which is the commonest write this table takes, and moving
 * a row between the two days.
 *
 * Both USING and WITH CHECK carry the membership test. USING alone would let a
 * row be updated *out* of the household — set `household_id` to somewhere else
 * and it stops being visible to anyone here, which is a deletion wearing a
 * disguise.
 */
create policy plan_entries_update on public.plan_entries
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (
    private.is_household_member(household_id)
    and private.is_household_member_of(household_id, user_id)
    and private.chore_is_visible(chore_id)
  );

/*
 * `chore_is_visible` here is the thing that stops you, not defence in depth.
 *
 * This comment used to claim the opposite — that the SELECT policy already
 * covers it, because Postgres applies SELECT to rows a DELETE's WHERE clause
 * reads. True for a DELETE with a WHERE clause; false for one without, which
 * references no columns and so triggers no SELECT policy. A review measured it:
 * with this clause removed, a bare `delete from plan_entries` destroys the
 * entry for a chore the deleter is not allowed to know exists.
 */
create policy plan_entries_delete on public.plan_entries
  for delete to authenticated
  using (
    private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
  );
