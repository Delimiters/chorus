# ADR-0005 — Local notifications in v1; remote push deferred

**Status:** accepted · **Date:** 2026-07-29

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
