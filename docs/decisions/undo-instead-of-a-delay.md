# Undo, instead of a delay

A completed chore used to sit still for three seconds and then sink to the
bottom of the day. It now sinks immediately, and an undo toast appears instead.

## What the delay was for, and why it went

The reasoning was decent: the tick and the jump are two pieces of feedback, and
running them together loses both — the row you just touched leaves from under
your finger before you have seen it change, and if it was the wrong row, undo
means finding it again somewhere else. So a just-ticked row was *held* in place,
long enough to see the tick land.

What that missed is where the finger is three seconds later. Jake:

> "the delay on chores jumping to the bottom after you complete them on the
> daily plan page just feels glitchy and honestly ends up making me click the
> wrong chore sometimes when I'm moving fast. I think we should just have an
> undo button pop up for a few seconds in case you didn't mean to, maybe with a
> little timer bar at the bottom of it like a reverse progress bar that shrinks
> until the popup goes away. The same way plenty of applications do it"

The hold did not remove the reflow, it **deferred** it — onto the moment you
are reaching for the next row. Working down a list quickly, that is the worst
possible time for the list to move.

## What replaced it

The row sinks at once, and `Toast` carries `Undo` for five seconds with a bar
that shrinks as the time runs out.

This answers the same worry the hold was built for — *that was the wrong row* —
and answers it better, because it never moves anything while you are still
working, and it names the chore rather than making you find it.

What is genuinely lost: you no longer watch the tick land in place. The toast
says which chore it was, which is the part that mattered.

## Details worth keeping

**One undo at a time, newest wins.** Tick three things quickly and the toast
offers to undo the third. Stacking would mean a toast that grows while you work
and an `Undo` whose target you have to read before trusting.

**Only on completing, never on un-ticking.** Un-ticking is already the undo of
a tick; offering to undo that is a loop with no bottom, and a toast appearing
when you *fix* a mistake reads as if something went wrong.

**A failure outranks an undo.** One toast, and "that didn't work" matters more
than "you can take that back".

**The bar is cosmetic; the timeout is the truth.** They are two clocks — an
`Animated.timing` and a `setTimeout` — so a dropped frame makes the bar lag
slightly and cannot change when the toast goes away.

Keeping that honest took two fixes review found. The clock is keyed on the
message text, so a second undo with an *identical label* — easy, since shared
work lands on both plans and both days are tickable from this screen —
inherited whatever was left of the first one's five seconds. Hence
`restartKey`, which is per-tick rather than per-wording; the message text still
governs for errors, where a repeated failure must not reset a toast you are
part-way through reading. And `reduceMotion` was in the dismissal effect's
dependency list, so the OS setting flipping mid-toast restarted the timer and
re-announced the message to VoiceOver — it is read through a ref now.

**No bar under Reduce Motion.** A bar whose entire content is movement has
nothing to say when it cannot move, and a static full-width line reads as a
progress bar that has stuck. The message and the action stay.

**The bar is hidden from accessibility.** VoiceOver already announces the
message and that an action is available; "72 per cent" is noise. Testing
Library skips a11y-hidden elements by default, so the test that asserts the bar
exists passes `includeHiddenElements` — which is the honest way round rather
than weakening the component.

**`partitionSettled` lost its `held` parameter**, rather than being passed an
empty set forever. A parameter that is always the same value is a lie about
what the function does, and the test that used to exercise the hold now asserts
the opposite — immediate sinking — so the behaviour is pinned in both
directions.

## Scope, and what the two screens now do differently

The plan screen only — which is where the complaint came from, and is now the
more interesting half of a deliberate difference:

| | when you tick something |
|---|---|
| **Plan** | the row sinks to the bottom of the day at once |
| **Today** | the row does not move at all until you leave the screen |

Today's hold is *stronger* than the three-second one deleted here: it pins the
row, struck through, in its original section until the screen is blurred,
released on navigation rather than on a timer. That is right for Today, which
is a list you read in sections rather than work down in order, and where a row
jumping between "mine" and "done" mid-glance is the disorienting thing.

Today already had its own undo toast — built for Emily's *"i accidentally
checked something off and it disappeared 😭"* — and keeps both it and the hold.

If the plan screen's immediacy turns out to be the wrong call, the comparison
to make is against Today rather than against the old three-second timer, which
had neither screen's virtue.
