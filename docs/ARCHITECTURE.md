# Architecture

## The one rule

> **The schedule is a pure function.** Nothing about "what is due and who does
> it" is ever written to the database — only the *rule*, and *events that
> deviate from it* (completions, skips, reschedules).

Everything below follows from that. See
[ADR-0001](decisions/ADR-0001-compute-dont-materialize.md) for why, and
[POSTMORTEM-SWIFT.md](POSTMORTEM-SWIFT.md) for what happens when you don't.

## Layers

Dependencies point strictly inward. Nothing in an inner layer knows an outer one
exists.

```
  src/app/          expo-router routes, layouts, navigation guards
       ↓
  src/features/     screen-level composition (Today, ChoreForm, onboarding)
       ↓
  src/design/       tokens, theme, component primitives
  src/data/         Supabase client, TanStack Query hooks, realtime
       ↓
  src/core/         ★ the scheduling engine — pure, synchronous, dependency-free
```

### `src/core` — the purity boundary

`src/core` may not import React, React Native, Expo, Supabase, TanStack Query,
or Zustand. It may not import from `data/`, `design/`, `features/`, or `app/`.
It may not use `Date`, `Date.now()`, or `Math.random()`.

This is enforced by `no-restricted-imports`, `no-restricted-globals`, and
`no-restricted-syntax` rules in `eslint.config.js` — violating any of them fails
the build.

Three things follow, and all three are the point:

1. **Tests run in ~1 second** under plain Node with no jest preset, no mocks, and
   no renderer. That is what makes a 95% coverage gate practical rather than
   aspirational.
2. **The engine is deterministic.** Given the same inputs it produces the same
   output on any machine, in any timezone, at any wall-clock time. CI proves this
   by running the whole suite under four timezones and requiring identical
   results.
3. **It can be redeployed unchanged.** If server-side push digests ever need to
   know what's due, the same TypeScript compiles into a Supabase Edge Function
   (Deno) with no refactor. This is a deliberate, load-bearing property.

```
src/core/
  civil/          CivilDate arithmetic — pure integers, zero Date usage
  recurrence/     the rule union, expansion, indexing, human descriptions
  rotation/       whose turn it is, as a function of the date
  occurrence/     merges rules + completions + exceptions into a view model
  notifications/  the reminder planner (pure; the transport lives outside)
```

## Time

**Due dates are civil dates. Completions are instants.**

- Anything a human would call "a date on the calendar" — due dates, skip dates,
  reschedule targets — is a `CivilDate`: the string `'YYYY-MM-DD'`, stored as
  Postgres `date`, with no timezone attached. Ever.
- Anything that records "when did this actually happen" —
  `chore_completions.completed_at`, all `created_at` — is a `timestamptz`.

"Today" is computed in exactly one place, at the app edge, from the household's
IANA timezone:

```ts
new Intl.DateTimeFormat('en-CA', { timeZone }).format(now); // -> 'YYYY-MM-DD'
```

and then **passed into the engine as a parameter**. The engine never reads a
clock. Time travel in tests is therefore free — you pass a different string.

If two housemates are in different timezones, the *household's* timezone decides
what "today" means. That's the right answer for a shared chore list, but it is a
deliberate choice rather than an accident.

## Data flow

```
Supabase ──> TanStack Query ──┐
  (chores, completions,       ├──> projectOccurrences()  ──> screens
   exceptions)                │         (pure, in useMemo)
Household calendar config ────┘
```

**There is deliberately no `occurrences` query key.** Occurrences are not server
state — there is nothing to fetch. `useOccurrences(window)` composes three
queries and runs the pure projector inside a `useMemo`.

Two consequences worth naming:

- Editing a chore re-renders the entire agenda instantly, with **zero refetch**.
- Screens are testable by handing fixtures straight to the projector, with no
  network layer to mock.

Query windows are quantized to stable boundaries (whole weeks) so the query key
doesn't churn on every render and trigger refetch storms.

## Server state vs. client state

TanStack Query owns everything that lives in Postgres: chores, members,
completions, exceptions, profiles. It is never mirrored into Zustand — that
duplication is exactly how the previous attempt's data layer rotted.

Zustand is used in precisely three places, each because the state must be
readable **outside React**:

| Store | Why it exists |
|---|---|
| `sessionStore` | `{ session, userId, activeHouseholdId }`. Read by the Supabase auth listener, the notification sync task, and the realtime subscription manager — none of which are components. |
| `uiStore` | Selected agenda date, active sheet, toast queue. Ephemeral, never persisted. |
| `choreDraftStore` | The multi-step chore wizard spans several routes; the draft must survive navigation. |

`sessionStore` is also the direct fix for the previous attempt's disconnected
singletons: there is one place the current user lives, it is written only by the
auth listener, and every data hook derives the household from it.

## Realtime

One channel per household, subscribed once in the authenticated layout. Handlers
are **debounced 250 ms** and then perform a broad
`invalidateQueries({ queryKey: qk.household(hid) })` — not surgical cache
patching.

This is a deliberate trade. A two-person household's entire dataset is a few
kilobytes, so refetching is cheap; surgical patching is where realtime bugs live
(partial updates diverging from server truth, races against optimistic writes).
Correctness over cleverness.

`AppState → active` triggers one invalidation to cover anything missed while
backgrounded, and TanStack Query's `focusManager`/`onlineManager` are wired to
`AppState`/`NetInfo` so refetch-on-focus behaves correctly in React Native.

## Optimistic writes

Completion toggling is optimistic: snapshot the cache, patch it, invalidate on
settle, restore on error.

What makes this safe is that the occurrence key is **computed on the client with
no I/O**, and `chore_completions` has `unique (chore_id, occurrence_key)`. A
double-tap or a retry-after-timeout produces a `23505` unique violation, which
the API layer maps to success. Un-completing is a delete by the same key — also
idempotent.

## Authorization

Enforced in Postgres by row-level security, not in the UI. Every table is
isolated by household membership through `SECURITY DEFINER` helper functions
(which also break the classic recursive-policy trap on `household_members`).

A missing client-side check therefore cannot grant access — it can only produce
a confusing empty state. See [DATA_MODEL.md](DATA_MODEL.md) for the policy
matrix.
