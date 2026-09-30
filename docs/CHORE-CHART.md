# The chore chart, the notes tab, and the badge

What shipped on 30 September 2026, and the reasoning that is not obvious from
the diff. Jake does not read the code, so this is where it lives.

## What he asked for

> "the note board needs to be more visible. I think maybe we take off the chores
> tab and move that into the house tab somewhere and replace it with the notes
> tab, and then have a little notification count on the tab icon when there are
> updates as well as sending notifications whenever somebody creates or updates
> a note. I also would like a chore chart that just has the list of chores and
> when they were due that week and whether they got done or not, maybe also
> allow you to check off chores from an earlier day in there in case you did it
> and just forgot to check it off and don't want to reset the cycle onto the
> wrong day or whatever. Do you think 5 tabs is too many?"

Four things. Yes, five tabs is too many — see below.

## Why four tabs and not five

Every tab currently wears the same placeholder square icon, so the **labels** do
all the work of telling them apart. A fifth drops each from roughly 98pt to 78pt
on an iPhone 14, squeezing the one thing that differentiates them.

So Chores moved to House rather than Notes being added alongside it. That is not
just a space argument: the chore library is something you open while *setting
things up*, and House is already where the reference material lives. The note
board is the opposite — it is worth seeing daily, which is the whole reason Jake
asked.

The chart went to House for the same reason. It is a thing you consult, not a
thing you work from.

**If a fifth tab is ever wanted, real icons come first.**

## The badge

There is no unread column, and there is not going to be one. Storing "who has
seen which note" means a row per person per note and a write on every glance, to
answer a question that is worth one small integer.

Instead each phone remembers the moment it last had the board open, and the
count is a comparison against the `updated_at` the list already carries. The
cost is that it does not follow you to a second phone: reading the board on an
iPad would leave the iPhone badged. That is the same trade the view and reminder
preferences already make.

Two details worth knowing:

- **Your own edits never count.** Obvious in hindsight, easy to get wrong.
- **A fresh install counts nothing.** The store seeds the moment on first
  hydrate. A "9+" on a phone that has never shown the board is noise dressed as
  news.

The badge clears **while the board is focused**, not while it is mounted. That
distinction is the one defect that got through review here: a tab screen stays
mounted after you leave it, so the first version cleared the badge the instant a
note arrived over realtime — while you were on Today, looking at the badge that
had just failed to appear. Found by mutating the guard away and noticing the
suite stayed green.

## Note notifications

Reuses the notifier the completion and plan triggers already share. Two
decisions:

- **The headline is the title, else the note's first line.** The same promotion
  the card on the board does, so the push and the row it opens agree.
- **An edit within ten minutes of the last one says nothing.** Saving twice while
  you think is one piece of news, not two.

Both are mutation-verified, along with the clause that ignores an edit changing
neither title nor body.

## The chart, and the thing it exists to prevent

> "don't want to reset the cycle onto the wrong day"

**This is a real mechanism in this codebase, not a worry.** `anchorToCompletion`
restarts an `every N days` interval from the *completion* date — that is
deliberate and Jake asked for it ("if it's every 6 days, and I complete it 3
days late, the next occurrence shouldn't happen until 6 days after I completed
it"). It means ticking Tuesday's occurrence on Friday with today's date pushes
the next one to Friday + N.

So `useToggleCompletion` takes an optional `completedOn`, clamped to today, and
each box on the chart passes its own day. Calendar rules — every Tuesday, the
15th — are unaffected either way; only intervals re-anchor.

### Why a grid rather than a list

Today and Upcoming collapse a chore's superseded misses so a neglected daily
chore cannot fill the screen. That collapse is exactly wrong here: a chore
missed on Monday and done on Tuesday is two facts, and merging them removes the
only thing the chart is for. So it reads `useOccurrences(...).items` —
uncollapsed — rather than `.agenda`.

### What the boxes mean

Three weights, not three colours:

| Box | Means |
| --- | --- |
| Filled, in somebody's ink | Done, by them |
| White with a heavy ring | Due today, not done |
| A firm grey ring | Was due, not done |
| A hairline ring | Still to come |
| A hairline ring with a dash | Skipped |
| A faint dot | Not due that day |

`colors.overdue` is deliberately the *same value* as `colors.text` — the design
system's position is that a red wash makes an ordinary Tuesday feel like an
incident. On a list that works, because lateness is spelled out beside the row.
On a grid there is no text, so the first version rendered missed and due-today
as literally the same box, and the legend showed two identical swatches. Weights
rather than a new colour keeps that decision intact.

Skipped days are not tappable. Un-skipping is a different decision from
completing, and the occurrence sheet has room to explain it. Future days are not
tappable either, because a completion in the future did not happen.

## What running it actually found

The suite was green for all three of these. They were found by building the JS
bundle, swapping it into the simulator's installed app, and looking:

1. **The week was seeded before the household arrived.** `weekStartsOn` comes
   with the household query, a render after the first, so `useState(thisWeek)`
   captured the placeholder — this house starts its week on Monday and the chart
   opened Sunday-to-Saturday, with "This week" unreachable for the life of the
   screen. The state is now an offset and the week is derived.
2. **Missed and due-today were the same box**, as above.
3. **The today column was tinted twice, wrongly.** `sunken` against `paper` is a
   one-unit difference that renders as nothing; `raised` was visible and worse,
   painting a grey block on days the chore was *not* due that outweighed every
   real box on the row.

The technique is worth keeping: `npx expo export:embed`, copy the bundle over
`Chorus.app/main.jsbundle` in the simulator container, relaunch. No native
rebuild, about 30 seconds, and it runs against the real household. Deep links
raise an "Open in Chorus?" alert that needs a tap nothing here can deliver, so
the faster route is to temporarily point `(tabs)/index.tsx` at the screen under
review and cold-start onto it.

## What is not here

- **`/stats` finally has a link.** It has existed since Phase 6 with nothing
  pointing at it — four phases of a screen nobody could reach. The chart gave it
  a neighbour on House.
- **Ticking a shared day ticks only the first share.** An `everyone` chore fans
  out to one occurrence per person, and ticking somebody else's from a grid with
  no indication whose box it was is the wrong default. Theirs is one tap away on
  the occurrence sheet.
- **A chore not due at all gets no row.** Seven blank boxes are noise, and the
  full list is one tap away on House.
