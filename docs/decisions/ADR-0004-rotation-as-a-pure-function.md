# ADR-0004 — Rotation is a pure function of the date

**Status:** accepted · **Date:** 2026-07-29

## Context

The previous implementation held `currentAssigneeIndex` on the chore and advanced
it inside `rotateAssignee()`, called only from the completion path. So a weekly
rotation nobody completed never advanced — the same person stayed responsible
indefinitely, which is exactly the situation where a rotation most needs to move.

## Decision

`assigneeFor(occurrence, assignment, calendar, anchor)` is a **total pure
function**. It takes no completions, no exceptions, no clock, and no mutable
state. The turn derives from the occurrence's position in time:

```
segment  = last segment whose effectiveFrom <= occurrence.dueOn
turn     = floor(distance(anchor, occurrence) / cadence.every)
assignee = segment.memberIds[(turn + segment.offset) % segment.memberIds.length]
```

Two supporting decisions:

- **Rotation cadence is independent of the chore's cadence.** "Trash goes out
  Mon/Wed/Fri but whose job it is flips weekly" is a weekly rule with a
  `{unit: 'week', every: 1}` cadence. With `{unit: 'occurrence'}` you would
  alternate every trash day instead. Both are one-line configurations.
- **Roster changes append a `RotationSegment`**, never mutate. Reading current
  household membership would retroactively rewrite who was responsible last
  month, corrupting the history view.

Turns are measured from `schedule.startsOn`, not from the segment, so appending a
segment never renumbers existing turns — the segment's `offset` shifts *who* holds
a turn, never *which* turn a date is.

## Consequences

- An unfinished week advances, because the calendar advanced.
- Skipping does not pass your turn along: the occurrence's index is unchanged, so
  the rotation is undisturbed. The UI says so out loud.
- A reschedule must resolve the assignee from the **original** occurrence.
  Resolving from the moved one lets a date-based cadence hand the chore to the
  other person — a bug this codebase shipped and a retrospective caught.
- "Show me all chores assigned to me" is resolved client-side after expansion
  rather than by a SQL `where assignee = me`. Correct and fast for two people; a
  materialized projection would be the fix if households ever grew.
