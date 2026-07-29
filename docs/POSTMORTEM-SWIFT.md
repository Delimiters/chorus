# Postmortem: the SwiftUI prototype

The first serious attempt at this app was a native SwiftUI project — roughly
4,900 lines, built mid-2025, abandoned that August. It is preserved at
[`Delimiters/chore-hero-archive`](https://github.com/Delimiters/chore-hero-archive)
on the `swift-prototype` branch.

It was not a bad prototype. The domain model was thoughtful, the UI looked good,
and the schedule and rotation enums showed real design intent. It died at the
boundary between prototype and product.

This document exists so that nobody — human or agent — re-derives its design six
weeks from now. Each failure is paired with the specific mechanism that makes it
impossible in the current codebase.

## The root cause

All seven failures below are the same mistake wearing different hats:

> **Scheduling state was stored and mutable, rather than derived.**

Materialized occurrence rows, a mutable rotation pointer, snapshotted assignees,
and in-place date mutation are four faces of one error. The current architecture
inverts it: *the schedule is a pure function*, and the database holds only the
rule plus events that deviate from it.

---

## 1. Materialized occurrences silently collapsed floating schedules

**What happened.** `ChoreSchedule.generateDueDates` emitted N *identical* dates
for "3 times per week" — all pinned to the start of the week. Storage then
deduped with:

```swift
let existing = choreInstances.filter {
    $0.choreId == chore.id &&
    Calendar.current.startOfDay(for: $0.dueDate) == Calendar.current.startOfDay(for: dueDate)
}
if !existing.isEmpty { continue }
```

Three occurrences went in, one came out. "3× per week" silently became "1× per
week", with no error and no visible symptom beyond the app being subtly wrong.

**Why it's impossible now.** Occurrences are never written to the database at
all. Each carries a `slot` index within its period, so "3× per week" produces
three *distinct* keys — `…:2026-W31:0:-`, `…:2026-W31:1:-`, `…:2026-W31:2:-`.
There is no dedupe step to collapse them, because there is no write.

**Guarded by.** Property P4 (floating cardinality): every complete period in an
expansion window contains exactly `timesPerPeriod` occurrences. Property P3: all
occurrence keys within a window are distinct.

## 2. Rotation used a mutable pointer advanced only on completion

**What happened.** `Chore.currentAssigneeIndex` advanced inside `rotateAssignee()`,
which was called only from the completion path. A weekly rotation that nobody
completed never advanced — the same person stayed on the hook indefinitely,
which is precisely the situation where a rotation most needs to move.

Worse, `ChoreInstance.assignedUserId` was `let`, snapshotted at row-creation
time, so an instance could never follow a later rotation even if it did advance.

**Why it's impossible now.** `assigneeFor(occurrence, assignment, calendar)` is
a total pure function of the *date*. It takes no completions, no clock, and no
mutable state. An unfinished week advances because the calendar advanced.

**Guarded by.** Property P11 (rotation is completion-independent): output is
byte-identical under arbitrary sets of completions and exceptions. Property P12:
adding a skip changes no other occurrence's assignee.

## 3. Monthly recurrence had no short-month clamping

**What happened.** The monthly branch mutated date components directly:

```swift
components.month? += frequency
```

For a chore on the 31st, `DateComponents(year: 2026, month: 2, day: 31)` resolves
to `nil`. The `while let` loop exited. The chore stopped recurring — permanently,
silently, from February onward.

**Why it's impossible now.** `src/core/civil/date.ts` is pure integer arithmetic
with no `Date` object anywhere, and `addMonthsClamped` clamps to the last valid
day of the target month. Jan 31 → Feb 28 (or 29). The per-chore `overflow`
setting makes the alternative behaviour (`'skip'`) explicit and opt-in rather
than an accident.

**Guarded by.** Property P6: `monthlyByDay{dayOfMonth: 31, overflow: 'clamp'}`
over 20 years yields exactly one occurrence per month, landing on the last day
in short months. Property P18: `addMonthsClamped` never produces an invalid date.

## 4. Week start was hardcoded to Sunday

**What happened.** The weekly branch found a week boundary by decrementing until
`weekday == 1`. Sunday, always, regardless of locale or preference.

**Why it's impossible now.** `weekStartsOn` is a household setting threaded
through `CalendarConfig` into every function that needs it. There is no default
buried in the engine.

**Guarded by.** Property P15 (week-start independence): for anchored weekly
rules the set of produced dates is identical under either week start; for
floating rules, cardinality holds under both.

## 5. One-time chores were due forever

**What happened.**

```swift
case .once:
    return true  // isDueToday()
```

A one-time chore reported itself due every day, forever, including after
completion.

**Why it's impossible now.** There is no `isDueToday()` heuristic anywhere in
the codebase. `once` expands to exactly one occurrence at exactly one date;
`unscheduled` expands to the empty list, always. "Due today" is a window query
against real occurrences, and "overdue" is derived —
`dueOn < today && !completed && !skipped` — never stored.

**Guarded by.** Property P8: `once` yields at most one occurrence over any
window; `unscheduled` yields exactly zero.

## 6. Auth state and the data layer were disconnected singletons

**What happened.** `AuthenticationState` held the signed-in user. `DataManager.shared`
held the household data, seeded with hardcoded sample users. They never met. You
logged in as "Test User" and saw the Smith family's chores. A comment in the
view layer conceded the point: *"In a real app, this would integrate with the
authentication system."*

Permission checks were disabled at three call sites with
`// For now, skip permission check in UI`, falling back to `users.first?.id` —
impersonating whoever happened to be first in the array for every mutation.

**Why it's impossible now.** One `sessionStore` holds `{ session, userId,
activeHouseholdId }`, written only by the Supabase auth listener. Every data
hook derives `householdId` from it, and the router refuses to render the app
without both. Authorization is enforced in Postgres by RLS, not in the UI —
so a missing client-side check cannot grant access.

**Guarded by.** The integration suite: user B provably cannot read, write, or
delete household A's data, and a member cannot forge a completion attributed to
their partner.

## 7. No migrations, no backend, no version control

**What happened.** Supabase was eight stub methods that threw `networkError`.
Persistence was `UserDefaults` holding JSON blobs. Documentation described a
`USE_MOCK_BACKEND` compile-time flag that had been removed from the code, and
an entire file of `DataManager` endpoints that never existed.

And all 4,900 lines sat **uncommitted** — one `git clean -fd` from oblivion —
while git simultaneously reported the original directory tree as deleted.

**Why it's impossible now.** Postgres from Phase 3, before any UI is built on
it. Migrations are files, applied from scratch in CI on every change, with a
schema-drift guard that fails if the database and the migrations disagree.
Every phase ends with a commit and green CI.

---

## The meta-lesson

The prototype's documentation confidently described features that did not exist
— endpoints "verified through successful compilation" that were never written,
a rewards screen backed by `return []`, a test-framework migration that never
happened. Docs drifted from reality because nothing checked them.

Hence: `npm run verify` before every commit, a coverage gate the engine cannot
fall below, a lint rule that enforces the architecture rather than describing
it, and demo criteria in `docs/ROADMAP.md` that must actually be run.

If a document in this repo claims something works, it should be because someone
watched it work.
