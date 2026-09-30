-- ═══════════════════════════════════════════════════════════════════════════
-- "Emily finished the dishes"
--
-- ADR-0005 deferred remote push because it needs an APNs key, which needs a
-- paid Apple membership. That arrived on 2026-09-24, so the one thing local
-- notifications structurally cannot do is finally buildable:
--
--   Jake: *"So we can get notifications for each other's stuff now? When
--   someone adds a chore and when someone completes a chore? Because that
--   would be great!"*
--
-- ── Why a trigger and not an edge function ────────────────────────────────
--
-- `pg_net` is already installed, so the database can make the HTTP call
-- itself. An edge function would be a second deployable, a second place to
-- hold secrets, and a second thing to forget to deploy — for what is, at this
-- size, one POST per completion.
--
-- `net.http_post` queues the request and returns immediately. That is the
-- property that makes this safe to hang off a trigger: a push that fails, or
-- an Expo outage, cannot roll back the completion it was announcing. Ticking a
-- chore must never depend on a notification succeeding.
--
-- ── Who hears about it ────────────────────────────────────────────────────
--
-- Everybody in the household except the person who did it. You know you ticked
-- the dishes; being told is noise, and it is the fastest way to make somebody
-- turn notifications off altogether.
--
-- `security definer` because the sender has to read the *other* person's
-- device tokens, and `push_tokens` is deliberately the one table in this app
-- that is private to its owner rather than shared with the house.
-- ═══════════════════════════════════════════════════════════════════════════

-- `pg_net` creates and owns its own `net` schema; it cannot be relocated, so
-- the calls below are qualified `net.` rather than `extensions.net.`.
create extension if not exists pg_net;

/*
 * Whether this person wants to hear from the other one at all.
 *
 * Per member rather than per household: Jake and Emily can reasonably disagree
 * about being interrupted, and a shared switch would make one of them decide
 * for both. Default on, because the feature was asked for — but the row exists
 * so turning it off is a toggle and not a support request.
 */
alter table public.household_members
  add column push_enabled boolean not null default true;

comment on column public.household_members.push_enabled is
  'Whether this person receives remote notifications about what their housemate does. Per member, because being interrupted is a personal preference.';

/*
 * And yours alone to change, exactly as `share_routine` is.
 *
 * `household_members_update` lets an admin edit any row in the house, so
 * without this an admin could turn their housemate's notifications on — or
 * off. Being interrupted is a personal preference, and the guard that already
 * protects one of those is the right place for the second.
 */
create or replace function private.guard_membership_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if new.share_routine is distinct from old.share_routine and old.user_id <> me then
    raise exception 'Only you can change whether your routine is shared'
      using errcode = '42501';
  end if;

  if new.push_enabled is distinct from old.push_enabled and old.user_id <> me then
    raise exception 'Only you can change whether you are notified'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role and not private.is_household_admin(old.household_id) then
    raise exception 'Only an admin can change roles' using errcode = '42501';
  end if;

  if new.household_id is distinct from old.household_id or new.user_id is distinct from old.user_id then
    raise exception 'A membership cannot be moved' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.guard_membership_update() is
  'Keeps share_routine and push_enabled in their owner''s hands, and keeps the self-update policy from becoming a promotion route.';

/*
 * One place that knows how to reach Expo, so the two triggers below cannot
 * drift in how they format a message or where they send it.
 *
 * Silent when there is nobody to tell: a household of one, a housemate who has
 * never opened the app on a build that registers, or one who has turned this
 * off. Sending to an empty recipient list would be a wasted round trip that
 * Expo answers with an error.
 */
create or replace function private.notify_household(
  household uuid,
  actor uuid,
  title text,
  body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  messages jsonb;
begin
  select jsonb_agg(
           jsonb_build_object(
             'to', t.token,
             'title', title,
             'body', body,
             'sound', 'default'
           )
         )
    into messages
    from public.push_tokens t
    join public.household_members m
      on m.user_id = t.user_id
     and m.household_id = household
   where t.user_id <> actor
     and m.push_enabled;

  if messages is null then
    return;
  end if;

  /*
   * Fire and forget. `net.http_post` writes to a queue table and a background
   * worker drains it, so nothing here waits on Expo and nothing Expo does can
   * fail the surrounding transaction.
   */
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := messages,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Accept', 'application/json'
    )
  );
end;
$$;

revoke all on function private.notify_household(uuid, uuid, text, text) from public;

-- ── "Jake finished the dishes" ─────────────────────────────────────────────
create or replace function private.notify_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
  what text;
begin
  select p.display_name into who from public.profiles p where p.id = new.completed_by;
  select c.title into what from public.chores c where c.id = new.chore_id;

  -- A completion for a chore or a person that has gone is not worth a push,
  -- and `coalesce` into "Somebody did something" would be worse than silence.
  if who is null or what is null then
    return new;
  end if;

  perform private.notify_household(
    new.household_id,
    new.completed_by,
    what,
    who || ' finished this.'
  );

  return new;
end;
$$;

revoke all on function private.notify_on_completion() from public;

create trigger chore_completions_notify
  after insert on public.chore_completions
  for each row
  execute function private.notify_on_completion();

-- ── "Emily added: Water the plants" ────────────────────────────────────────
create or replace function private.notify_on_new_chore()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
begin
  /*
   * A chore somebody keeps to themselves is not household news, and telling
   * the other person its title would leak exactly what `private_to` exists to
   * keep back.
   */
  if new.private_to is not null then
    return new;
  end if;

  select p.display_name into who from public.profiles p where p.id = new.created_by;
  if who is null then
    return new;
  end if;

  perform private.notify_household(
    new.household_id,
    new.created_by,
    new.title,
    who || ' added this.'
  );

  return new;
end;
$$;

revoke all on function private.notify_on_new_chore() from public;

create trigger chores_notify
  after insert on public.chores
  for each row
  execute function private.notify_on_new_chore();
