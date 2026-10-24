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
slightly and can never make the toast outlive its five seconds or vanish early.

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

## Scope

The plan screen only, which is what was asked for and where the complaint came
from. `TodayScreen` already had its own undo toast (built for Emily's *"i
accidentally checked something off and it disappeared 😭"*) and keeps it; it has
never had the hold.
