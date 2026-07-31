# Roadmap

Status legend: ☐ not started · ◐ in progress · ☑ done

## v1 — a chore app two people can actually share

| | Phase | Demo criterion |
|---|---|---|
| ☑ | **0 — Repo, tooling, CI, docs** | Blank themed app boots in Expo Go on the simulator; CI green |
| ☑ | **1 — Civil dates + recurrence engine** | `npm run schedule:preview` prints correct dates for every rule, including Feb 31 → Feb 28 |
| ☑ | **2 — Rotation + occurrence projector** | A pure function renders a week's agenda as text, including whose turn it is |
| ☑ | **3 — Supabase schema, RLS, migrations** | CI shows "user B cannot read household A's chores" passing; `supabase db reset` works from scratch |
| ☑ | **4 — Auth + onboarding** | Real sign-up, create a household, land on empty Today; session survives app restart |
| ☑ | **5 — Design system + Today/Upcoming** | Seeded chores appear on the right days; tap to complete persists and undoes |
| ☑ | **6 — Chore CRUD + recurrence builder** | Every recurrence shape below is creatable in-app, with the preview confirming each |
| ☐ | **7 — Realtime + local notifications** | Two simulators: complete on one, appears on the other within a second; a reminder fires |
| ☐ | **8 — E2E, polish, release prep** | Green nightly Maestro run; installable dev build on a real device |

### Recurrence shapes v1 must support

Every one of these is a named golden fixture in the engine test suite:

- Daily; every N days
- Once a week; once a week on a specific day; every N weeks
- N times per week, any days ("floating")
- Once a month; on a specific day of month; every N months; every other month
- The Nth weekday of the month ("2nd Saturday", "last Friday")
- N times per month, any days
- One-time, scheduled for a specific day / week / month
- One-time, unscheduled ("someday")

### Assignment modes v1 must support

- Anyone can do it
- A specific person
- Take turns (rotating, with a cadence independent of the chore's own cadence)
- Everyone does their own (fan-out — one checkbox per person)

## Post-v1

Ordered roughly by expected value.

- **Stats & history.** Completions per person per week, streaks, on-time rate,
  and expected-vs-actual. **No schema change needed** — `chore_completions` is
  already an append-only event log with the right columns and indexes, and
  expected-vs-actual works precisely because occurrences are computed rather
  than materialized (replay the expander over any past window and diff).
- **Remote push notifications.** Gated on a $99/yr Apple Developer account.
  "Your partner completed X", nudges, and server-side daily digests via a
  Supabase Edge Function. The `NotificationTransport` seam already exists, so
  this is a new implementation plus a DB trigger — no call-site changes.
- **Home screen widget.** Today's chores at a glance. Needs a native build.
- **Chore templates.** "Add a starter set" during onboarding.
- **Multi-household.** The schema already supports it; only the UI assumes one.
- **Android polish.** The app is cross-platform by construction but has only
  been designed against iOS so far.
- **Photo proof / notes on completion.** Supabase Storage.

## Explicitly not planned

- **Points, rewards, and redemptions.** The previous attempt built an entire
  rewards UI over stub functions returning `[]`. Not wanted here.
- **Gamification, leaderboards, streaks-as-pressure.** Two adults sharing a
  house, not a chore economy.
