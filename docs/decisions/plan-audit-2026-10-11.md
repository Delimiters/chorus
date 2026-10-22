# Auditing the plan against the real household

**11 October 2026.** Jake, after a run of plan bugs: *"These little issues are
having real effects on my household's ability to plan and execute chores. ... If
our system for automatically updating the plan is causing sync issues or overly
complex then reevaluate the architecture or look for bugs."*

Four separate reports in three days — a fan-out duplicate, a chore added as
*tomorrow's* occurrence, a flagged row stuck in Past due, a chore offered twice
by the picker — is enough to ask whether the design is wrong rather than the
code. So this is the answer to that question, measured rather than argued.

## What was measured

The household's whole dataset was pulled read-only — **206 chores, 425
completions, 1 exception, 1,024 plan rows** — and fed through the *real*
pipeline: `projectOccurrences` → `collapseSupersededMisses` → the lingering
one-time stream → `buildTodayView` → `planFor`, with the household's own
settings (`week_starts_on: 1`, `America/Chicago`, day break 3) and the real
windows (`quantiseWindow(today, 1, 2, 6)`, lingering 330 days back and 180
forward).

Then, for both 10 and 11 October, every plan row was classified: does the app
compute the occurrence it names, and if not, why not?

| | rows | rendered | dropped |
| --- | --- | --- | --- |
| Jake, 10 Oct | 78 | 30 | 48 — **all already completed** |
| Jake, 11 Oct | 40 | 40 | **0** |
| Emily, 10 Oct | 69 | 30 | 39 — 38 already completed, 1 ghost |

**No live work is lost on either plan.** That is the finding, and it is the one
that answers Jake's question: the projector, the collapse, the window maths, the
completion re-anchoring and `planFor`'s matching all agree with the database on
206 real chores. The architecture is not leaking rows.

Two caveats on the method, because they nearly produced false alarms:

- A first pass used **guessed** windows and reported 48 lost rows including live
  ones. The guess left a one-week gap (20–26 September) that the real window
  covers. Guessing the window produced exactly the kind of confident wrong
  answer this audit existed to rule out.
- The lingering one-time stream has to be included or every old one-off looks
  dropped. It is a second projection, deliberately outside the agenda window.

## The one real ghost

Emily had a row for "Take Progesterone in AM next 3 days" naming the occurrence
due **5 October**, while the chore's schedule now says **22 October**. Somebody
edited the due date after she planned it, so the row names an occurrence that no
longer exists and `planFor` drops it.

That is `plan.ts`'s documented behaviour — *"the chore was archived, its schedule
was edited, or the occurrence was rescheduled to another day and its key
changed"* — and the row genuinely cannot be ticked. **Left as it is**, but worth
knowing: the row disappears with nothing said, and "I planned it and it vanished"
is the complaint shape this household keeps hitting. Making it follow the chore's
current occurrence would resurrect work now due weeks away, which Jake has
explicitly rejected: *"There is no reason to add a future occurrence if it's past
due."* Telling her instead of silently dropping it is the better fix and is not
this change.

## What the bugs actually had in common

Not sync, and not the auto-fill. Every one was **an identity question answered
with the wrong key**:

| bug | asked | should have asked |
| --- | --- | --- |
| fan-out duplicate | is this key planned? | is this *chore* planned, for *this* person? |
| "get 2k rewards" | which unplanned occurrence? | which occurrence did "today" mean? |
| flagged in Past due | is it flagged *and my turn*? | is it flagged, on this day? |
| picker duplicate | same occurrence key? | same *chore*? |

Four predicates, written separately, each conflating an occurrence with a chore
or a turn with a day. That is a local mistake repeated, not a structural one — so
the fix is the four predicates, which are now fixed, and the guard is that each
has a test that fails when the wrong identity is restored.

## Stale rows, noted and not fixed

86 of the household's plan rows for 10 October name already-completed work. They
draw nothing, so they are invisible — but they inflate `position` (hence values
like 50, 62) and make the table larger than the day. Harmless, and deleting
production rows to tidy a number nobody sees is the wrong trade.
