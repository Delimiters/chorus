# When the day ends

**8 October 2026.** Jake: *"Can we make it so the day ends at like 3am? maybe
make it something configurable in settings? just so if I'm doing something late
at night it doesn't count as the next day"*.

Tick the last chore at 00:40 and it was filed under tomorrow. That is two wrong
days from one timestamp: tonight looks unfinished, and tomorrow opens with a
chore nobody has done.

## The rule

A household names an hour. The day runs from that hour to the same hour the next
morning, so anything before it belongs to the night before. Default 3 AM;
midnight is the escape hatch back to an ordinary calendar day.

**The boundary instant belongs to the day that is starting.** 02:59 is the
previous day, 03:00 is the new one. Jake checked the direction — *"time before
3am means the PREVIOUS wall clock date. if it's 3am or earlier on Tuesday it
should [count] as Monday"* — and read literally that puts 03:00:00 on Monday. The
direction is what he was pinning; a half-open window `[D 03:00, D+1 03:00)` is
the only version where every instant belongs to exactly one day. Stated plainly
because it is one minute of the day and somebody will eventually test it.

**Bounded at noon.** A break after midday would put a day's own afternoon in
"yesterday".

## Where it lives

**A household setting, beside `time_zone` and `week_starts_on`.** Both people
share a plan, a chart and a set of completion records; two answers would mean a
chore ticked at 01:00 sat on Monday for Jake and Tuesday for Emily, and every
shared total would disagree.

**One place applies it.** `src/data/today.ts` is the only code in the app where a
real clock meets a timezone, and the engine stays `Date`-free by taking `today`
as a parameter. The break is applied there and nowhere else, so that property
survives. `core/civil/daybreak.ts` holds the pure rule.

**`useToday` takes the hour as a required argument.** Fourteen call sites, all
found by the compiler. A default would have let any of them keep midnight
silently — which is exactly how a cap recently lived in five places with four of
them stale.

## The part that is not about dates

A reminder time earlier than the break happens on the *next* calendar date: a
chore due Monday at 01:00 fires on Tuesday morning, because 01:00 Tuesday is
Monday night. Scheduled against Monday it is 23 hours early — and for a chore due
today that instant is already past, so the transport drops it silently and the
reminder never arrives at all. `wallDateFor` is the inverse of `dayOfWallClock`,
and a round-trip test holds the two together.

The routines planner has had the equivalent of this since it shipped
(`fallsOnNextCalendarDay`). Chores did not need it before, because no chore time
could belong to another day.

**The agenda's refresh timer now waits for the break rather than for midnight.**
A midnight timer under a 3 AM day fires three hours early, recomputes the date it
already had, and leaves nothing armed — so a phone left open overnight sits on
the old day, which is the bug that timer exists to prevent.

## Two things left alone, deliberately

**Nothing is backfilled, and nothing can be.** Stored dates are what each client
decided at the time. Turning this on reinterprets no history: a chore recorded on
5 October stays on 5 October even if, under a 3 AM break, it would have been the
4th. Rewriting would need the original instant and `completed_on` is a date — the
information is gone. Only future records follow the new break. The settings copy
says so.

**Routines keep their own 05:00 boundary.** `core/routines/buckets.ts` starts the
routine day at 05:00 so that Night is a single span rather than "after 21:00 or
before 05:00", and the bucket sort depends on it. That answers a different
question — which *part of the day* a time is called — from the household break,
which answers which *date* a record belongs to. They are left separate rather
than merged on a guess.

The visible consequence: with a break earlier than 05:00, a routine done at 04:00
is recorded against the new day while still sorting into the previous day's
Night. **Worth asking Jake whether routine buckets should follow the household
break too** — it is a real question, not an oversight, and the answer changes
what "Night" means rather than fixing a bug.

What was *not* defensible, and a review found it: the **owed badge** read across
the same seam, and there the consequence is a wrong number rather than a
debatable label. `owedByNow` filtered on `item.dueOn === today` — the household
day — while measuring elapsed time from the routine day's 05:00. With a break at
noon, 09:00 on Tuesday is `today = Monday` and twenty-one hours in, but elapsed
measured four hours, so every Monday afternoon and evening item silently stopped
counting. Both sides now measure from the household break, which leaves bucket
sorting untouched.

The first attempt at that fix introduced its own regression, which the
re-review caught: measuring an item's due-from against the household break while
its `dueOn` still meant a routine day made an item timed 04:00 look like it was
due an hour into Monday — so the badge counted it from Monday morning, almost a
day before the reminder for it, and before the thing exists. `owedByNow` now maps
the item through `fallsOnNextCalendarDay` to the calendar day it happens on and
*then* asks which household day that instant falls in. It is the one place that
reconciles the two boundaries rather than picking one.

The badge also read its day and its clock from two separately-polled sources.
`useToday` turns the day over exactly at the break while the minute poll can
still report 02:59 for up to a minute — the largest "minutes into the day" value
there is — so every item of the brand-new day counted as owed and the badge
showed the whole day's total before snapping to zero. `useNowCivil` returns both
from one instant.

And one reminder bug of exactly the class this change fixed for chores, found in
the same pass: the **grouped bucket** reminder set `onDate` without the
next-calendar-day rule its own per-item sibling has always applied. A Night
reminder configured for 02:00 was scheduled almost a day early — and for today's
bucket that instant is already past, so it was dropped and never arrived.

## Pinned by

- `core/civil/daybreak.test.ts` — the rule itself, both directions, across month
  and year boundaries, plus a round-trip holding `wallDateFor` and
  `dayOfWallClock` together across four break hours and seven times of day.
- `data/today.test.ts` — the break against a real `Intl` conversion, in a zone
  chosen so the local wall clock is the interesting part. **Every pre-existing
  test in that file now passes `0` explicitly**, which makes the whole file the
  "did this change what today means" check: at midnight the new path must be a
  no-op.
- `core/notify/plan.test.ts` — same arrangement: the existing suite is pinned at
  0, and the break's effect on reminder dates is tested on its own terms.
- `SettingsScreen.test.tsx` — the control reads "3 AM" rather than "3", says it
  is shared and that it does not rewrite the past, and cannot be pushed out of
  range.
- `supabase/tests/day-break.test.sql` — the default, both bounds, and that the
  column cannot be emptied.

Every guard mutation-verified: twelve separate reversions, each turning a
different set of tests red — including each of the three parts of the owed fix
(the household-day filter, the next-calendar-day remap, and the origin `elapsed`
is measured from), which fail on different tests.

Known and left alone: a **bucket reminder time set before 05:00** moves a day
later, because under the routine-day model 04:30 belongs to the routine day that
began the previous morning. Consistent, and useless if somebody actually sets
Morning to 04:30 through the "Other…" wheel. Worth a look alongside the question
of whether routine buckets should follow the household break at all.

Three tests were **removed** rather than kept. They pointed at the
`Math.max(1000, …)` clamp in `msUntilNextDaybreak` and asserted arithmetic the
inputs cannot violate — a review proved it by deleting the clamp and watching the
whole suite stay green. The clamp stays, because `Intl` is an external dependency
and a timer of zero spins a phone; the tests went, because a test that cannot go
red reads like evidence and is not.

## The DST night the timer cannot measure

`msUntilNextDaybreak` returns a **wall-clock** delta and `setTimeout` counts
**real** milliseconds, so on a transition night the two differ by an hour. The
docstring used to claim that reading local parts meant "a DST transition does not
skew it" — that removes the *offset* error, not the *transition* error, and the
claim was false.

Fall back, and the timer fires an hour before the break, on a clock that has not
reached it: `today` recomputes to the value it already had. Keyed on `today`, the
effect did not re-run, **nothing armed the next timer**, and a phone left on Today
sat on the previous day until it was backgrounded — the exact stall the timer
exists to prevent. The effect now depends on `now` and re-arms unconditionally,
which costs one extra timer on two nights a year.

Pinned by a test that plays the real night: 01:00 MDT on 7 November 2027, two
wall-clock hours to the break, two real hours later it is 02:00 MST.
