# Chorus — agent operating instructions

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
- **A retrospective review has run and its findings are triaged** (see below)
- `docs/ROADMAP.md` is updated to reflect real status

Do not mark a phase done with failing tests, partial implementation, or an
unverified demo. If something is blocked, finish everything else and say plainly
what was left and why.

## Retrospective review, after every phase

Spawn a subagent to review the phase's work with **fresh context and no stake in
defending the choices**. Ask it to be critical, to cite specific files and lines,
and to separate real defects from opinion. Then **verify its high-severity claims
yourself before acting** — a reviewer can be confidently wrong too.

This is not ceremony. The first retrospective (after Phase 4) found five real
engine defects and, more usefully, found that two of the flagship property tests
did not test what they claimed:

- The composability property — described in its own file as "*the* highest-value
  property in the suite" — compared two **empty arrays in 93.8% of runs**, because
  the generators drew `startsOn` and the window independently across a 70-year
  range. Measured, then fixed to 56% non-empty. A meta-test now guards it.
- "Rotation is completion-independent" called the function twice with **identical
  arguments** and asserted equality. That is determinism restated; it would have
  passed had the function been entirely wrong.
- Three of the five defects sat exactly where a test stepped around the
  assertion: an empty `else` branch, a missing period-count check, an omitted
  `assignee` field.

The lesson worth carrying: **a test that documents the shape of a guarantee
without checking it is worse than no test**, because it buys false confidence.
When writing a property, ask what input would make it vacuous, and assert that
the input isn't vacuous.

## Environment constraints

- The dev machine is a **2018 Intel MacBook Pro** on macOS Sequoia. macOS Tahoe
  dropped all 2018 Macs, so **Xcode 26 is permanently unavailable**, so SDK 55+
  can never be compiled locally. Develop in **Expo Go**; native binaries come
  from free **EAS cloud builds** only.
- No Apple Developer account yet. Remote push notifications are therefore out of
  v1 — local notifications only. Do not build APNs plumbing.
- Local Postgres runs under Colima. **CI is the source of truth for DB tests** —
  a Colima hiccup must never block progress.
