# The `everyone` fan-out, the roster, and a row that vanished

**5 October 2026.** Two defects, one cause: an `everyone` chore produces *one
occurrence per member*, and nothing else in the app was written with that in
mind.

## What Jake saw

1. "Pick Up Testosterone at People's" **disappeared and reappeared in a loop**
   on his plan, making everything below it jump. Only that one chore.
2. Searching for it in the picker showed **two copies**, identical.
3. After the loop was stopped, the row was simply **gone**, and re-adding it did
   nothing.

All three are the same chore: the household's only `everyone`-assigned chore due
that day.

## What was measured, not guessed

A read-only probe of production (`/tmp/probe5-8.mjs`, signed in as Jake):

- The chore is `assignment: {kind: 'everyone'}`, `once` on 2026-10-05, three
  `timesOfDay`.
- **Exactly two plan rows existed**, one per person, each with its own correct
  subject key. No duplicates, no completions, no dismissals, no flags, no
  exceptions. The data was *right*.
- Driving the real engine over that exact fixture (`projectOccurrences` →
  `buildTodayView` → `planFor`) produced two occurrences, filed Jake's under
  `mine` and Emily's under `theirs`, and matched **both** plan entries.

So the engine was innocent and the database was clean. The bug had to be in what
the engine was *given*.

## Cause

`useOccurrences` passed `memberIds: (members.data ?? []).map((m) => m.userId)`.

That `?? []` is the bug. A fan-out produces one occurrence per member, so an
**empty roster produces no occurrences at all** — and `planFor` deliberately
drops an entry whose occurrence is missing, because a planned row with nothing
behind it cannot be ticked. The two behaviours compose into: *the roster is not
loaded* becomes *your shared work is not on your day*, silently, while the screen
otherwise looks ready.

The roster goes missing for more reasons than a first paint:

- the query errors — `data` is `undefined` while `isLoading` is already `false`;
- the household id changes, and the query key with it;
- **the read is refused by RLS, which PostgREST reports as success with no
  rows** — indistinguishable from a household of nobody at this layer.

Any of those flipping back and forth is exactly the reported flicker, and it
would hit *only* `everyone` chores, which is why one row moved and its neighbour
(a one-off assigned the ordinary way) did not.

## The fix

**`rosterWithSelf`** — the fan-out roster always contains the signed-in user.
You are necessarily a member of the household you are looking at, so this is a
no-op on every healthy read and the difference between a visible row and a
vanished one otherwise. Your housemate's copy can still be briefly absent;
yours cannot, and yours is what your plan is built from.

**The picker offers one copy — yours.** `outstanding` was
`[...view.mine, ...view.theirs, ...]`, so both fan-out copies were listed with
the same title and nothing to tell them apart. Their copy is dropped rather than
labelled, because offering it is the bug and not just the ambiguity: ticking it
finishes *their* share while yours still stands, and the row then sits on your
day wearing their name. Only fan-outs are narrowed — a chore of theirs that is
`fixed` or on a rotation stays offered, because taking something off your
housemate's hands is a real thing to want and there the occurrence *is* the work.

## What is still not proven

The roster-blanking mechanism is inferred from the code and the symptom's
exclusivity to `everyone` chores, not caught in the act on the device —
diagnosing that needed a build in Jake's hands and he was leaving. If a row ever
vanishes again, the next move is an on-screen counter of `memberIds.length`,
which would settle it in one glance.

PR #140 (the auto-fill ledger) stopped the *loop*. This stops the row from going
missing in the first place, which is what the loop was oscillating on.

## What the review caught

The first version of this fix introduced a worse bug than one of the two it
fixed, and the subagent review found it.

`horizonUpcoming` deduped **by `choreId` alone**. Both fan-out copies share a due
date, so the survivor was whichever subject sorted first — `sortForDisplay`
breaks ties on `subject` — and the new picker filter then dropped it whenever
that was the housemate's. A not-yet-due `everyone` chore became **unpickable for
exactly one of the two people**, which is precisely what the "Later" group exists
for. It would also have re-created the vanishing row for any `everyone`
occurrence living between the Today window and the picker horizon, where the
deduped horizon is the only source feeding `available`. Now keyed
`choreId::subject`, the same shape the agenda's own grouping uses.

Three more, all fixed here:

- **`locked` groups are no longer filtered.** "Already on today" exists so that
  *not in the list* means one thing; a plan row holding the other person's
  fan-out key is still drawn by the plan screen, and two such rows are in the
  database.
- **The proposal filters by ownership.** `floatingSlots` is not ownership-filtered
  — `buildTodayView` returns every floating group — so their copy of a floating
  chore reached the proposal, and accepting it wrote their work to your day. The
  paragraph directly above that code already said this must not happen.
- **No `''` stand-in for "nobody".** `dayOwner` is `string | null` and a null
  owner filters nothing rather than everything.

## Pinned by

- `useOccurrences.test.tsx` — "an 'everyone' chore when the roster read comes
  back empty": your copy is still on your day, and a healthy roster is left
  alone. Mutation-verified.
- `PlanView.test.tsx` — "an 'everyone' chore": offered once; their copy not
  offered when yours is settled; a non-fan-out chore of theirs still offered;
  **due later still offered to you whichever id sorts first**; already-on-today
  still listed while holding their copy; never proposed from their floating slot.
  Each of the last three fails when its own guard is reverted, and nothing else.

A third test — "does not invent a housemate" — was **deleted rather than kept**.
The review showed it passed with the fix reverted and could not fail under any
implementation: it asserted `view.theirs === []`, which was already true when the
fan-out produced zero occurrences. A test that cannot go red is worse than no
test, because it reads like coverage.

The picker assertions count rows as a **delta** against the screen behind the
sheet, which renders the same title — a bare total passes for the wrong reason
the first time the plan stops rendering it.
