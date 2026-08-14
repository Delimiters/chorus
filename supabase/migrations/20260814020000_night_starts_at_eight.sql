-- ═══════════════════════════════════════════════════════════════════════════
-- Night begins at 20:00, not 21:00
--
-- A preference, not a defect: nine in the evening is late for the last stretch
-- of the day, and eight matches when the evening actually winds down here.
--
-- The rule is written twice on purpose — once here as a generated column, once
-- in src/core/routines/buckets.ts — because the client must be able to file an
-- item into a section without a round trip, and the database must not depend
-- on the client having done it correctly. Both change together, and
-- test/integration/routines.test.ts walks every boundary from both sides so
-- they cannot drift apart quietly.
--
-- A generated expression cannot be altered in place, so the column is dropped
-- and rebuilt. Nothing is lost: every value is recomputed from `time_of_day`
-- and `bucket_choice`, which are the real inputs. Existing rows with a
-- specific time between 20:00 and 20:59 move from Evening to Night, which is
-- the point of the change.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.routine_items drop column bucket;

alter table public.routine_items
  add column bucket text generated always as (
    case
      when time_of_day is null then bucket_choice
      when time_of_day >= '05:00' and time_of_day < '12:00' then 'morning'
      when time_of_day >= '12:00' and time_of_day < '17:00' then 'afternoon'
      when time_of_day >= '17:00' and time_of_day < '20:00' then 'evening'
      else 'night'
    end
  ) stored;

comment on column public.routine_items.bucket is
  'Which part of the day the item sits in. Mirrors bucketOf() in src/core/routines/buckets.ts; the integration suite walks every boundary from both sides.';
