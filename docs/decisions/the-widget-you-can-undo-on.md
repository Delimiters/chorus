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

## 2. Blank space with work left to show

> "The widget also has a lot of blank space at the bottom for some reason even
> though there's more room for tasks"

`family == .systemLarge ? 7 : 3`. Two numbers cannot be right across three
families and every screen size Apple ships, and both directions fail silently:
too few wastes the space, too many clips the last row.

It is measured now, from `GeometryReader`. Subtract one row's pitch for the
"+N more" line so it is never pushed off by the rows it describes, and keep at
least one row so a very short container still shows something.

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
