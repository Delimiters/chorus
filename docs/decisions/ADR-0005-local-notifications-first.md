# ADR-0005 — Local notifications in v1; remote push deferred

**Status:** superseded 2026-09-30 · **Date:** 2026-07-29

## Context

Reminders are the product. The tagline is "shared chores, shared reminders", and
the reason this app exists is so neither housemate has to remind the other.

But remote push on iOS requires an APNs key, which requires an Apple Developer
Program membership. There isn't one yet.

## Decision

v1 schedules **local notifications only**, from the device, planned by a pure
function over computed occurrences.

Remote push is deferred behind a `NotificationTransport` seam, so adding it later
is a new implementation plus a database trigger — not a change to any call site.

## Consequences

- No server, no account, no cost. Local notifications fire with the app closed.
- **iOS caps pending local notifications at 64.** The planner sorts by fire time,
  takes the nearest 60, and reserves a slot for a daily keep-alive that re-tops-up
  the queue if the app goes unopened. That is a workaround, not a fix, and the
  notification settings screen should say so.
- What local notifications structurally cannot do: tell you *your housemate*
  completed something. That is the main thing remote push buys, and it waits.
- The planner is pure and lives in `src/core`, so it is property-testable — "a
  completed occurrence never yields a reminder", "output never exceeds the cap",
  "output is exactly the nearest N by fire time".

## Superseded, 2026-09-30

The membership arrived on 2026-09-24 and the APNs key on the 29th, so the
deferral is spent. Remote push is live, and it does the one thing this ADR
named as structurally impossible without it — *"tell you your housemate
completed something"*.

It did **not** need the `NotificationTransport` seam this ADR built. The
sending side turned out to belong in the database: `pg_net` was already
installed, so a trigger on `chore_completions` and on `chores` posts straight
to Expo. No second implementation of the transport, no edge function, no
second place to keep a secret. The seam is still the right shape for anything
the *client* schedules; it simply was not the axis this change moved along.

What the client did need was the address book — `push_tokens` had existed
unused since the first migration, exactly so enabling this would not require
one.

The 64-notification cap and everything else in **Consequences** still applies
to local reminders, which are unchanged.
