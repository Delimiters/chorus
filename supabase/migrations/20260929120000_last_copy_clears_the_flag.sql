-- ═══════════════════════════════════════════════════════════════════════════
-- Clear the flag of whoever did their copy, not everybody's and not nobody's
--
-- 20260925140000 stopped an `everyone` completion clearing the whole chore's
-- flags, because that chore is one job *each*: Emily flags the laundry, Jake
-- ticks his copy, and hers vanished while still outstanding.
--
-- It over-corrected. Returning early meant *no* completion ever cleared an
-- `everyone` chore's flag, including the last one — so once both had done
-- their copy the flag stood for ever until somebody cleared it by hand. A
-- review caught it; the pgTAP file asserted the one-person case and not the
-- both-people case, which is what let it through.
--
-- ── The rule that was there all along ─────────────────────────────────────
--
-- `chore_flags` is keyed per (chore, person). For an `everyone` chore that
-- maps exactly onto "one job each": completing *your* copy finishes *your*
-- flag and says nothing about anybody else's. No early return, no counting of
-- who is left — just a narrower `where`.
--
-- Every other assignment kind produces one occurrence per period, so finishing
-- it finishes the work the flag was about, whoever raised it. Those still
-- clear the lot.
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
  -- `assignment_kind` is a stored generated column, so this is a primary-key
  -- lookup rather than json parsing per completion.
  select c.assignment_kind into kind
    from public.chores c
   where c.id = new.chore_id;

  /*
   * Both predicates below are load-bearing. `household_id` is not
   * belt-and-braces: `completions_insert` once checked only that you belonged
   * to the household you named, not that the chore was yours, so a member of
   * one household could name a stranger's `chore_id` and have this definer
   * function delete that stranger's flags. Measured at the time — removing the
   * predicate left the victim's flag count at zero. The policy is fixed; this
   * stays as the second lock.
   */
  if kind = 'everyone' then
    delete from public.chore_flags
    where chore_id = new.chore_id
      and household_id = new.household_id
      and user_id = new.completed_by;
  else
    delete from public.chore_flags
    where chore_id = new.chore_id
      and household_id = new.household_id;
  end if;

  return new;
end;
$$;

revoke all on function private.clear_flags_on_completion() from public;

comment on function private.clear_flags_on_completion() is
  'Clears a chore''s flags when it is completed. For an `everyone` chore — one job each — it clears only the flag of the person who did their own copy.';
