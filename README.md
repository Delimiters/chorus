# Chore Hero

A shared household chore app for two people. Chores recur on any schedule you can
describe, rotate fairly between housemates, and sync in real time.

Built with Expo SDK 57, React Native, TypeScript, and Supabase.

> **Status:** in active development. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for
> what works today.

## What makes it interesting

The hard part of a chore app is not the UI — it's answering _"what is due, and
whose turn is it?"_ correctly, forever, across leap years, short months, daylight
saving, and schedules nobody completes on time.

This codebase answers it with one rule:

> **The schedule is a pure function.** Nothing about what's due or who does it is
> ever written to the database — only the _rule_, and _events that deviate from
> it_ (completions, skips, reschedules).

That single decision has consequences worth reading about:

- **Editing a chore's schedule is free.** There are no materialized rows to
  reconcile, delete, or regenerate.
- **Rotation can't get stuck.** Whose turn it is derives from the date, not from
  a pointer that advances on completion — so an unfinished week still rotates.
- **"3× per week" can't silently collapse into 1×.** Each occurrence carries a
  slot index, so there is nothing to deduplicate.
- **History is honest.** "Expected vs. actual completions" replays the scheduler
  over any past window, rather than depending on whether a backfill job ran.

The scheduling engine lives in `src/core/`, which is forbidden by lint rule from
importing React, Expo, or Supabase — and from using `Date` at all. It's plain
TypeScript over `'YYYY-MM-DD'` strings and integer arithmetic, which is why it
can be property-tested to exhaustion in about a second, under four hostile
timezones in CI.

A [postmortem of the previous attempt](docs/POSTMORTEM-SWIFT.md) explains what
each of those constraints is defending against. All of them are real bugs that
shipped in a native SwiftUI version of this app.

## Features

- Households shared by invite code
- Recurrence: daily · every N days · weekly on chosen days · every N weeks ·
  N× per week (any days) · monthly by date · monthly by Nth weekday · every N
  months · N× per month · one-time (dated or "someday")
- Assignment: anyone · a specific person · take turns · everyone does their own
- Rotation cadence independent of the chore's own cadence — trash goes out
  Mon/Wed/Fri, but whose job it is flips weekly
- Complete, un-complete, skip, or reschedule a single occurrence without
  disturbing the rest of the series
- Realtime sync between housemates
- Local reminders

## Getting started

Requires Node 22+ and the Expo Go app on an iOS simulator or device.

```bash
npm install
npm start          # then press `i` for the iOS simulator
```

Copy `.env.example` to `.env.local` and fill in your Supabase project URL and
anon key.

### Development

```bash
npm run verify     # typecheck + lint + engine tests — run before committing
npm run test:core  # scheduling engine, ~1s
npm run test:watch
```

Database work additionally needs a container runtime (Colima or Docker) and the
Supabase CLI:

```bash
colima start
supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor
supabase db reset
supabase test db   # pgTAP policy tests
```

## Documentation

- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, the purity boundary, data flow
- [`RECURRENCE.md`](docs/RECURRENCE.md) — the rule union, occurrence identity, timezone strategy
- [`ROTATION.md`](docs/ROTATION.md) — turn computation, roster changes, fairness
- [`DATA_MODEL.md`](docs/DATA_MODEL.md) — schema, RLS policy matrix, indexes
- [`TESTING.md`](docs/TESTING.md) — the pyramid and the property-test catalogue
- [`ROADMAP.md`](docs/ROADMAP.md) — phases, status, what's next
- [`POSTMORTEM-SWIFT.md`](docs/POSTMORTEM-SWIFT.md) — what the previous attempt got wrong
- [`decisions/`](docs/decisions) — architecture decision records

## License

MIT
