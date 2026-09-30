-- ═══════════════════════════════════════════════════════════════════════════
-- One person doing their copy does not clear the other's flag
--
-- `clear_flags_on_completion` deletes every flag on the completed chore, which
-- is right for shared work: a flag says "this needs doing", and once it is
-- done that is true of nobody. The trigger keys on `chore_id` because a flag
-- *is* per chore — there is no occurrence column to key on.
--
-- That reasoning breaks for an `everyone` chore, which is one job **each**.
-- Emily flags the laundry; Jake ticks *his* copy; the flag disappears from
-- hers, which is still outstanding. Worse since the plan started auto-filling
-- flagged work: losing the flag also stops it being pulled onto her day.
--
-- Found by a bug hunt, not by a user — but it is exactly the class Jake asked
-- about: *"I don't want to be unsure if I messed something up or if the app
-- did."*
--
-- ── What this does not fix, deliberately ──────────────────────────────────
--
-- Un-ticking does not bring a flag back. The trigger deletes, and a delete has
-- nothing to restore from; resurrecting them would mean keeping a record of
-- every flag ever cleared, to undo something rare. Raising it again is one
-- tap, and the asymmetry is written down here rather than discovered.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function private.clear_flags_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
begin
  /*
   * `assignment_kind` is a stored generated column on `chores`, so this is a
   * primary-key lookup rather than json parsing per completion.
   */
  select c.assignment_kind into kind
    from public.chores c
   where c.id = new.chore_id;

  /*
   * One job each: this person's completion says nothing about anybody else's
   * copy, so it must not clear a flag the other person is still looking at.
   *
   * Every other kind — `anyone`, `fixed`, `rotate`, `unassignable` — produces
   * exactly one occurrence per period, so completing it does finish the work
   * the flag was about.
   */
  if kind = 'everyone' then
    return new;
  end if;

  /*
   * Both predicates are load-bearing. `household_id` is not belt-and-braces:
   * `completions_insert` once checked only that you belonged to the household
   * you named, not that the chore was yours, so a member of one household
   * could insert a completion carrying their own `household_id` and a stranger's
   * `chore_id` and have this definer function delete that stranger's flags.
   * Measured at the time: removing the predicate left the victim's flag count
   * at zero. The policy is fixed; this stays as the second lock.
   */
  delete from public.chore_flags
  where chore_id = new.chore_id
    and household_id = new.household_id;

  return new;
end;
$$;

revoke all on function private.clear_flags_on_completion() from public;

comment on function private.clear_flags_on_completion() is
  'Clears a chore''s flags when it is completed — except for `everyone` chores, which are one job each, where one person''s completion says nothing about the other''s copy.';
