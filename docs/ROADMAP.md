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
| ◐ | **7 — Realtime + local notifications** | Two simulators: complete on one, appears on the other within a second; a reminder fires |
| ◐ | **8 — E2E, polish, release prep** | Green nightly Maestro run; installable dev build on a real device |

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

### Phase 7, precisely

Realtime is **verified**: a chore inserted through a second connection appeared
in an open client with no interaction. Settings and the reminder *planner* are
covered by tests, and the planner is pure, so its behaviour is checked at every
input that matters.

A reminder actually **firing on a device is not verified**, and cannot be from
this machine — it needs Expo Go or a development build on a phone, and the
notification path is the one part no test can stand in for. The phase is marked
in-progress rather than done for that reason alone.

What to check, in order, when a device is to hand:

1. Reminders permission is requested once, and denying it does not wedge the app.
2. A chore due tomorrow produces a notification at the chosen time.
3. Completing it before then means the notification does **not** arrive — this
   is the failure that would teach somebody the app's reminders are noise.
4. The keep-alive arrives a day before the queue would empty.
5. Signing out stops reminders arriving for the account you left.

### Phase 8, precisely

**Done and verified:** an error boundary (tested, including that its fallback
does not itself depend on the providers it sits above); a real app icon and
splash on the brand palette; the accessibility audit — 113 controls across five
screens, none unnamed.

**Written but never run**, because both need hardware or an Apple account:

- the five Maestro flows — the YAML parses and they are written against the
  app's real accessibility labels, but a flow is a guess until a device
  disagrees with it
- the nightly e2e workflow — needs `EXPO_TOKEN` in repository secrets and the
  two Supabase values in repository variables, and fails fast with a message
  saying so until they exist

**Known gap to a submittable build:** Apple requires in-app account deletion and
there is none. It is not a quick fix — deleting a member of a shared household
must not take their completions with them, or the other person's history
acquires holes. See docs/RELEASE.md.

## Post-v1

Ordered roughly by expected value.

- **Stats & history.** Completions per person per week, streaks, on-time rate,
  and expected-vs-actual. **No schema change needed** — `chore_completions` is
  already an append-only event log with the right columns and indexes, and
  expected-vs-actual works precisely because occurrences are computed rather
  than materialized (replay the expander over any past window and diff).
- **Sign in with Apple, and OAuth generally.** Email and password is fine for
  two people testing, and deliberately so — it needs no Apple account and no
  redirect plumbing. It is not what you want on the App Store.

  Most of the groundwork is already right: `onAuthStateChange` is
  provider-agnostic, and `sessionStore` holds a session without caring where it
  came from. Adding a provider is a button, a redirect, and a Supabase provider
  config — not a rework.

  Four things to know before starting, because each one changes a decision:

  1. **Apple's rule is conditional.** If the app offers *any* third-party
     sign-in (Google, Facebook), it must also offer Sign in with Apple. Email
     and password alone triggers no such requirement. So adding Google first,
     alone, is the one order that is not allowed.
  2. **It needs the $99/yr Apple Developer account** — the same one already
     gating TestFlight and remote push, so these three arrive together.
  3. **`detectSessionInUrl` is `false`** (src/data/supabase.ts) and must stay
     that way on native. OAuth on device is a deep link via
     `expo-auth-session`, not a URL fragment. `expo-web-browser` is already a
     dependency; `expo-apple-authentication` is not.
  4. **Hide My Email produces relay addresses.** Harmless here — the app shows
     display names beside chores and never an email — but worth knowing before
     anything is keyed on an address.

  The real work is **identity linking**: somebody who signed up with an email
  and password and later taps Sign in with Apple, with the same address, must
  land in the same account rather than a second empty household. Supabase
  supports linking, and it needs deliberate handling rather than discovery in
  production.

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
