# Chore Hero — agent operating instructions

A shared household chore app for two people. Expo SDK 57 + React Native + Supabase.

**Expo has changed.** Read the exact versioned docs at
<https://docs.expo.dev/versions/v57.0.0/> before writing Expo-specific code.
Do not rely on recalled API shapes.

## Start here

- `docs/PLAN.md` — the approved implementation plan, all 9 phases. Authoritative.
- `docs/ROADMAP.md` — phase checklist and current status.
- `docs/POSTMORTEM-SWIFT.md` — the 7 failures of the previous attempt and the
  specific mechanism that prevents each. **Read before touching the engine.**

## Non-negotiable invariants

These are enforced by lint and CI, not by good intentions. Each one exists
because the previous attempt at this app died on the corresponding mistake.

1. **`src/core/**` stays pure.** No React, Expo, Supabase, TanStack, or Zustand
   imports. No imports from `data/`, `design/`, `features/`, or `app/`.
   Dependencies point inward: `app → features → design/data → core`.
2. **`src/core/**` is `Date`-free.** No `new Date()`, no `Date.now()`, no
   `Math.random()`. Due dates are `CivilDate` strings (`'YYYY-MM-DD'`).
   "Today" is computed once at the app edge and passed in as a parameter.
3. **Never materialize occurrences.** The schedule is a pure function. Only the
   *rule* and *deviations from it* (completions, skips, reschedules) are stored.
   If you find yourself writing occurrence rows to the database, stop.
4. **Rotation is a pure function of the date**, never a stored pointer. An
   unfinished rotation must still advance.
5. **Never assert against the service-role client** in integration tests. It
   bypasses RLS, so the test proves nothing. `admin` is for setup/teardown only.
6. **EAS build budget: 15 iOS builds/month, free tier.** Rebuild only when native
   dependencies change. Never wire a native build into per-PR CI.

Rules 1, 2, and 5 fail the build if violated. Rules 3, 4, and 6 are on you.

## Commands

```bash
npm run verify            # typecheck + lint + engine tests — run before every commit
npm run typecheck
npm run lint              # includes the core purity boundary
npm run test:core         # engine tests, ~1s, no preset
npm run test:app          # component tests (jest-expo)
npm run test:integration  # RLS tests, needs local Supabase
npm run test:coverage     # engine coverage gate (95% lines/branches)
npm start                 # Expo dev server -> Expo Go on the simulator
```

Database (needs Colima running: `colima start`):

```bash
supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor
supabase db reset         # proves migrations apply from scratch
supabase test db          # pgTAP policy tests
```

## Definition of done, per phase

A phase is complete only when **all** of these hold:

- `npm run verify` passes locally
- CI is green on the branch (including the four-timezone engine matrix)
- Engine coverage stays at or above 95% lines and branches
- The phase's demo criterion in `docs/ROADMAP.md` actually works when run
- `docs/ROADMAP.md` is updated to reflect real status

Do not mark a phase done with failing tests, partial implementation, or an
unverified demo. If something is blocked, finish everything else and say plainly
what was left and why.

## Environment constraints

- The dev machine is a **2018 Intel MacBook Pro** on macOS Sequoia. macOS Tahoe
  dropped all 2018 Macs, so **Xcode 26 is permanently unavailable**, so SDK 55+
  can never be compiled locally. Develop in **Expo Go**; native binaries come
  from free **EAS cloud builds** only.
- No Apple Developer account yet. Remote push notifications are therefore out of
  v1 — local notifications only. Do not build APNs plumbing.
- Local Postgres runs under Colima. **CI is the source of truth for DB tests** —
  a Colima hiccup must never block progress.
