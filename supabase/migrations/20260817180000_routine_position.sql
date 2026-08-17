-- ═══════════════════════════════════════════════════════════════════════════
-- Let a routine be put in the order you actually do it
--
-- Time of day is a poor proxy for sequence. Most routine items have no time at
-- all — they are "sometime this morning" — so they fall back to a title sort,
-- which is alphabetical order masquerading as a plan. Setting a fake time on
-- each one to force a sequence is the workaround, and it is a bad one: those
-- times then drive reminders.
--
-- `position` is nullable on purpose, and null is not "position zero". An item
-- that has never been dragged sorts by its time exactly as before, and sorts
-- *after* anything that has been placed by hand. So the list looks unchanged
-- until somebody reorders it, and a newly added item lands at the bottom of
-- its bucket rather than jumping into the middle of a sequence somebody set.
--
-- No uniqueness constraint. Two items sharing a position is not a corruption —
-- the comparator falls through to time and then title, which is total — and a
-- unique index would turn an ordinary drag into a multi-row constraint dance.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.routine_items
  add column position integer;

comment on column public.routine_items.position is
  'Manual order within a bucket. Null means "not placed by hand": sorts by time, after anything that has been.';

-- Every read of a routine is scoped to one owner, and the sort happens inside
-- a bucket, so this is the shape the ordering actually asks for.
create index routine_items_position_idx
  on public.routine_items (user_id, bucket, position)
  where archived_at is null;
