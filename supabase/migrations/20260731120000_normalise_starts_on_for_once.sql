-- Make `starts_on` agree with the engine for one-time chores.
--
-- A `once` rule carries its own `dueOn`, so the schedule-level `startsOn` is a
-- second copy of the same fact — and the two had already drifted: the seed
-- writes `startsOn: 2026-01-04` on a chore due 2026-02-14. The engine's schema
-- now normalises `startsOn` to the rule's own date on parse, which left this
-- generated column disagreeing with what the app believes.
--
-- That disagreement is not cosmetic. `listOneTimeChores` orders by `starts_on`,
-- and any future indexed date filter would silently miss rows whose two copies
-- differ. An integration test asserts the column and the parsed schedule agree,
-- and it caught this.
--
-- The expression stays IMMUTABLE: `case` over pure jsonb accessors, no casts.
-- Text rather than date for the reason given in the original schema — casting
-- text to date is only STABLE, so Postgres rejects it here.

alter table public.chores
  drop column starts_on;

alter table public.chores
  add column starts_on text generated always as (
    case
      when schedule -> 'rule' ->> 'kind' = 'once'
        then schedule -> 'rule' ->> 'dueOn'
      else schedule ->> 'startsOn'
    end
  ) stored;

comment on column public.chores.starts_on is
  'Generated. For a one-time chore this is the rule''s own dueOn, matching how '
  'the engine normalises the schedule on parse.';
