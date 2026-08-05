# Chorus — agent operating instructions

A shared household chore app for two people. Expo SDK 54 + React Native + Supabase.

**Expo has changed.** Read the exact versioned docs at
<https://docs.expo.dev/versions/v54.0.0/> before writing Expo-specific code.
Do not rely on recalled API shapes.

**Why 54 and not 57**, since docs/PLAN.md specifies 57 and is otherwise
authoritative. SDK 57 could not run anywhere this project can reach: App Store
Expo Go supports exactly one SDK (54), and a local compile needs Swift 6.2,
which needs Xcode 26, which needs macOS Tahoe, which dropped every 2018 Mac.
SDK 54 runs in Expo Go *and* compiles locally, so the app is now installed on
two physical iPhones. Nothing in `src/` changed to get there — the engine is
plain TypeScript and the app code compiled against 54 unmodified.

This is a deliberate, temporary trade for reachable hardware. Revisit it when
an App Store release is on the table.

## Start here

- `docs/PLAN.md` — the approved implementation plan, all 9 phases. Authoritative.
- `docs/ROADMAP.md` — phase checklist and current status.
- `docs/POSTMORTEM-SWIFT.md` — the 7 failures of the previous attempt and the
  specific mechanism that prevents each. **Read before touching the engine.**
- `docs/OPERATIONS.md` — branch protection, CI settings, and how to verify them.
- `docs/WHERE-THINGS-STAND.md` — what is actually true as of the end of the
  autonomous build, as opposed to what was planned. **Read before believing the
  roadmap.**

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
npm run verify            # format + typecheck + lint + engine tests — before every commit
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

## Read the right line of the test output

`Tests: 234 passed` does **not** mean the run passed. A suite that throws while
*loading* — a missing native module, a module with a side effect at import —
reports every test in it as passing, because none of them ran:

```
Test Suites: 1 failed, 17 passed, 18 total     <- the line that matters
Tests:       225 passed, 225 total             <- the line that lies
```

Check `Test Suites:` and the exit code, not just `Tests:`. A grep for `✕|Tests:`
is blind to exactly this failure, and it let a broken suite reach CI twice.

## A red CI job is a finding, never noise

`main` is protected: nine checks must pass before anything merges, force pushes
and deletions are off, and `enforce_admins` is on. So a red **PR** now blocks
itself. The rule below is about the part protection cannot enforce.

**Check `main` after every merge.** CI runs on push to `main` as well as on pull
requests, and a failure there is invisible unless somebody looks:

```bash
gh run list --branch main --limit 5     # after every merge
gh run view <id> --log-failed           # any non-success, immediately
```

This is not hypothetical. `P9 — bounds` failed on the post-merge `main` run for
Phase 4 with a real counterexample — a one-time chore due the day before its own
`startsOn`. The PR itself had been green, because the failure was
non-deterministic and fired in one of five jobs. Nobody opened the main run. The
same defect was rediscovered two phases later, by chance, while running the
suite repeatedly for an unrelated reason. It had been failing about **one run in
four** the entire time.

Two things follow, and both are easy to get wrong:

1. **Never re-run a failed job hoping for green.** A test that fails
   intermittently is a defect report with an erratic delivery schedule. The
   non-determinism *is* the finding. Read the counterexample, reproduce it, fix
   the cause.
2. **One red job among several green ones is the signal, not an outlier.** The
   four-timezone matrix exists precisely so an environment-dependent defect has
   somewhere to show up. When it does its job, believe it. Reading "one red, four
   green" as noise defeats the entire point of running the matrix.

Prefer several small PRs per phase over one large one. More merges mean more CI
runs, which gives an intermittent failure more chances to appear and makes each
red job cheap to take seriously rather than a wall between you and the phase.

## A passing test is not evidence

Four retrospectives, four findings of the same shape. Worth stating as a rule
rather than a war story:

**Revert the fix and confirm the test fails.** If it still passes, the test is
not testing the fix.

The four, because the pattern is more convincing than the principle:

- A property compared two empty arrays in 93.8% of runs.
- A flagship assertion about floating chores used zero completions — the one
  input where the correct and broken implementations agree.
- A fix was *inert in production*: the pure function was correct, its unit tests
  passed, and the calling code composed the pipeline wrong. It type-checked,
  because the wrong type was a subtype of the right one.
- A regression test passed because its fixture's roster happened to equal the
  household membership, so a value rebuilt from scratch was byte-identical to
  one that had been preserved.

Two corollaries:

1. **Ask what would make the assertion vacuous, then check the fixture is not
   that.** The simplest fixture usually is.
2. **A defect can be invisible to every test.** Nobody could join a household
   for four phases — the invite API existed, was tested, and had no screen. Every
   test went through the layer the missing UI would have used. Some things are
   only found by using the app.

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

- The dev machine is a **2018 Intel MacBook Pro** on macOS Sequoia running Xcode
  16.4 (Swift 6.1.2). macOS Tahoe dropped all 2018 Macs, so **Xcode 26 is
  permanently unavailable**.

  **This limits SDK 57, not the machine.** The distinction matters and this file
  previously got it wrong, asserting the project "can never be compiled locally".

  - **On SDK 57**: prebuild and `pod install` succeed; the compile dies at
    `package 'apple' is using Swift tools version 6.2.0 but the installed
    version is 6.1.0`. Swift 6.2 ships only with Xcode 26. A real toolchain
    floor — do not retry it.
  - **On SDK 54** (`experiment/sdk-54`): the whole thing compiles. Verified end
    to end — Debug and Release both `BUILD SUCCEEDED` with zero errors, and the
    Release `.app` runs in the simulator **with Metro killed**, because Release
    embeds `main.jsbundle`.

  So on SDK 54 `eas build --local` works and consumes **no** EAS quota, which
  makes rule 6 non-binding there. It stays binding on SDK 57. Details and the
  code-signing caveat are in docs/RELEASE.md.
- No Apple Developer account yet. Remote push notifications are therefore out of
  v1 — local notifications only. Do not build APNs plumbing.
- Local Postgres runs under Colima. **CI is the source of truth for DB tests** —
  a Colima hiccup must never block progress.
