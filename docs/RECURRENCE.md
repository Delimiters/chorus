# Recurrence

The scheduling engine lives in `src/core/`. It is pure, synchronous, and free of
`Date`, React, and I/O. This document describes what it computes and why it's
shaped the way it is.

Run `npm run schedule:preview -- --examples` to see it answer for yourself.

## Time model

**Due dates are civil dates. Completions are instants.**

A `CivilDate` is the string `'YYYY-MM-DD'` — a date on a calendar, with no
timezone and no instant attached. It's what a human means by "the 3rd". Stored
as Postgres `date`.

An instant is a `timestamptz` — `completed_at`, `created_at`. It records when
something actually happened.

Mixing the two is how the previous implementation produced timezone bugs. The
engine therefore contains no `Date` at all; `src/core/civil/date.ts` is pure
integer arithmetic over epoch days, using Howard Hinnant's era-based algorithms.

"Today" is computed in exactly one place, at the app edge:

```ts
new Intl.DateTimeFormat('en-CA', { timeZone: household.time_zone }).format(new Date());
```

and passed into the engine as a parameter. The engine never reads a clock, which
is why tests can time-travel for free and why CI can run the whole suite under
`Pacific/Kiritimati` (UTC+14) and `Pacific/Niue` (UTC−11) and demand identical
results.

If two housemates are in different timezones, the **household's** timezone
decides what "today" means. That's the right answer for a shared list, but it is
a deliberate choice.

## The rule union

```ts
type RecurrenceRule =
  | { kind: 'unscheduled' }
  | { kind: 'once'; dueOn: CivilDate; granularity: 'day' | 'week' | 'month' }
  | { kind: 'daily'; everyNDays: number }
  | { kind: 'weekly'; everyNWeeks: number; weekdays: readonly Weekday[] }
  | { kind: 'weeklyFloating'; everyNWeeks: number; timesPerPeriod: number }
  | { kind: 'monthlyByDay'; everyNMonths: number; dayOfMonth: number; overflow: 'clamp' | 'skip' }
  | { kind: 'monthlyByWeekday'; everyNMonths: number; nth: NthWeek; weekday: Weekday }
  | { kind: 'monthlyFloating'; everyNMonths: number; timesPerPeriod: number };
```

| Kind | Means | Example |
|---|---|---|
| `unscheduled` | "Someday." Never expands, never appears on an agenda. | Clean out the garage, eventually |
| `once` | Exactly one occurrence, on exactly one date. | Cancel the gym membership |
| `daily` | Every N days from the anchor. | Every 3 days |
| `weekly` | Named weekdays, every N weeks. | Mon/Wed/Fri; every other Monday |
| `weeklyFloating` | N times within each Nth week, no fixed day. | 3× a week, whenever |
| `monthlyByDay` | A day-of-month, every N months. | The 15th; every other month on the 31st |
| `monthlyByWeekday` | The Nth (or last) weekday, every N months. | 2nd Saturday; last Friday |
| `monthlyFloating` | N times within each Nth month, no fixed day. | Twice a month, whenever |

`Schedule` wraps a rule with `startsOn` (the anchor, which sets the phase of
every "every N" rule and the origin of `occurrenceIndex`), an optional `endsOn`,
and an optional reminder `timeOfDay`.

Adding a variant is mechanical: add a union member, then add a case to `expand`,
`describe`, and the Zod schema. Each switch ends in `assertNever`, so the
compiler enumerates the work.

### Why not RRULE / the `rrule` package

See [ADR-0002](decisions/ADR-0002-recurrence-representation.md). Three reasons:

1. RFC 5545 **cannot express** "3× per week on any days" at all, so we'd need a
   parallel representation anyway — two systems instead of one.
2. `BYMONTHDAY=31` **skips** months without a 31st, with no way to opt into
   clamping. Clamping is what a household means by "monthly", so we'd be
   wrapping and correcting the library rather than using it.
3. `rrule` is **instant-oriented** (`DTSTART` is a `Date`), which would
   reintroduce exactly the class of timezone bug this design eliminates.

RRULE survives as a lossy *export* format for future calendar interop.

## Short months: the clamping policy

The single most important behaviour in this file.

For `monthlyByDay` with `dayOfMonth: 31`:

| Month | `overflow: 'clamp'` (default) | `overflow: 'skip'` |
|---|---|---|
| January | Jan 31 | Jan 31 |
| February | **Feb 28** (Feb 29 in leap years) | *(no occurrence)* |
| March | Mar 31 | Mar 31 |
| April | **Apr 30** | *(no occurrence)* |

`clamp` is the default because "clean the gutters monthly on the 31st" means
twelve times a year, not seven. `skip` is available per-chore for the rarer case
where the date genuinely matters.

Critically, `skip` **omits** the month rather than shifting anything: March still
lands on the 31st. And under either mode the sequence continues forever — the
previous implementation silently stopped recurring at the first February.

The chore form surfaces this with `willClamp()` rather than letting the app
quietly do something different from what was typed.

## Occurrence identity

Every occurrence has a deterministic key, computable with no I/O:

```
v1:{choreId}:{periodKey}:{slot}:{subject}
```

- **`periodKey`** — the calendar bucket: `2026-07-29` (day-anchored),
  `2026-W31` (week-floating), `2026-07` (month-floating).
- **`slot`** — 0-based index within that period. Always 0 for anchored rules.
  **This is what makes "3× per week" work**: it produces slots 0, 1, 2 in period
  `2026-W31` — three distinct keys with nothing anywhere that could merge them.
  The prototype emitted three identical dates and deduplicated by date.
- **`subject`** — member id for `everyone` fan-out chores, `-` otherwise.
- **`v1:`** — if this format ever changes, bump the version and ship a data
  migration. Completions and exceptions are stored against these keys; changing
  the format silently would orphan every one of them.

Being client-computable is what makes optimistic completion safe: the app can
write a completion before the server has ever heard of that occurrence, and
`unique (chore_id, occurrence_key)` makes retries idempotent.

Each occurrence also carries **`occurrenceIndex`** — its 0-based position in the
rule's infinite sequence, measured from `startsOn`. This is what drives rotation.

## Window membership

> An occurrence belongs to a window **if and only if** `dueOn` falls within it.

Floating occurrences also carry `flexibleFrom`/`flexibleUntil` — the range in
which they may actually be completed — but those never affect membership.

This one rule makes **window composability** true by construction:

```
expand(rule, [a, c])  ===  expand(rule, [a, b]) ++ expand(rule, [b+1, c])
```

for any split point `b`. That's the highest-value property test in the suite —
any off-by-one at any window edge, in any rule, fails it.

### Membership uses the effective date, and supersession uses the original one

A rescheduled occurrence has two dates: where the rule put it (`originalDueOn`)
and where somebody moved it (`dueOn`). Membership uses the second, so something
moved out of a window drops away and something moved in appears — which is what
a calendar should do.

The agenda's collapse rule uses the **first**, and must. Push today's dishes to
Friday and yesterday's must stay superseded: what supersedes an older occurrence
is that a newer one *was generated*, not where it subsequently ended up. Using
the effective date let yesterday's become "the latest one at or before today"
and reappear on Today — the same resurrection bug as counting only outstanding
occurrences, wearing a different hat.

**Known limitation.** The two rules meet badly at the window edge. If an
occurrence is rescheduled *past the end of the window*, the projector never emits
it, so the collapse cannot know it exists, and the previous occurrence resurfaces
as overdue. Today's window reaches about a week forward, so this needs a
reschedule of more than ~7 days to trigger. Nothing in the app can do that yet —
the reschedule UI lands in Phase 6, and this must be settled with it. The likely
fix is for the projector to emit occurrences whose *original* date is in the
window even when the effective one is not, flagged so only the collapse sees
them; that keeps composability, which is a property of rule expansion rather
than of exception application.

### Known: "every N weeks" on several days uses the anchor's week, not the calendar's

A consequence of the rule above, worth stating because it looks like a bug and
is a trade-off.

"Every 2 weeks on Monday and Wednesday", created on a Wednesday, gives:

```
Wed 29 Jul   Mon 3 Aug      <- five days apart, different calendar weeks
Wed 12 Aug   Mon 17 Aug     <- then a nine-day gap
```

The cycle is a 14-day block starting at the anchor, and the selected weekdays
are placed *within that block*. Somebody asking for "Mon and Wed of alternating
weeks" would expect the pair to sit in the same calendar week.

Fixing it means phasing the block off `startOfWeek(anchor, weekStartsOn)` —
which is exactly what Phase 1 removed, because it made "every other Tuesday"
land on different dates depending on a display preference, silently
rescheduling every biweekly chore and orphaning its completions when somebody
toggled Sunday/Monday in settings.

So: week-start independence and calendar-week grouping cannot both hold for
this rule. The current choice keeps independence, which is the one that cannot
corrupt stored data. `everyNWeeks: 1` is unaffected — consecutive blocks tile
the calendar exactly — and that is the overwhelmingly common case.

**Not decided.** If calendar grouping turns out to matter more in practice, the
honest fix is a `weekAnchor` on the rule so the choice is stored per chore
rather than read from a setting that can change underneath it.

## Bounds

Three guards keep computation finite:

1. `unscheduled` expands to `[]` always; `once` yields exactly one occurrence at
   one date. There is no `isDueToday()` heuristic anywhere — the prototype's
   version returned `true` unconditionally for one-time chores, forever.
2. Windows are capped at `MAX_WINDOW_DAYS` (400) and throw `WindowTooWideError`.
   A bug asking for ten years of daily occurrences fails loudly instead of
   freezing the UI.
3. Expansion jumps directly to the first on-cycle date at or after the window
   start via arithmetic, rather than stepping from the anchor. A three-year-old
   daily chore costs the same to render as a new one.

## Deviations from the original plan

- **`occurrenceIndexOf` was not built.** The plan called for a separate O(1)
  index function plus a property test asserting it agrees with `expand`. In
  practice `expand` already assigns `occurrenceIndex` to every occurrence it
  produces, and rotation consumes occurrences — so a second implementation would
  be duplicate logic to keep in sync for no caller. Dropped deliberately.
- **`nthWeekdayOfMonth` returns a date, not `date | null`.** The shortest month
  is 28 days, which contains exactly four of every weekday, and `NthWeek` is
  constrained to 1–4 or -1. The null case was unreachable, so it's gone rather
  than being a check every caller has to write.
