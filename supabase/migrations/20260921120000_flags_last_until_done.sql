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
   * Both predicates are load-bearing. An earlier version of this comment said
   * `household_id` was belt-and-braces on the reasoning that a chore belongs to
   * exactly one household — true of the data, and irrelevant, because nothing
   * made the *inserted row* agree with it.
   *
   * `completions_insert` checked only that you belong to the household you
   * named and that you are the completer. It never checked that the chore was
   * yours. So a member of one household could insert a completion carrying
   * their own `household_id` and a `chore_id` from somewhere else, and this
   * trigger — running as definer — would delete a stranger's flags. Measured,
   * not theorised: with the `household_id` predicate removed, exactly that
   * left the victim's flag count at zero.
   *
   * The policy is fixed below, which is the real repair. This predicate stays
   * as the second lock, and the comment stays as the reason not to remove it.
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

/*
 * A completion has to be for a chore you can actually see.
 *
 * `completions_insert` shipped with `is_household_member(household_id)` and
 * `completed_by = auth.uid()` and nothing about `chore_id`, so the two columns
 * were never required to agree. That was inert while nothing read the pair as
 * a boundary; the trigger above is the first thing that does, which is how it
 * surfaced.
 *
 * `chore_is_visible` is the guard `completions_select` has always used. It
 * checks the chore's *own* household, and refuses a chore somebody has marked
 * private to themselves — so this also closes recording a completion against a
 * housemate's private chore, which was possible for the same reason.
 */
drop policy completions_insert on public.chore_completions;

create policy completions_insert on public.chore_completions
  for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and private.chore_is_visible(chore_id)
    and completed_by = (select auth.uid())
  );
