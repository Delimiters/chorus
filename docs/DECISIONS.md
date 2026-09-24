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

## 2026-09-23 — Whose turn is a stored deviation; the sheet reads a chore

**Was:** the rotation was the only answer to "whose turn is this", and the row
sheet was a list of verbs — you could not see a chore's note or steps without
opening its editor.

**Now:** `chore_turns` records a per-occurrence override, and both sheets open
with the chore's category, schedule, turn, note and steps above the actions.
Notes have working links.

**Why the override is a table and not a column:** invariant 4 — rotation is a
pure function of the date, never a stored pointer, and an unfinished rotation
must still advance. So the rotation is not edited; a *deviation from it* is
recorded, exactly as completions and skips are. Remove the row and the
rotation answers again. The previous attempt at this app died on storing the
pointer. Not a third `exception_kind` either: `chore_exceptions` has a unique
key per occurrence and a CHECK tying `moved_to` to the kind, so "skipped *and*
reassigned" would be unrepresentable, and those are independent facts.

**Not offered in two places**, both because the override would be written and
never read back: an undated chore projects no occurrence, and an `everyone`
chore is one job each, so reassigning a slot would hand two people the same
copy. That silent no-op has shipped twice on this screen already.

**What it costs:** an override is orphaned if the chore's schedule is edited or
an interval re-anchors and the occurrence key changes — the same way a
completion or a skip is, except that `anchor.ts` deliberately re-emits
occurrences that carry an *exception* and has no equivalent for turns. A turn
taken on a date that then stops existing vanishes silently. Worth knowing
before anybody debugs it as a bug.

---

## 2026-09-23 — Flagged sections are per person, and "add to today" follows the assignment

**Was:** a flagged chore led *your* Flagged section whoever it was assigned to,
and "add to today's plan" on the chore form always claimed the chore for your
own day.

**Now:** a chore that is specifically the other person's turn is not hoisted
into your Flagged group — it stays in its normal group, and leads theirs. And
creating a chore with "add to today's plan" ticked puts it on the plan of
whoever the chore is *for*.

**Why:** Jake, on noticing the plan has a Flagged group per person: *"If
something is assigned specifically to one person and is flagged it should only
show up in their flagged section."* And: *"it shouldn't autopopulate in your
plan at all if it's assigned specifically to someone else."*

The auto-fill already refused that, twice over. The path that did not was the
create form, which claims from `view.upcoming` — deliberately unfiltered by
ownership, because the picker offers everything.

**The test is `kind === 'member' && memberId !== ownerId`, not `memberId !==
ownerId`.** Shared work has no `memberId`, so the looser version drops every
`anyone` chore out of both Flagged sections. Measured: it reddens three tests.

**Also**, the auto-plan setting was called "Add the backlog too". Jake: *"Any
human sees 'Add the backlog too' and has no clue what the heck you're talking
about."* It is now "Add overdue chores", and the hint leads with what happens
regardless of the switch.

---

## 2026-09-23 — Either phone fills both plans, and auto-fill is back on

**Was:** the morning fill ran on *your* device for *your* day. A housemate who
had not opened Chorus had no plan at all. `docs/DECISIONS.md` recorded this as
raised and undecided — *"moving auto-planning server-side would make everyone's
day exist every morning regardless of who opens the app. Raised with Jake, not
decided."*

**Now:** whichever phone opens the app first plans both people's days.

**Why:** Jake, having asked before: *"I thought I asked to make it so that if
either person opens the app it goes ahead and auto populates both people's
daily plan? Seems like that still doesn't happen, if Emily hasn't opened the
app today hers is just empty."* It is the same complaint that produced the
housemate section in the first place — *"Did you push it? I don't see Emily's
plan."*

**Client-side, not server-side**, which is the other half of the open question.
A scheduled job is the better answer and needs infrastructure this project does
not have. This needs one more mutation, is idempotent by construction — it
plans only what is outstanding and not already on their day — and is correct
whenever either phone is opened, which in a two-person house is every day. If
a day ever passes with neither phone opened, nobody was looking at the plan
anyway.

Its own device-local marker (`autoPlannedTheirsOn`) rather than sharing
`autoPlannedOn`, because the two fills are separate writes that can succeed
independently: one marker would let a successful fill of your own day mark the
other as done and leave your housemate's empty all day.

**And `auto_plan` is on again**, one day after shipping off. Jake: *"I still
want you to add that don't autopopulate setting but I think we actually want to
leave autopopulate on for now. Emily reviewed everything and got everything
back onto a good schedule so we don't just have a million things overdue."*

The switch was never really about whether filling is a good idea; it was about
whether the thing being filled in was worth looking at. With the schedules
corrected, it is. The setting stays — it is the escape hatch if the backlog
ever builds again — and both the column default and the existing row flip.

---

## 2026-09-22 — Undated chores are visible, and the plan fills with today's work

**Was:** an unscheduled ("Someday") chore expanded to no occurrences, so it had
no row anywhere except the Chores library — and therefore no sheet, and
therefore no way to flag it. The Upcoming tab's own docblock claimed the list
was "late, due within thirty days, **or undated**". It never included the third.

**Now:** a "Someday" section on Upcoming, outside the scope toggle because
there is no date to filter on, built from `core/occurrence/someday.ts` so it
shares an occurrence key with the Chores tab and a tick in one place shows in
the other.

**Why:** Emily moved the house to no-date and repeating chores and the undated
half vanished. *"so if you take off the due date, you can't flag it — and it
doesn't show up on upcoming."* Both true.

**Also, and this narrows a decision from the day before.** The plan now fills
with what is due **today**, plus anything flagged — not the backlog. Emily:
*"have the my day autopopulate the flagged ones or the ones that are due that
day specifically like it's time to do dishes or this event is happening this
day."* Her "specifically" is the point: what made the plan unreadable was never
the dishes being due, it was weeks of late work arriving beside them.

So `households.auto_plan` changed meaning rather than changing sides. It used
to be "fill the plan at all"; it is now "**add the backlog too**", and the
setting is labelled that way. Yesterday's entry below says nothing fills the
plan by default; that held for about a day.

**And the plan is grouped by when, not only by kind.** Jake: *"Maybe also split
the daily plan up by due today vs past due."* "Past due" is one group below
today's work rather than a third axis crossed with Chores and One-time tasks —
that would have turned three headings into six on a screen whose founding
complaint was that it was overwhelming. Flagged work still leads, late or not:
a flag means "this one, before the rest".

**What it costs:** flagging an undated chore marks it but does not put it on
the plan, because it is not due or late and never will be. If that turns out to
be surprising, the fix is to let the flagged path take undated work too.

---

## 2026-09-22 — The plan starts empty, and auto-fill is an opt-in household setting

**Was:** everything due or late was added to each person's plan automatically
every morning — one-off tasks included, per the 2026-09-07 reversal above,
which measured the cost at 38 extra rows and a day going from about 25 items
to about 50. Argued for, twice, and written down here: "the litter box is not
a decision."

**Now:** `households.auto_plan`, `not null default false`. Nothing is added
unless the household turns it on — **except flagged work, which still lands by
itself**. A new ghost button — "Add everything due or late (N)" — does the rest
in one tap, and appears in both the empty and the started states.

**Why flags are carved out**, asked for immediately after the switch: *"if
things are flagged they should still automatically populate onto the plan but
nothing else should."* It is not an exception to the rule below, it is the
clearest instance of it. Every other row auto-fill produced came from a
schedule nobody looked at that morning; a flag is a person deciding by hand,
and flags are shared, so it is also how Emily tells Jake something needs doing
without a conversation. Making him add it again would be asking him to agree
twice. Narrowed by the same due-or-late rule, because a flag lasts until the
work is done and a chore flagged now but due in three weeks would otherwise sit
on every day in between.

**Flags could not use the existing once-a-day marker**, and finding that out is
most of the work in this change. `autoPlannedOn` is set the first time the
effect runs — including when it had nothing to add — and it exists so that
"Take off today" sticks. Under it, a chore flagged at two in the afternoon
would not have reached the plan until the next morning, which is exactly the
case the carve-out is for: a flag usually goes up *because* something has just
come up. So flagged occurrences are now recorded individually
(`autoPlannedFlags`), each added at most once a day. That keeps removal sticky
without making the flag wait for tomorrow.

**Why:** Emily's complaint, twice, was that there was too much on the plan.
Jake: *"I guess we should go back to having the plan page just start empty and
you have to add everything manually ... whatever Emily wants me to do today she
can assign me and there will be no confusion as to whether something is getting
done today or not. **If I added it to the plan I'm doing it.**"*

That last sentence is the actual reversal. The old rule was defended on the
grounds that routine work should not need deciding — which is true about the
*work* and false about the *plan*. A plan row was being used as evidence of
intention, and auto-fill put rows there that carried none, so the plan stopped
meaning anything. The count in the button label exists for the same reason:
the failure mode being fixed is volume, so the control says how much before you
commit to it.

**Why the household and not the person**, when every neighbouring preference is
per person: this one changes what a row *means* rather than how it looks. Split
answers would make the same row read as "I am doing this" on one phone and "the
app put this here" on the other, and the shared contract would be worth nothing.

**What it costs:** the two people who wanted it filled now have to turn it back
on, and the bulk-add button is offered only while the plan is still empty —
once you have chosen anything, the picker is the way to add more. If reaching
for "everything else I owe" mid-morning turns out to matter, that is a second
placement, not a rethink.

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

## 2026-09-22 — The floating + returns to the plan, doing what its position implies

**Was:** the + was removed from Today > Plan. It sat beside "Add something",
which picks from chores that already exist, and it created a *new* chore — so
the most prominent control on the screen looked like the common action and did
the rare one. Jake read it exactly that way, which is why it went.

**Now:** it is back, and it opens the form with "Add to today's plan" already
switched on.

**Why this is not a straight reversal:** the original complaint was not "there
is a + here", it was "the + makes a chore that does not end up on my plan". A
default of `plan=1` fixes the complaint rather than avoiding it, so the button
now does the thing its position implies. Jake: *"just defaultly leave that
toggle on and they can turn it off if they were just trying to make a chore
outside of the plan."*

`plan=1` is the same parameter the picker's "Create a new chore" row already
passed, so there is one code path and one behaviour.

**Cost:** two ways to add to the plan now sit on one screen — the + creates
something new, "Add something" picks what exists. That is the ambiguity the
removal was meant to end, and it is accepted on the grounds that both now put
work on the plan, which is what the position promises. The toggle is still
there to opt out.

---

## 2026-09-21 — A flag lasts until the job is done, not until Sunday

**Was:** a flag was live only while the date it was raised on fell inside the
week you were looking at. Nothing cleared it; Monday arrived and last week's
flags simply stopped being this week's. That was argued for at length and the
argument was good: no scheduler, no decision about what "Monday" means for a
household that starts its week on Sunday, expiry as a pure function of two
dates and a setting already on the household.

**Now:** a flag lives until somebody lifts it or the chore is completed. A
trigger on `chore_completions` deletes every flag on that chore.

**Why:** Jake — *"I don't like this whole 'flag it for the week' thing. It
should stay flagged until you either unflag it or it gets done."* The old rule
answered a question nobody was asking. A week is an arbitrary boundary, and the
worry that made you flag something does not end at one: the flag went quiet
while the job was still undone, which is the opposite of what it is for.

**It also closed a hole it did not open.** `completions_insert` checked that
you belonged to the household you named and that you were the completer, and
nothing about the chore — so the two columns were never required to agree. That
was inert while nothing read the pair as a boundary. The trigger is the first
thing that does: a member of one household could insert a completion carrying
their own `household_id` beside a stranger's `chore_id`, and a `security
definer` trigger scoped only by chore would have deleted that stranger's flags.
The policy now carries `chore_is_visible(chore_id)`, which `completions_select`
has always had. A first draft of this migration asserted in a comment that the
household predicate in the trigger was redundant and untestable; it was neither,
and the comment would have invited someone to remove the second lock.

**Why a trigger rather than the app:** a chore can be completed from Today,
from the plan and from the occurrence sheet. Doing the clearing in the client
means three call sites that must each remember, and a fourth the day somebody
adds a screen. It is `security definer` because the person finishing the chore
is not necessarily the person who flagged it, and `chore_flags_delete` is
`user_id = auth.uid()` — clearing only your own would leave your housemate's
"!!" on finished work, which they cannot then reach from any screen that still
lists it.

**Costs, and they are real:**

- **Unticking does not bring the flag back.** A tick clears it, and a tick you
  immediately undo has still cleared it. Restoring it would mean keeping the
  row and marking *why* it was cleared, which is a second state to reason
  about for a case that costs one tap to fix.
- **Skipping deliberately does not clear it.** "Not this time" is not "dealt
  with", and a flagged chore you have just skipped is arguably more worth
  seeing.
- **Any occurrence clears it, not the one you meant.** Flags are keyed on the
  chore, with no occurrence key, so ticking off yesterday's missed washing-up
  clears a flag raised this morning about today's. Per-occurrence flags would
  need a schema change, and "it gets done" is what was asked for — but on a
  daily chore this is the cost most likely to be noticed.
- `isFlagLive` is gone, and `liveFlagsFor` / `liveFlagsByChore` / `toggleFlag`
  no longer take a date or a week start. Five core tests about week boundaries
  were deleted rather than rewritten — there is no expiry left for them to be
  about.
- `flagged_on` stays, as a record of when rather than an expiry. Nothing reads
  it to decide anything.

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

**A correction, same day.** The position write was briefly gated on "nobody
else has flagged this", on the reasoning that a row already lifted by a
housemate's flag needs no lifting. That is wrong twice over. Flagging from
*Today* writes no position at all, so a row they flagged there is lifted while
its stored position is still mid-day — skip the write and, once both flags
lapse, it drops into the middle rather than staying where the flag put it,
losing the only thing the position is for. And the drift the gate was added to
stop does not exist: `stored` includes the row's own position, so a second
write simply makes it the minimum again — the number falls and nothing moves.
The gate is now "you are adding your flag *and* the row is not already the top
of the day", which stops the redundant write without dropping the guarantee.

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

**Superseded 2026-09-22.** Auto-planning is now off unless the household turns
it on, so nothing described here happens by default. What survives is the
*rule* — `autoPlannable` still means "due or late, one-off work included" — and
it is what both the setting and the "Add everything due or late" button use.

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
a decision they made. That is why the empty state showed a forecast of what
would fill their day, computed with the same `autoPlannable` that would fill it.

**Superseded twice since.** The forecast was removed in #105, and as of
2026-09-22 auto-filling is off unless the household turns it on — so by default
there is nothing to forecast, and the housemate's empty day now says only that
you can put something on it.

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

**Superseded 2026-09-22.** Auto-planning is now off unless the household turns
it on, so nothing described here happens by default. What survives is the
*rule* — `autoPlannable` still means "due or late, one-off work included" — and
it is what both the setting and the "Add everything due or late" button use.

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
