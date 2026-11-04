# The widget you can undo on, and a notification that had never fired

Five things, four of them reported by Emily and Jake using it.

## 1. Too easy to tick, impossible to un-tick

> "on the widget it's too easy to accidentally check a row, and then when she
> tried to uncheck that one she was accidentally checking other things"

Both halves are one mistake, and it is mine from build 69. The whole row was
the tap target — a 22pt-tall, full-width live button on a home screen you also
swipe and long-press — **and a finished row was deliberately not a button at
all**, on the reasoning that a filled box which does nothing is a lie.

True in isolation. Together they left an accidental tick with no way back
except tapping at it again, which hit the rows either side. Emily's experience
was the direct product of two decisions that were each defensible alone.

So, in order of what matters:

**A finished row is a button too**, running a new `UntickIntent`.
Recoverability first. The app has had an undo toast since her *"i accidentally
checked something off and it disappeared 😭"*; the home screen needed the same
thing, not a narrower target alone.

**The box ticks, the title opens the app.** The tick region is 44pt wide —
`MIN_TARGET`, and `src/design/tapTargets.test.ts` cannot see Swift, so this
note is the record — and the full height of the row, which is as much as a 22pt
row can give. The title is inert and falls through to opening the app, so most
of the row is safe to touch.

That costs 24pt of a small widget's ~130pt content width, cutting the title
from about thirteen characters to eight. That cost is exactly why the whole row
was tried in the first place. Measured against accidentally completing the
*wrong* chore, eight characters is the better trade.

### Two queues, and why

A tick inserts a completion; an un-tick deletes one. They are not opposites in
the database, so the app replays each through the mutation that already knows
how, and the widget writes them to `pendingTicks` and `pendingUnticks`.

Each intent **removes the key from the other queue** as it writes. Tick then
un-tick before the app next opens should leave nothing to replay rather than
one of each — without that the app would apply them in queue order and land
wherever that happened to put it. Un-ticks are drained first, so a failure
part-way through a batch cannot leave the mistake written and the correction
queued.

### What the undo does not cover, and what it cost to get right

Two things worth knowing, both found in review rather than on the phone.

**A skipped row is finished too.** `WidgetRow.done` is `completed || skipped`,
so a skipped chore draws a filled box — and for one round only `completed` had
a write behind the undo. The result was an undo that visibly worked and
silently reverted: the box emptied, the header count dropped, and the next
publish filled it in again. That is the mirror of the bug a finished row being
inert used to cause; **a button with no write behind it is the same lie as a
box with no button.** A skip is one row in the exceptions table, so taking it
back is a delete rather than an un-completion, and the drain branches on which.

**A tick made on the home screen keeps its slot until the app publishes.**
`markDone` rewrites `done` in place and does *not* re-sort, deliberately: the
ordering rule lives in `core/widget/snapshot.ts` and a second copy in Swift is
the drift this project has a postmortem about. So the sinking described in §4
below lands on the next app launch, not on the tap — which is the one path the
widget exists to avoid. Accepted rather than fixed, and stated here so it is
not reported as a regression.

**The queues leave one intention, not none.** Tick-then-un-tick before the app
opens leaves an *un-tick* queued, which the drain no-ops because the occurrence
is not completed. That guard is therefore load-bearing: without it the leftover
un-tick would delete a completion the other person made in the meantime. Four
comments said "nothing to replay" and have been corrected, because a reader who
believed the queues cancelled to empty would reasonably delete that guard.

## 2. Blank space with work left to show

> "The widget also has a lot of blank space at the bottom for some reason even
> though there's more room for tasks"

`family == .systemLarge ? 7 : 3`. Two numbers cannot be right across three
families and every screen size Apple ships, and both directions fail silently:
too few wastes the space, too many clips the last row.

It is measured now, from `GeometryReader`. Two off-by-ones in the first
attempt made it *worse* than the number it replaced, both silently in the
"too few" direction:

- `n` rows occupy `n * pitch − gap`, not `n * pitch` — there is no gap after
  the last one. Dividing by the pitch lost a row whenever the remainder was at
  least a row's height.
- The "+N more" line needs its own height plus one gap, about 21pt, not a whole
  28pt row pitch. Over-reserving cost a *second* row.

Together those showed **two** rows on a small or medium widget where three fit
— fewer than the hard-coded number, while fixing a complaint about empty space.
Corrected, and checked against the real content heights:

| widget | available | rows shown | occupied |
|---|---|---|---|
| small/medium, 393pt phone | 103.7 | 3 + "+N more" | 99.0 |
| small/medium, 16 Pro | 107.7 | 3 + "+N more" | 99.0 |
| large, 354pt | 299.7 | 10 + "+N more" | 295.0 |
| large, 382pt | 327.7 | 11 + "+N more" | 323.0 |

There is no Swift test harness in this repo, so that arithmetic is checked by
hand and by reasoning rather than by a test. It is the one part of this change
that wants an eye on the actual phone.

## 3. "It seems to be random ones"

> "It also seems to be random ones, it doesn't prioritize flagged or anything"

The widget shows the first few rows, so **which few is the whole design**, and
it was plan order. Plan order is the order the day was *built* — so through a
window of three it reads as arbitrary, which is a fair description of it.

Now: outstanding before finished, flagged before the rest of outstanding. The
same precedence the lock-screen card uses, via the same `flaggedFirst` stable
partition the plan screen's sections use, so plan order survives inside each
band.

## 4. A ticked row stays for ever

> "once you check something it just stays on there indefinitely rather than
> being eventually replaced by another task"

Same cause: a row ticked at breakfast held the top of a three-row window all
day while outstanding work queued behind it. Finished rows now sink to the
bottom and fall off the end as soon as there is enough outstanding work to push
them there.

Kept rather than dropped, deliberately: the header says "2 of 5", and a widget
showing none of the two would not add up.

## 5. The notification that had never fired

`20260930090000_who_changed_your_day.sql` notifies you when your housemate puts
something on your day. Its trigger is guarded by:

```sql
if actor is null or actor = new.user_id then return new; end if;
```

…where `actor := new.added_by`. And `useAddToPlan` wrote
`addedBy: automatic ? null : userId` — where that `userId` is **the owner**,
because the variable shadows the name the removal hook uses for the actor:

```ts
const userId = ownerId ?? me;   // whose day
```

So `added_by` always equalled `user_id`, the guard always returned early, and
the feature has been unreachable since the day it shipped. Nobody noticed,
because the absence of a notification looks exactly like nothing happening.

The removal path got it right and said so, four hundred lines further down:
*"Whose day it came off is `owner`; this is who did it, and the two differing
is exactly what makes it worth telling them about."*

`added_by` records the actor now. `dropReassignedAutoRows` is unaffected — it
asks only null-or-not.

### The part worth remembering

**There was a passing database test for this all along.**
`push-notifications.test.sql` inserts a `plan_entries` row with `added_by` set
to Alice and `user_id` set to Bob, and asserts Bob gets "Alice put this on your
day." It passes, and it has always passed.

It proves the trigger works on an input **the client could not produce**. A
test that hand-writes the row under test cannot tell you whether anything ever
writes that row — and the three places that could have caught this (the
trigger's test, the hook's tests, the column's comment) each described the
intent rather than the behaviour.

The hook has tests now that assert what it actually writes: the actor on a
housemate's day, the actor on your own, and null for the fill.
