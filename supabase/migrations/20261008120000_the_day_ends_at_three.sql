/*
 * When the household's day ends.
 *
 * Jake: *"Can we make it so the day ends at like 3am? ... just so if I'm doing
 * something late at night it doesn't count as the next day"*. Ticking the last
 * chore at 00:40 filed it under tomorrow, which made tonight look unfinished
 * and started tomorrow with a chore nobody had done — two wrong days from one
 * timestamp.
 *
 * **A household setting, not a personal one.** Both people share a plan, a
 * chart and a set of completion records; two answers would mean a chore ticked
 * at 01:00 sat on Monday for Jake and Tuesday for Emily, and every shared total
 * would disagree. It sits beside `time_zone` and `week_starts_on`, which decide
 * the same kind of thing.
 *
 * Bounded at noon. A break after midday would put a day's own afternoon in
 * "yesterday"; a day has to contain its own daylight.
 *
 * **No backfill, and none possible.** Stored dates are what each client decided
 * at the time, so turning this on reinterprets nothing retroactively — a chore
 * recorded on 5 October stays on 5 October even if, under a 3 AM break, it
 * would have been the 4th. Rewriting history would need the original instant,
 * and `completed_on` is a date: the information is gone. Only future records
 * follow the new break, which is the honest behaviour and worth knowing before
 * reading an old week's chart.
 */

alter table public.households
  add column day_starts_at_hour smallint not null default 3
    constraint households_day_start_check check (day_starts_at_hour between 0 and 12);

comment on column public.households.day_starts_at_hour is
  'The hour a day begins. Anything earlier belongs to the previous day, so late-night work counts as the night it happened. 0 is an ordinary calendar day.';
