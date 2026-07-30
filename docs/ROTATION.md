# Rotation

Whose turn is it? The answer is a pure function of the date.

See [ADR-0004](decisions/ADR-0004-rotation-as-a-pure-function.md) for why, and
[POSTMORTEM-SWIFT.md](POSTMORTEM-SWIFT.md) §2 for what it replaced.

## The four assignment modes

| Mode | Means | Example |
|---|---|---|
| `anyone` | Either housemate may do it; one completion satisfies it | Dishes |
| `fixed` | Always the same person | Sam handles the plants |
| `rotate` | Take turns | Trash |
| `everyone` | Each person has their own copy | You each do your own laundry |

`everyone` fans one occurrence out into one per member, each with its own
occurrence key — so ticking yours doesn't tick your housemate's.

## Turn computation

```
segment  = last segment whose effectiveFrom <= occurrence.dueOn
turn     = floor(distance(anchor, occurrence) / cadence.every)
assignee = segment.memberIds[(turn + segment.offset) % segment.memberIds.length]
```

`assigneeFor` takes **no completions, no exceptions, no clock, and no mutable
state**. It is total over `(occurrence, assignment, calendar, anchor)`.

That is the whole design. A week nobody completed still advances, because the
calendar advanced.

## Cadence is independent of the chore's schedule

This is the part people expect to be hard and isn't. Rotation cadence is a
separate field, so:

| Want | Rule | Cadence |
|---|---|---|
| Trash Mon/Wed/Fri, whose job flips weekly | `weekly{weekdays:[1,3,5]}` | `{unit:'week', every:1}` |
| Alternate every single trash day | `weekly{weekdays:[1,3,5]}` | `{unit:'occurrence', every:1}` |
| Monthly deep clean, alternating people | `monthlyByDay{...}` | `{unit:'occurrence', every:1}` |
| Whoever has the bathroom keeps it a month | `weekly{weekdays:[0]}` | `{unit:'month', every:1}` |

All four are the same function with different arguments.

## Roster changes append, never mutate

The roster lives on the chore as an append-only list of `RotationSegment`s, not
read from current household membership.

That matters because reading current membership would **retroactively rewrite who
was responsible last month.** Someone joins, and suddenly the history view says
they did chores before they arrived.

When the roster changes, the app appends a segment with `effectiveFrom` set to
tomorrow, and an `offset` chosen by `nextSegmentOffset` so the next occurrence
falls to whoever fairness says is next — skipping anyone who has left. Past
occurrences resolve against their own historical segment and never change.

Turns are measured from `schedule.startsOn`, not from the segment. So appending a
segment never renumbers turns; the segment's `offset` shifts *who* holds a turn,
never *which* turn a given date is.

## What deviations do to the rotation

| Action | Effect on the rotation |
|---|---|
| **Complete** | Nothing. The turn was already determined by the date. |
| **Skip** | Nothing — and this is deliberate. Skipping does not pass your turn along. The UI says "Sam still up next" so it isn't a surprise. |
| **Reschedule** | Nothing. The occurrence keeps its key, its index, and **its assignee**. |

That last row is load-bearing and was once wrong. The projector passed the *moved*
occurrence to `assigneeFor`, so a date-based cadence recomputed the turn from the
new date: moving one Wednesday to the following Monday produced
`bob → bob → alice` instead of `alice → bob → alice`. Bob did two in a row and
alice's turn silently vanished. A reschedule moves *when*, never *whose*.

## Fairness guarantees, as tested

- **P10** — over any `k × |roster|` consecutive occurrences within one segment,
  each member appears exactly `k` times.
- **P11** — assignees are byte-identical under arbitrary sets of completions and
  exceptions. (This one was originally a tautology that called `assigneeFor`
  twice with identical arguments; it is now a projector-level property, which is
  the only level at which completions exist.)
- **P12** — adding a skip changes no other occurrence's assignee.
- **P13** — a reschedule preserves the assignee, and disturbs nobody else's turn.
- **P14** — appending a segment changes no assignee before its effective date.
