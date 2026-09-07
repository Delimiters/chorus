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
 * `user_id` is still whose day the row is on. It is no longer who may change it.
 */

drop policy plan_entries_insert on public.plan_entries;
drop policy plan_entries_update on public.plan_entries;
drop policy plan_entries_delete on public.plan_entries;

/*
 * Insert: onto anybody's day in your household.
 *
 * `user_id` is unchecked against `auth.uid()` on purpose — that is the whole
 * change. It is still constrained to a real member by the foreign key, so a row
 * cannot be planted on somebody outside the household.
 */
create policy plan_entries_insert on public.plan_entries
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
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
    and private.chore_is_visible(chore_id)
  );

create policy plan_entries_delete on public.plan_entries
  for delete to authenticated
  using (private.is_household_member(household_id));
