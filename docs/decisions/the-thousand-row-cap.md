# PostgREST stops at a thousand rows and does not mention it

Jake, on build 75:

> "I added a 'Call grandma!' chore assigned to emily and tried to add it to her
> day but it is not showing up no matter how many times I add it"
>
> "i killed the app and reopened and it fixed itself" … "oh wait nvm it's
> happening again"

Both halves of that are the same bug, and the intermittency is the clue.

## What was happening

`listPlanEntries` asks for nine days of the household's plan. On the live
household that is **1,317 rows**, and PostgREST returns **1,000** — a success,
with a short array, indistinguishable from "there are only a thousand of
these". Measured directly:

```
rows the app asks for -> count: 1317 | rows returned: 1000
grandma row inside what was RETURNED: false
max position returned: 74
plan_entries total for household: 4811
```

The query is `order('position')`, so the rows lost are the ones with the
highest positions — and `nextPosition` puts a newly added chore at the end.
**So the row you just added is the first one to be dropped.** It had been
written correctly every time and read back never.

The come-and-go is the auto-fill: it writes rows all day, so how many rows sit
in the window, and which side of the cut any particular row falls on, changes
through the morning. Restarting re-rolls it.

It is also why "Here's a day" kept appearing instead of a filled plan. `planFor`
drops a plan entry whose occurrence it cannot find, so a truncated read makes a
full day look like an empty one.

## The fix: page, do not guess

`src/data/api/pages.ts` runs the query with `.range()` until a short page comes
back. No number in it can be wrong, which is the point — a `.limit(2000)` would
have fixed this household and failed the next one exactly as silently, and a
limit above the server's cap is ignored anyway.

Proved against production before and after:

```
ONE REQUEST  -> rows: 1000 | grandma visible: false
PAGED        -> rows: 1317 | distinct ids: 1317 | grandma visible: true
rows recovered that the single request lost: 317
```

Paging a short list costs **exactly one request**, the same as before, because a
page that is not full ends the loop. A list that lands exactly on a boundary
costs one extra request and returns everything, which is the right trade: the
server will not say how many rows exist without a separate count.

Every paged query now carries `.order('id')` — not for display, which every
caller re-sorts anyway, but because paging without a **total** order leaves the
sort ambiguous at a page boundary, so the row sitting there can arrive twice or
not at all. `position` alone is not unique: the live household has duplicate
positions on both plans.

Worth being precise about what that does *not* fix. This is offset paging, so a
write landing in page one between the two requests still shifts everything
after it — an auto-fill insert or a "take it off today" delete can make page two
skip a row or repeat one. Ordering stabilises a single snapshot, not a moving
one. Only keyset paging (`id=gt.<last>`) removes it entirely, and the exposure
here is one round trip on a query the auto-fill invalidates anyway, so it is
knowingly left. If plan rows ever appear to flicker on a refresh, this is the
first place to look.

## Which queries were changed, and why only those

Measured against the live household:

| table | rows |
|---|---|
| **plan_entries** | **4,811** |
| chore_completions | 571 |
| chores | 221 |
| plan_dismissals | 71 |
| routine_completions | 73 |
| chore_subtasks | 88 |
| chore_flags | 28 |
| routine_items | 28 |
| chore_subtask_ticks | 106 |
| chore_exceptions | 1 |
| chore_turns | 0 |

Only `plan_entries` is over the cap today. Paged anyway: everything whose row
count grows with **time** rather than with human effort — plan entries, plan
dismissals, chore completions, routine completions, subtask ticks, turn
overrides. One row per tick, per day, per occurrence; they all arrive at a
thousand on their own, and the failure mode when they do is worse than this
one. A completion that silently vanishes makes a finished chore read as
outstanding, and `listCompletions` truncated in *unspecified* order.

Left alone: chores, categories, notes, flags, routine items, subtasks **and
exceptions**. These grow only when somebody adds something, a two-person
household is nowhere near a thousand of any of them, and a person who has made
a thousand categories can see that they have. Exceptions are in that list
deliberately rather than by oversight — one row per hand-made skip or
reschedule, and one row live.

Two existing queries had already noticed the cap and mitigated it with an
explicit `.limit()` plus an ordering chosen so the dropped row was the least
useful one. Both are now paged, and `MAX_COMPLETIONS_PER_FETCH` is gone: the
reasoning on those was "a two-person house will not come close", and
`plan_entries` reached 4,811 on exactly such a house.

## The lesson

This is the same shape as the empty colour assets and the `Date` that rejected
every snapshot: **a layer below reported success while handing back less than it
was asked for.** No error, no log, nothing to grep. `docs/WHERE-THINGS-STAND.md`
states the habit that has caught all three as *"decode the artifact, do not read
the dashboard"*, and this one adds a corollary: **count the rows.** What found
it was asking for `{ count: 'exact' }` and comparing it against `data.length`.

That comparison is a one-line check and it is the only way the truncation is
visible from outside. Nothing in the client will ever tell you.

## Not fixed here

**The plan is enormous.** 211 rows for today across two people — 116 on Jake's,
95 on Emily's. That is the auto-fill with `auto_plan` on, which includes the
backlog by design, and it is what pushed the window past a thousand in the
first place. Paging makes it correct; it does not make a 116-item day useful.
Worth a conversation rather than a unilateral change, since the setting is
Jake's and the backlog is real work.

**The positions already written are wrong.** `nextPosition` read the truncated
list, so it has been assigning positions from a short tally for as long as the
window has been over a thousand rows. On today's plan that leaves 40 of Jake's
rows and 18 of Emily's sitting at a *higher* position than rows created after
them, and three duplicate positions between the two days. "Call Grandma!" is at
position 75 — so it becomes visible with this fix and lands in the middle of a
116-item day rather than at the bottom, which is where it was asked to go.

Nothing is lost and dragging a row still works; the order is just not the order
anybody chose. It will drift back to sensible as days roll over and new plans
are built from correct reads. Rewriting the existing positions would be a
migration over live data to fix cosmetics, which is not obviously worth it —
but it is the likely next complaint, so it is written down here rather than
waiting to be rediscovered.
