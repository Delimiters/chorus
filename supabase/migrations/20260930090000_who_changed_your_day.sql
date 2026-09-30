-- ═══════════════════════════════════════════════════════════════════════════
-- "Emily put the bins on your day"
--
-- Jake, on the completion and new-chore notifications: *"Does it also tell
-- when someone adds or removes something from your daily planning?"*
--
-- It did not, and could not, because a plan row does not say how it got there.
-- Both phones fill both plans automatically — that is the whole point of
-- `plan_dismissals` — so a trigger on `plan_entries` would have announced every
-- chore the app added on its own, every morning. A notification you learn to
-- ignore is worse than none, and it is the exact noise the completion trigger
-- was designed around.
--
-- So the rows now record *who*, and "nobody" is a real answer:
--
--   `added_by = null`      the fill put it there. Silent.
--   `added_by = user_id`   you put it on your own day. Silent — you know.
--   `added_by = somebody`  they put it on yours. Worth saying.
--
-- Removals are simpler: only a person ever writes a dismissal, so the column
-- is never null and the same "was it somebody else" test does all the work.
-- ═══════════════════════════════════════════════════════════════════════════

/*
 * Nullable with no default, deliberately.
 *
 * A default of `auth.uid()` would have been tidier and wrong: the fill runs as
 * the signed-in person too, so Jake's phone filling Emily's day would look
 * exactly like Jake choosing something for her. The client has to say, and
 * null is how it says "this was not a decision".
 */
alter table public.plan_entries
  add column added_by uuid references public.profiles (id) on delete set null;

comment on column public.plan_entries.added_by is
  'Who chose to put this on the plan, or null when the automatic fill did. Null is meaningful: it is what separates a decision from housekeeping.';

/*
 * Who took it off. Always a person — the fill never writes one of these — so
 * this one can default.
 */
alter table public.plan_dismissals
  add column dismissed_by uuid references public.profiles (id) on delete set null;

comment on column public.plan_dismissals.dismissed_by is
  'Who took it off. Always somebody, because only a person writes a dismissal.';

-- ── "Emily put the bins on your day" ───────────────────────────────────────
create or replace function private.notify_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  who text;
  what text;
  phrase text;
begin
  if tg_table_name = 'plan_entries' then
    actor := new.added_by;
    phrase := ' put this on your day.';
  else
    actor := new.dismissed_by;
    phrase := ' took this off your day.';
  end if;

  /*
   * Silent for the fill (`actor is null`) and for anything you did to your own
   * day. Between them those are almost every row ever written here, which is
   * why this test comes before the two lookups below.
   */
  if actor is null or actor = new.user_id then
    return new;
  end if;

  select p.display_name into who from public.profiles p where p.id = actor;
  select c.title into what from public.chores c where c.id = new.chore_id;
  if who is null or what is null then
    return new;
  end if;

  /*
   * Aimed at one person rather than the household: this is about *your* day,
   * and the rest of the house has no stake in it. `notify_household` excludes
   * the actor, so naming them as the actor sends it to exactly the plan's
   * owner in a two-person house.
   */
  perform private.notify_household(new.household_id, actor, what, who || phrase);

  return new;
end;
$$;

revoke all on function private.notify_on_plan_change() from public;

create trigger plan_entries_notify
  after insert on public.plan_entries
  for each row
  execute function private.notify_on_plan_change();

/*
 * A dismissal has no `chore_id` of its own — it is keyed by occurrence — so
 * the title has to come from somewhere. Added rather than joined through the
 * occurrence key, which is a string the database cannot parse back into a
 * chore without reimplementing the engine.
 */
alter table public.plan_dismissals
  add column chore_id uuid references public.chores (id) on delete cascade;

create trigger plan_dismissals_notify
  after insert on public.plan_dismissals
  for each row
  execute function private.notify_on_plan_change();
