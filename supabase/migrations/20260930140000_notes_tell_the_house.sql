-- ═══════════════════════════════════════════════════════════════════════════
-- A note is worth hearing about
--
-- Jake: *"sending notifications whenever somebody creates or updates a note."*
--
-- The board moved to a tab of its own because it was too easy to miss. A
-- notification is the other half of that: the point of writing "ask the
-- landlord about the boiler" on a shared board is that the other person sees
-- it, and neither of them is going to open a tab on the off-chance.
--
-- ── Updates are throttled, creation is not ────────────────────────────────
--
-- A note is edited in a text field and saved on a button, so one sitting is
-- one write — but two people tidying the same note in an evening would be two
-- pushes about the same thing. An update only speaks if the note has been
-- quiet for a while; creating one always does, because a new note is new
-- information and there is nothing to have already been told about.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function private.notify_on_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
  headline text;
  phrase text;
begin
  /*
   * `updated_by` rather than `auth.uid()`: the stamping trigger has already
   * run by the time this one does, so the row itself knows who touched it —
   * and that is the same value the footer in the app shows, which means the
   * notification and the screen can never disagree about who did it.
   */
  select p.display_name into who from public.profiles p where p.id = new.updated_by;
  if who is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    phrase := ' wrote a note.';
  else
    /*
     * Quiet if the **same person** touched the note in the last ten minutes.
     * One person saving twice while thinking is one piece of news, and a
     * board that buzzes per keystroke-worth-of-thought is a board people mute.
     *
     * The author test is not optional, and leaving it out was a real bug: a
     * throttle on the note alone silenced your housemate's *correction* to
     * something you had just written. Jake writes "Landlord coming Tuesday",
     * Emily fixes it to Wednesday four minutes later, and the one person who
     * will otherwise be out on the wrong day hears nothing. Worse, any
     * back-and-forth where each save lands inside ten minutes of the last
     * notifies nobody after the first.
     *
     * `is not distinct from` rather than `=`: a null on either side would make
     * `=` null, the whole condition null, and the branch fall through — which
     * is the safe direction here, but by accident rather than on purpose.
     */
    if old.updated_at > now() - interval '10 minutes'
       and old.updated_by is not distinct from new.updated_by then
      return new;
    end if;
    phrase := ' updated a note.';
  end if;

  /*
   * The title if there is one, otherwise the first line of the body — the same
   * promotion the card on the board does, so the notification and the row it
   * leads to say the same thing. Falls back to a generic line rather than an
   * empty title, because a push with no headline reads as a bug.
   */
  headline := coalesce(
    nullif(trim(coalesce(new.title, '')), ''),
    nullif(split_part(trim(new.body), E'\n', 1), ''),
    'A note'
  );

  -- Long bodies make a poor headline; the app will show the whole thing.
  if length(headline) > 60 then
    headline := left(headline, 57) || '...';
  end if;

  perform private.notify_household(new.household_id, new.updated_by, headline, who || phrase);

  return new;
end;
$$;

revoke all on function private.notify_on_note() from public;

comment on function private.notify_on_note() is
  'Tells the other phone that a note was written or edited. An edit is quiet '
  'only when the same person touched the note within the last ten minutes, so '
  'saving twice while you think is one piece of news while a housemate '
  'correcting what you just wrote is not. Two people tidying one note together '
  'therefore do get a push each time the author changes, which is the right '
  'trade: alternating edits are a conversation, and repeated saves are not.';

create trigger household_notes_notify_insert
  after insert on public.household_notes
  for each row
  execute function private.notify_on_note();

/*
 * `when` rather than a check inside the function: an edit that changes neither
 * the title nor the body is not news. The board's own footer updates on any
 * write, and that is enough for something nobody typed.
 */
create trigger household_notes_notify_update
  after update on public.household_notes
  for each row
  when (old.title is distinct from new.title or old.body is distinct from new.body)
  execute function private.notify_on_note();
