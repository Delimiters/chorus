-- ═══════════════════════════════════════════════════════════════════════════
-- A flag lasts until the job is done, not until Sunday
--
-- Flags expired by comparison: a flag was live only while `flagged_on` fell in
-- the week you were looking at, so Monday arrived and last week's worries
-- silently stopped being worries. That was argued for at length — no
-- scheduler, no decision about what "Monday" means for a household that starts
-- its week on Sunday, expiry as a pure function of two dates.
--
-- It was the wrong question. Jake: *"I don't like this whole 'flag it for the
-- week' thing. It should stay flagged until you either unflag it or it gets
-- done."* A week is arbitrary; the reason you flagged something does not
-- expire on a calendar boundary. Getting it done is what ends it.
--
-- ── Why a trigger and not the app ─────────────────────────────────────────
--
-- "Completing a chore clears its flags" is a fact about the data, not about a
-- screen. A chore can be completed from Today, from the plan, and from the
-- occurrence sheet; doing it in the client means three call sites that must
-- all remember, and a fourth the day somebody adds another. The trigger cannot
-- be forgotten.
--
-- `security definer` because the person completing the chore is not
-- necessarily the person who flagged it — `chore_flags_delete` is `user_id =
-- auth.uid()`, and deleting only your own would leave your housemate's flag
-- standing on work that is finished. The function is pinned to a chore id that
-- the completion itself supplies, so it cannot be steered anywhere else.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function private.clear_flags_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * Everyone's flags on that chore, not just the completer's.
   *
   * A flag says "this one needs doing". Once it is done that is true of
   * nobody, so leaving the other person's behind would show a "!!" on
   * finished work — and they cannot clear it from any screen that still
   * lists it.
   */
  /*
   * `household_id` is belt-and-braces: `chore_id` is a primary key and a chore
   * belongs to exactly one household, so the chore filter already scopes this.
   * Kept because a mismatched pair would be corruption worth not spreading,
   * and noted because a pgTAP test cannot exercise it.
   */
  delete from public.chore_flags
  where chore_id = new.chore_id
    and household_id = new.household_id;

  return new;
end;
$$;

revoke all on function private.clear_flags_on_completion() from public;

/*
 * After, not before: if the completion is rolled back — a duplicate
 * `occurrence_key` hitting the unique index, which is the ordinary case when
 * two phones tick at once — the flag deletion goes with it.
 */
create trigger chore_completions_clear_flags
  after insert on public.chore_completions
  for each row
  execute function private.clear_flags_on_completion();

/*
 * Skips deliberately do not clear a flag.
 *
 * Skipping says "not this time", which is not the same as "dealt with" — if
 * anything a flagged chore you have just skipped is more worth seeing, not
 * less. Only `chore_completions` carries the trigger.
 */

comment on table public.chore_flags is
  'A person marked a chore for attention. Live until it is unflagged or the chore is completed.';

comment on column public.chore_flags.flagged_on is
  'The civil date it was raised. A record of when, not an expiry — nothing reads it to decide whether the flag is live.';
