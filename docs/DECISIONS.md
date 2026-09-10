# Decisions, and the ones that were reversed

Why the app is the way it is, in the cases where the code cannot say so on its
own — and especially where a later decision **overturned** an earlier one that
was argued for at length in a comment.

This exists because Jake does not read the code (*"this is a fully AI codebase
I will never read"*), so the reasoning has to survive somewhere an agent will
find it. A reversal is the dangerous case: the old argument is still sitting in
a comment somewhere sounding confident, and without a record of what changed,
the next pass re-litigates it or, worse, quietly restores it.

**Read this before undoing something that looks obviously wrong.** Several
entries below are things that *are* obviously wrong by some reasonable standard
and were asked for anyway.

Newest first.

---

## 2026-09-09 — Upcoming lost its "What's on <date>" header

**Was:** the screen opened with a display-sized title, the date beneath it, and
a `· N DONE` count. It had a comment justifying itself: the date is the thing
the list is *about*, and a list of chores with no date on it is ambiguous.

**Now:** the list starts at the sort control.

**Why:** Jake — *"this big What's on <date> header is weird and confusing.
Honestly I think we should just get rid of that header entirely. We already
know we're on the upcoming tab."* The tab bar names the screen, and the rows
carry their own dates.

**Cost:** the done-count for the day is no longer anywhere on Upcoming. Today
still has it. Nobody has asked for it back.

---

## 2026-09-10 — Flagged work leads the whole plan, and cross-section dragging stays gone

**Was:** the plan grouped into Chores and One-time tasks, each its own drag
list. Flags — the red "!!" — existed on Today only: the plan neither drew them
nor offered to set one. The entry above, from 2026-09-09, recorded losing
cross-group dragging as an accepted cost of the split.

**Now:** flagged rows are lifted out of both kinds into a leading group of their
own, and the plan's row sheet can flag and unflag. Flagging also writes a
position above everything stored for that day.

**Why:** Jake, having lived with the sections — *"I don't see a button to add
the !! on daily plan. Cells with !! should go to the top automatically."* He was
already flagging work; it simply had no effect on the screen he works off.

Lifting rather than sorting-within-a-kind, because he asked for the top of the
plan and a flagged task buried under eleven chores because it happens to be a
task is not that. Confirmed with him directly rather than guessed.

**The cross-section drag complaint is the same cost, reported.** Jake: *"I can
no longer drag to reorder"* — meaning across the boundary; within a section it
works. That is not being restored. A one-off dragged in among the chores is
still a one-off, so the next render puts it back and the headings start lying.
The flag is now the way to promote something above everything, which is what
cross-group dragging would have been used for.

**Cost:** two mechanisms decide vertical order — the flag, and the position.
Unflagging drops a row back among the rest wherever its position puts it, which
is where the flag left it rather than where it started. That is deliberate:
where it sits is a decision since made, and lifting a flag is not a request to
undo it. It will still surprise somebody.

---

## 2026-09-09 — A one-time task can no longer be dragged among the chores

**Was:** one `DragList` per person per day, so any row could be dragged
anywhere in that day.

**Now:** two lists — Chores and One-time tasks — so dragging is within a group.

**Why:** a consequence of the split Jake asked for, not a decision taken on its
own. Two headed groups whose rows can be dragged across the heading would make
the headings lie.

**Cost:** reordering a one-off relative to a chore is gone. `positionBetween`
now averages within-group neighbours, so it can mint a position equal to a
non-group row that sorts between them; harmless only because the grouping is
applied *after* the sort, and worth remembering before anyone flattens the
lists again.

---

## 2026-09-09 — A compact row keeps its lateness marker while expanded

**Was:** a compact row showed lateness as `14d` beside the title, and swapped it
for a full "14 DAYS LATE" chip on expansion. Two presentations of one number,
chosen for emphasis: the terse one where space is scarce, the loud one where it
is not.

**Now:** `14d` in both states, and the chip is gone from compact rows. The chip
still exists for the full-height rows on Chores and Upcoming.

**Why:** the swap was the last cause of the row moving under the thumb, which
Jake reported four times. Dropping the marker on expansion handed its width back
to the title, so a two-line name became a one-line name at the exact moment of
expanding. Confirmed on the simulator by screenshot diff, and pinned by a test
that counts the marker in both states.

**Cost:** the words "days late" no longer appear anywhere on Today. The number
does, in red, and it is the part that changes. Two tests that pinned the swap
(`shows one line per chore until the row is asked for more`, `says how long it
has been waiting`) were rewritten to pin the new rule instead — worth knowing,
because they read like coverage of Jake's "lateness must keep accumulating"
request and they still are, just at a different presentation.

---

## 2026-09-09 — A new category is a draft until the chore is saved

**Was:** the "+ New" fields on the chore form ended in an "Add category" button
that created the category immediately, then selected it. Argued for as avoiding
a trip to the settings screen mid-form, which it did.

**Now:** the fields are a draft the form holds. The category is created inside
the chore's own save, and the chore is filed under the returned id. Failure
(a duplicate name) surfaces under the fields and the chore is not saved.

**Why:** Jake — *"we don't need the 'Add category' button to save it... when I
save the chore itself you can add the category and assign that chore to it."*
It also fixed something nobody had reported: backing out of a half-written chore
left the category behind in the house, created by a screen that had been
cancelled.

**Cost:** creating a category now needs a valid chore. Somebody who only wants a
category has to use the Categories screen — which is the right place for it, and
now has its own editor screen anyway.

---

## 2026-09-09 — Category is picked before Icon

**Was:** Name, Notes, Icon, Category+Priority.

**Now:** Name, Notes, Category, Icon, Priority. `CategoryAndPriorityPicker` was
split into `CategoryPicker` and `PriorityPicker` to make room.

**Why:** choosing a category adopts that category's icon. With the icon first,
that adoption happened off-screen above you. Jake — *"since icon gets auto
selected by category, you should be able to pick the category first so it can
auto select the icon and you can keep scrolling if you're good with the
default."*

---

## 2026-09-09 — Shared work lands on both plans, and the day is split by kind

**Was:** `anyone` work was claimed by whichever phone ran the auto-plan first,
so it appeared on one person's day and not the other's. That was introduced to
stop the same chore appearing twice once both days shared a screen.

**Now:** it lands on both. Taking it off your own day is how you say it is not
yours today.

**Why:** Jake — *"seems to be randomly distributing the 'Anyone can do' tasks
between us? They should all go to both of us, and if somebody's not going to do
them they can remove them from their plan."* "Randomly" was accurate: which
phone opened Chorus first that morning decided it, which is not a decision
either of them made. A shared chore on both days is not a duplicate — each row
is one person's intention.

**And the day is split** into chores and one-time tasks, with the headings shown
only when there is both kinds. One-off work started being auto-planned two days
earlier, adding 38 rows to this household's day, and a task you do once reads
nothing like the washing-up.

---

## 2026-09-08 — Settings copy describes effects, not reasoning

**Was:** hints on the Settings screen explained why defaults were chosen and
used internal vocabulary — "Off by default: both phones would buzz about the
same job", "roughly doubles the queue below", "one notification per bucket",
"Three days ahead, not thirty". There was also a "Send a test reminder" button,
a debugging affordance that shipped and stayed.

**Now:** each hint says what the setting does for the person reading it. The
test button is gone, along with `sendTestNotification` and the foreground
handler's special case for it. Sections are headed by what a change affects —
Household, Display on this phone, Notifications on this phone, Routines,
Account.

**Why:** Jake — *"things are just thrown in there with no context or headers and
have this super AI sounding descriptions that like reference specific context of
our conversations."* Notifications, the longest part of the screen, had no
heading at all.

**Two things removed rather than reworded:**

- **The "New chores" switch.** It wrote `announceNewChores`, which nothing
  reads: announcing a housemate's new chore needs a push between phones, which
  needs a paid Apple account. The preference stays in the store so the setting
  returns with the feature. A control that cannot do anything is worse than its
  absence, which this screen already believed — it hides the reminder switch
  entirely on a build that cannot schedule reminders.
- **The `MAX_PENDING` disclosure** was cut and then *restored* in the reader's
  own terms after review. It is an effect, not a rationale: past the cap, later
  reminders simply never arrive, and without a sentence saying so that is
  indistinguishable from a bug.

**What the rewrite got wrong, caught in review:** the compact-rows hint said
"tap a row", which opens the options sheet — the chevron is what expands. And
"Both of you will be reminded" was a promise a per-phone switch cannot keep.
Headings also lost the shared-versus-this-phone distinction the screen exists to
make, which is why two of them now say "on this phone".

---

## 2026-09-07 — The chores list moved to the Upcoming tab

**Was:** Today had three sub-tabs — Plan, Chores, Routines — and a separate
Upcoming tab holding a month calendar.

**Now:** Today is Plan and Routines. The Upcoming tab holds the annotated,
checkable chores list that used to be Today's middle segment. The calendar is
deleted.

**Why:** Jake — *"I currently do not use that calendar view at all for
anything, it's like not even useful to me ... I think that might be a better
experience."* Today answers "what am I doing"; Upcoming answers "what is
coming". They were competing for one tab while a whole tab sat unused.

**What it is not:** the Chores tab, which is the library. The difference is that
these rows can be ticked off and carry their category, lateness, notes and
steps. That is why this is a second list rather than a link to the first.

`MonthGrid` survives — the date picker uses it. `todayMode: 'chores'` is still
stored on both phones from before the move and now falls through to the plan.

---

## 2026-09-07 — Steps are visible on the plan without expanding

Planned rows are compact, which folds detail away, and nothing passed the
subtasks in at all — so there was no way to reach a chore's steps from the plan
even by expanding. On a day you have committed to, the steps *are* the work, so
they start open there. Elsewhere a compact row stays folded.

---

## 2026-09-07 — Lateness accumulates; "missed last N times" is gone

**Was:** lateness was measured from the occurrence on screen, so every new
recurrence reset it to zero. The history was reported separately as "missed
last 3 times" — two numbers, neither of which was how long the job had been
waiting.

**Now:** lateness runs from the start of the current run of misses, which is the
day after the last time it was actually done. A daily chore ignored for nine
days reads "9d late". The count beside it is gone; `missedBefore` is still on
the item and nothing renders it.

**Why:** Jake — *"I just want the days late to keep adding up now that the
schedule resets when you do it and counts from the last time you did it."* It
follows from completion-anchoring: if the schedule restarts when you do the job,
lateness should measure from the same point.

A run of misses now also makes the chore late even when *today's* occurrence is
merely due — otherwise a daily chore is never more than a day late however long
it is ignored.

---

## 2026-09-07 — `showFrom` is gone; Today's list has one rule

**Was:** each chore could carry a "show on the Today tab" date, from which it
appeared early. Forty-five of this household's 118 active chores had one.

**Now:** one rule for the whole list — late, due within thirty days, or undated
— with a toggle between that ("Upcoming") and everything ("All").

**Why:** Jake — *"get rid of showFrom and just have a hard and fast rule."* A
per-chore visibility knob is a setting to maintain on every chore forever; the
list can simply decide.

**What it cost, and what had to move with it:**

- The projection window went from one week forward to **six**, because thirty
  days from any day of the week needs it.
- That widening exposed two things the old narrow window hid: `view.upcoming`
  holds *every* future occurrence, so a daily chore would have contributed 42
  rows; and a floating "3× a week" chore has one group per week, so it would
  have been drawn six times. Both are now bounded — one row per chore at its
  next occurrence, and floating groups only for the period we are in.
- The same control also set **granularity** (whether a one-off is due on the
  day, that week, or that month), which is real scheduling and not visibility.
  It survives as its own control; dropping it would have silently narrowed every
  chore using it to a single day.
- `showFrom` is still *parsed* so the 45 chores carrying one keep loading, but it
  is no longer carried onto occurrences at all. "Present but unread" is how a
  dead field comes back to life.

---

## 2026-09-07 — A chore created with "put it on today" landed three times

**Bug, not a decision, but the cause is worth recording.** The queue that claims
a newly created chore matches on `choreId`, and `view.upcoming` holds *every*
future occurrence of a recurring chore inside the horizon — so ticking the box
queued today's occurrence and next week's and the one after. Three rows, each
with a different occurrence key, so neither the `unique (user_id,
occurrence_key, planned_for)` constraint nor the upsert's `ignoreDuplicates`
could collapse them. Jake deleted two by hand.

Fixed by taking the soonest occurrence per chore. The general shape — *matching
a chore id against a list that contains many occurrences of that chore* — is
worth watching for elsewhere.

---

## 2026-09-07 — Both plans are editable by either person

**Was:** the plan was yours. `plan_entries` had a household-wide `select` policy
and owner-only `insert`/`update`/`delete`, so you could see your housemate's day
and not touch it. That asymmetry was deliberate and documented: "read-only for
others is enforced in the database, not by a disabled checkbox."

**Now:** any household member may add to, reorder, or remove from either plan.

**Why:** Jake asked for it directly — *"I want to see both of our plans fully
editable by each other. I want it just to show mine and then emily's below and I
want to be able to see and edit them both."* For a two-person household that
trusts each other, the guard was protecting nothing that needed protecting, and
it made the common case ("she's out, I'll take that one off her day") impossible.

**What this costs:** there is no longer any technical statement that a plan
belongs to one person. If this app ever has households that are not couples,
this policy is the first thing to revisit — a flatshare of five is a different
trust model entirely.

**What owner-only was silently also enforcing**, and had to be replaced
explicitly: that a plan row's `user_id` is somebody *in that household*. The
foreign key points at `profiles`, i.e. every user of the app, so `user_id =
auth.uid()` plus a membership test was the only thing keeping the two together.
Without a replacement, a review planted a row on a stranger and moved another
person's row into a household its owner is not in — which disappears from both
and is a deletion in disguise. `private.is_household_member_of` now says it
outright, on insert and update.

---

## 2026-09-07 — One-off work is auto-planned

**Was:** only recurring chores were added to the day automatically. One-offs
were left for the morning proposal, on the argument that a one-off is a
*decision* and the proposal is where decisions belong.

**Now:** anything due or overdue is auto-planned, one-off included, along with
everything assigned `anyone` or `everyone`.

**Why:** Jake asked — *"I want both one time tasks that are due/overdue as well
as any chore assigned to 'Anyone' or 'Everyone does' to appear automatically in
the daily plan."*

**What this costs, measured rather than guessed:** 38 one-off chores in this
household were due or overdue on the day it shipped, the oldest three weeks old.
It takes a day from roughly 25 rows to roughly 50. **A fifty-row day is the
exact thing the plan was built to escape** — Emily's original complaint was a
wall of outstanding work she closed the app rather than face. If this needs
walking back, an age cap on one-off work is the smallest lever; the rule lives
in `src/core/plan/autoplan.ts` and is one filter.

**A consequence nobody asked for, flagged by review:** the celebration is
effectively unreachable. "That's today", the confetti and the haptic all fire on
`progress.finished`, which now requires clearing ~50 rows including one-offs
three weeks old. The finish moment was a deliberate feature — Jake asked for it
specifically — and it has been quietly switched off by a change about something
else. The age cap would restore it. **Not decided.**

---

## 2026-09-04 — A housemate's empty day is explained, not hidden

**Was:** the line offering a housemate's day only rendered when they had one.

**Now:** it renders whenever you have a housemate, and says which of three
states it is — nothing planned, some left, finished.

**Why:** with the old gate, "Emily hasn't planned today" and "this feature was
never built" were the same screen, and Jake read it the second way: *"Did you
push it? I don't see Emily's plan."*

**The thing worth knowing:** the auto-plan runs on *your device* when *you* open
the app. A housemate who has not opened Chorus has no plan at all — which is not
a decision they made. That is why the empty state shows a forecast of what will
fill their day, computed with the same `autoPlannable` that will fill it.

**Still open:** moving auto-planning server-side would make everyone's day exist
every morning regardless of who opens the app. Raised with Jake, not decided.

---

## 2026-09-02 — Late work is auto-planned, not only work due today

**Was:** only chores due *today* were added automatically, explicitly to avoid
"the wall of fifty wearing the plan's clothes."

**Now:** due or overdue.

**Why:** Jake asked. The pile the old rule feared was mostly an artefact of a
bug: interval chores were held against a fixed grid, so being three days late
meant being permanently late and the backlog only grew (fixed 2026-09-01, see
`src/core/occurrence/anchor.ts`). With completion-anchoring, "overdue" is a
handful of real things.

Still excluded, and both load-bearing: work `showFrom` has pulled forward, which
is early rather than late; and work already completed or skipped today.

---

## 2026-09-02 — The `+` button is gone from the Plan sub-tab

**Was:** a floating `+` on every screen, including Plan, where it created a new
chore.

**Now:** no floating button on Plan. Creating happens from the "add to today"
picker's first row, which also carries whatever you typed into the search.

**Why:** on Plan the `+` sat beside "Add something", which picks from chores you
already have — so the most prominent control on the screen did the rarer thing.
Jake read it exactly that way. The button is unchanged on Chores and Routines,
where nothing competes with it.

---

## Standing constraints that are not up for rediscovery

- **44pt minimum on every touchable.** Use `MIN_TARGET` from
  `src/design/tokens.ts`; never write the number. `src/design/tapTargets.test.ts`
  enforces it and runs in `npm run verify`. This was a repeated failure — see
  that file's docblock for the list.
- **Interval chores re-anchor to completion**, and the rule is window-
  independent. `src/core/occurrence/anchor.ts` documents the three separate bugs
  that came out of getting this wrong.
- **The free Apple team's signing profile expires every 7 days**, and both phones
  show "app is no longer available" when it does. The only fix is the $99
  account. Deleting `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`
  and rebuilding mints a fresh week.
