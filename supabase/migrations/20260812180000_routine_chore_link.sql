-- ═══════════════════════════════════════════════════════════════════════════
-- Ticking a routine item that is linked to a chore
--
-- Two rows must land together: the routine completion, and — if the linked
-- chore actually has an occurrence due today — the chore completion. Doing it
-- as two client calls leaves a visible half-state whenever the second fails.
--
-- SECURITY INVOKER, deliberately. These escalate nothing: both writes run as
-- the caller with RLS applied, and the only thing gained is one transaction.
-- That also keeps them out of grants.test.sql's SECURITY DEFINER allowlist,
-- which exists so that adding a *definer* function in `public` is a decision
-- somebody makes on purpose rather than a line that arrives with a feature.
--
-- The server does NOT expand recurrence. The client already has the projected
-- chore occurrence on screen and passes its key and date in. SQL that
-- re-derived the key would be a second recurrence engine, and the two would
-- drift — which is the whole reason occurrences are computed in one place.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.tick_routine(
  p_item         uuid,
  p_occurrence   text,
  p_due_on       date,
  p_completed_on date,
  p_chore        uuid default null,
  p_chore_occ    text default null,
  p_chore_due_on date default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  me  uuid := (select auth.uid());
  hid uuid;
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Read through RLS: a routine item somebody else owns simply is not here,
  -- and the insert below would fail its policy anyway.
  select household_id into hid
  from public.routine_items
  where id = p_item and user_id = me;

  if hid is null then
    raise exception 'That routine item is not yours' using errcode = '42501';
  end if;

  -- `do nothing` rather than an error: a double tap or a retry after a timeout
  -- is success, which is what makes optimistic ticking safe.
  insert into public.routine_completions
    (household_id, routine_item_id, user_id, occurrence_key, due_on, completed_on)
  values (hid, p_item, me, p_occurrence, p_due_on, p_completed_on)
  on conflict (routine_item_id, occurrence_key) do nothing;

  -- Only when the caller found an occurrence of the linked chore due today.
  -- If the chore is archived, or simply not due, this is a routine tick alone.
  if p_chore is not null and p_chore_occ is not null and p_chore_due_on is not null then
    insert into public.chore_completions
      (household_id, chore_id, occurrence_key, due_on, completed_on, completed_by)
    values (hid, p_chore, p_chore_occ, p_chore_due_on, p_completed_on, me)
    on conflict (chore_id, occurrence_key) do nothing;
  end if;
end;
$$;

create or replace function public.untick_routine(
  p_item       uuid,
  p_occurrence text,
  p_chore      uuid default null,
  p_chore_occ  text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  delete from public.routine_completions
  where routine_item_id = p_item
    and occurrence_key = p_occurrence
    and user_id = me;

  /*
   * The chore completion comes back only if it was yours.
   *
   * A deliberate narrowing. Un-ticking your own private routine item should
   * not silently undo your housemate's work on the shared chore — they ticked
   * it from Today, they had a reason, and nothing on your screen would show
   * that you had reversed it. Guarded, the reversal is symmetric: it undoes
   * exactly what your tick did.
   */
  if p_chore is not null and p_chore_occ is not null then
    delete from public.chore_completions
    where chore_id = p_chore
      and occurrence_key = p_chore_occ
      and completed_by = me;
  end if;
end;
$$;

revoke all on function public.tick_routine(uuid, text, date, date, uuid, text, date) from public;
revoke all on function public.untick_routine(uuid, text, uuid, text) from public;
grant execute on function public.tick_routine(uuid, text, date, date, uuid, text, date) to authenticated;
grant execute on function public.untick_routine(uuid, text, uuid, text) to authenticated;

comment on function public.tick_routine(uuid, text, date, date, uuid, text, date) is
  'Completes a routine item and, when one is passed, the linked chore occurrence — in one transaction.';
comment on function public.untick_routine(uuid, text, uuid, text) is
  'Reverses tick_routine. The chore completion is removed only if the caller made it.';
