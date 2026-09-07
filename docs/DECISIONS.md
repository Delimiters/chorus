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
