# Chore Hero — a shared chore app for two people

## Context

Jake wants a chore app he can share with his partner: one household, chores on
arbitrary recurring schedules, assignable to one person or rotated between them.
No points/rewards system. iOS first, cross-platform eventually. Free tooling.
Public repo under `Delimiters` so hiring managers can see the work.

He attempted this before in native SwiftUI (`/Users/jake/repositories/chore-hero`).
That prototype — ~4,900 lines, **entirely uncommitted** — looks good and has a
thoughtful domain model, but it stalled at the prototype→product boundary. Its
seven concrete failures drive this entire architecture:

1. Chore occurrences were **eagerly materialized** into storage, then deduped by
   "any row already on this day" — silently collapsing "3× per week" into 1.
2. Rotation was a **mutable pointer** advanced only on completion, so an
   unfinished weekly rotation never advanced — same person stuck forever.
3. Monthly recurrence mutated date components with **no short-month clamping**
   (day 31 in February silently terminated the sequence).
4. Week start was **hardcoded to Sunday**.
5. One-time chores reported `isDueToday() == true` **forever**.
6. Auth state and the data layer were **disconnected singletons**.
7. No migrations, no backend (Supabase was stubs that threw), no version control.

Development will be largely autonomous with Jake checking in periodically, so
test coverage and green CI are the definition of done for each phase.

### Governing design rule

> **The schedule is a pure function.** Nothing about "what is due and who does it"
> is ever written to the database — only the *rule*, and *events that deviate
> from it* (completions, skips, reschedules).

Every one of failures 1–5 is a symptom of storing derived state. Making it
derived makes them structurally impossible rather than merely fixed.

## Decisions (locked)

| | |
|---|---|
| Stack | Expo SDK 57 (RN 0.86, React 19.2), expo-router, TypeScript strict |
| Backend | Supabase — auth (email+password), Postgres, RLS, Realtime |
| State | TanStack Query v5 (server state) + Zustand (session/UI/draft only) |
| Tests | Jest multi-project, `@testing-library/react-native`, fast-check, pgTAP, Maestro |
| Repo | new public `github.com/Delimiters/chore-hero` at `/Users/jake/repositories/chore-hero` |
| Design | polished custom design system, tokens, light/dark |
| v1 scope | households + chores + recurrence + rotation, local reminders, realtime sync |
| Roadmap | stats/history, remote push, widget (designed for, not built) |
| Assignment modes | anyone · specific person · take turns · **everyone does their own** |
| Short months | "the 31st" **clamps** to Feb 28/29; `skip` available as an advanced per-chore option |
| Container runtime | install Colima via Homebrew; **CI remains the source of truth for DB tests** |

**Build/dev loop constraint.** Jake's Mac is a 2018 Intel MacBook Pro. macOS Tahoe
dropped all 2018 Macs, so Xcode 26 is *permanently* unavailable, so SDK 55+ can
never be compiled locally. Therefore: develop in **Expo Go** (no compilation),
and use **free EAS cloud builds** (15 iOS/month) only when a native binary is
genuinely needed. Rebuild only when native dependencies change; e2e runs nightly
and on-demand, never per-PR.

## Phase 0 — Repo, tooling, CI, docs

1. `mv /Users/jake/repositories/chore-hero → chore-hero-swift-archive`; commit its
   working tree and push to `Delimiters/chore-hero-archive` (private) so the
   uncommitted Swift work stops being one `git clean` from oblivion.
2. `gh repo rename` the old `Delimiters/chore-hero` → `chore-hero-archive`; create
   fresh **public** `Delimiters/chore-hero`.
3. `create-expo-app` SDK 57 + expo-router. TS strict incl. `noUncheckedIndexedAccess`
   and `exactOptionalPropertyTypes`. ESLint + Prettier.
4. **The purity boundary, enforced not aspirational** — `eslint.config.js` forbids
   `src/core/**` from importing react, react-native, expo-*, @supabase/*,
   @tanstack/*, zustand, or sibling app layers. This is what makes 95% coverage on
   the engine achievable: core tests need no preset, no mocks, no renderer.
5. `jest.config.js` as three projects: `core` (plain node, ~1s, coverage-gated),
   `app` (jest-expo preset), `integration` (node + local Supabase).
6. `.github/workflows/ci.yml`: typecheck → lint → expo-doctor → `core` tests **in a
   timezone matrix** (`UTC`, `America/New_York`, `Pacific/Kiritimati`, `Pacific/Niue`)
   → `app` tests → coverage thresholds. Branch protection requires it.
7. `brew install colima docker docker-compose`; verify `supabase start` works.
8. **Spike: does `expo-notifications` local scheduling still work in Expo Go on
   SDK 57?** Expo Go's notification support has been progressively restricted since
   SDK 53. Answering this now decides whether Phase 7 costs an EAS build. Do not
   defer it to Phase 7.

*Demo:* blank themed app boots in Expo Go on the simulator; CI green.

## Phase 1 — `src/core/civil` + `src/core/recurrence`

`src/core/civil/date.ts` — ~150 lines of pure integer arithmetic, **zero use of
`Date`**. `toEpochDay`/`fromEpochDay` (Hinnant), `addDays`, `daysInMonth`,
`addMonthsClamped` (**fixes failure 3**), `weekdayOf`, `startOfWeek(d, weekStartsOn)`
(**fixes failure 4**), `weeksBetween`, `monthsBetween`, `nthWeekdayOfMonth`.

**Timezone rule:** due dates are *civil dates* (`'YYYY-MM-DD'`, Postgres `date`);
completions are *instants* (`timestamptz`). "Today" is computed in exactly one
place from `household.time_zone` and **injected into the engine as a parameter** —
`core/` never calls `Date.now()`. Time travel in tests is therefore free, and the
TZ matrix in CI retires an entire bug family for ~10 lines of YAML.

`src/core/recurrence/types.ts` — a purpose-built discriminated union, **not** the
`rrule` package. Rationale (→ `ADR-0002`): RFC 5545 can't express "3× per week,
any days" at all; its `BYMONTHDAY=31` *skips* short months with no way to opt into
clamping; and it is instant-oriented, which would reimport the exact `Date`-based
bug class we're eliminating. RRULE stays as a lossy *export* format for future
calendar interop.

```ts
type RecurrenceRule =
  | { kind: 'unscheduled' }                                              // "someday"
  | { kind: 'once'; dueOn: CivilDate; granularity: 'day'|'week'|'month' }
  | { kind: 'daily'; everyNDays: number }
  | { kind: 'weekly'; everyNWeeks: number; weekdays: readonly Weekday[] }
  | { kind: 'weeklyFloating'; everyNWeeks: number; timesPerPeriod: number }
  | { kind: 'monthlyByDay'; everyNMonths: number; dayOfMonth: number;
      overflow: 'clamp'|'skip' }
  | { kind: 'monthlyByWeekday'; everyNMonths: number; nth: NthWeek; weekday: Weekday }
  | { kind: 'monthlyFloating'; everyNMonths: number; timesPerPeriod: number };
```

Covers every shape Jake listed. Adding a variant is mechanical: `assertNever` in
each switch makes the compiler enumerate the work. Zod schema (`schema.ts`) is the
single validation point, applied on both DB read and write.

**Occurrence identity** — deterministic, computed with no I/O:
`v1:${choreId}:${periodKey}:${slot}:${subject ?? '-'}`. The `slot` index is the
direct fix for failure 1: "3× per week" yields slots 0,1,2 in period `2026-W31` —
three distinct keys that *cannot* dedupe into one. This key is the PK of
completions/exceptions and the local-notification identifier, and being
client-computable is what makes optimistic writes safe.

**Occurrence index** — O(1) arithmetic from `startsOn`, never iteration (a 3-year-old
daily chore must not cost 1,000 loop steps per render). Drives rotation.

**Window membership** — an occurrence belongs to a window iff `dueOn ∈ [start, end]`,
full stop. Floating occurrences carry `flexibleFrom`/`flexibleUntil` for display
only. This makes the window-composability property true by construction.

**Bounding:** `unscheduled` expands to `[]` always and `once` yields exactly one
occurrence at one date — so failure 5 has no mechanism to occur (there is no
`isDueToday()` heuristic anywhere). Windows are capped at 400 days and throw
loudly rather than freezing the UI.

*Demo:* `npm run schedule:preview -- '{"kind":"monthlyByDay","everyNMonths":2,"dayOfMonth":31,"overflow":"clamp"}'`
prints the next 20 dates and visibly does the right thing in February.

## Phase 2 — `src/core/rotation` + `src/core/occurrence/project`

Rotation is a **total pure function of `(occurrence, assignment, calendarConfig)`** —
no completions, no clock, no mutable state:

```
segment  = last s in segments where s.effectiveFrom <= occ.dueOn
turn     = floor(distance(segment.effectiveFrom, occ) / cadence.every)
assignee = segment.memberIds[(turn + segment.offset) % segment.memberIds.length]
```

Failure 2 becomes structurally impossible: the turn is a function of the *date*,
so an unfinished week still advances.

- **Rotation cadence is separate from chore cadence.** "Trash goes out Mon/Wed/Fri
  but we swap whose job it is weekly" = `weekly{weekdays:[1,3,5]}` +
  `cadence:{unit:'week', every:1}`. One-line configuration, same function.
- **Roster changes use append-only `RotationSegment`s**, not current membership.
  A partner joining/leaving appends a segment with `effectiveFrom = tomorrow`;
  past occurrences resolve against their historical segment and never change.
  (Rewriting who was responsible last month would corrupt the stats view.)
- **`everyone`** fans one occurrence out into one per member via the key's
  `subject` field.

`src/core/occurrence/project.ts` merges rule expansion + completions + exceptions
+ rotation into the `ProjectedOccurrence[]` every screen consumes. Status is
*derived*, never stored: overdue is `dueOn < today && !completed && !skipped`.

The four deviations: **complete** (row keyed by occurrence key; lateness computed,
not stored), **skip** (hidden, rotation still advances), **reschedule** (moves
`dueOn`, *retains* key/index/assignee), plus soft-delete and `endsOn`.

## Phase 3 — Supabase schema, RLS, migrations, integration tests

Tables: `profiles`, `households`, `household_members`, `household_invites`,
`chores`, `chore_completions`, `chore_exceptions`, `push_tokens`.
Migrations in `supabase/migrations/`, never edited after merge.

`chores.schedule` and `chores.assignment` are `jsonb` (8 variants with disjoint
fields would mean ~12 sparse nullable columns and an unenforceable CHECK), with
**generated columns** `schedule_kind`, `starts_on`, `ends_on` so the common filters
stay cheap and indexed.

`chore_completions` has `unique (chore_id, occurrence_key)` — this is the
idempotency guarantee that makes optimistic completion safe (double-tap or retry
yields `23505`, which the API layer maps to success).

**The recursive-RLS pitfall, addressed explicitly.** The obvious policy on
`household_members` subqueries the table it protects and aborts with
`42P17: infinite recursion`. Fix is `SECURITY DEFINER` helpers
(`is_household_member`, `is_household_admin`, `household_ids_for_current_user`)
with `set search_path = ''` + fully-qualified names (omitting this is a privilege-
escalation vector), `stable`, and `(select auth.uid())` in subselect form so
Postgres hoists it to an InitPlan instead of evaluating per row.

Invite redemption goes through a `SECURITY DEFINER` RPC `redeem_invite(code)` —
a non-member must be able to redeem a code without being able to enumerate
invites, which no table policy can express.

Index note: `household_members (user_id)` is the most load-bearing in the schema —
the helper hits it on every RLS check on every table.

**Integration tests use three clients:** `admin` (service-role, setup/teardown
*only*), `alice`, `bob`. Critically, RLS filters *silently* — so the assertion is
`data.length === 0 && error === null`, not "an error was thrown". A harness guard
fails the build if service-role appears inside any `expect()`, which is the #1 way
RLS tests pass while proving nothing. Plus pgTAP in `supabase/tests/` using
`set local request.jwt.claims` for precise in-transaction impersonation.

`db.yml` also runs `supabase db reset` (proves migrations apply from scratch) and
asserts `supabase db diff --schema public` is empty (schema-drift guard).

## Phase 4 — Auth + onboarding

Supabase client with AsyncStorage adapter, `detectSessionInUrl: false`, and
`AppState`-driven `startAutoRefresh`/`stopAutoRefresh` — omit any of the three and
sessions silently fail to refresh in background.

`sessionStore` (Zustand) holds `{ session, userId, activeHouseholdId }`, written
only by the auth listener. It must live outside React because `onAuthStateChange`,
the notification sync, and the realtime manager all read it. **This is the direct
fix for failure 6** — one store, and every data hook derives `householdId` from it.

Routes: `(auth)/sign-in|sign-up`, `(onboarding)/create-household|join-household`,
guarded `(app)/` requiring both a session and an active household. Household
timezone is inferred from the device at signup with an override in settings.

## Phase 5 — Design system + Today/Upcoming

`src/design/tokens.ts` (color/space/radius/type, light+dark), `ThemeProvider`, and
~12 primitives: Text, Button, Card, Sheet, Checkbox, Chip, Avatar,
SegmentedControl, DatePicker, ListRow, EmptyState, Skeleton, Toast. Timeboxed to
that list; further polish is Phase 8.

**There is deliberately no `occurrences` query key** — occurrences aren't server
state, there's nothing to fetch. `useOccurrences(window)` composes the chores /
completions / exceptions queries and runs the pure projector in a `useMemo`.
Consequence: editing a chore re-renders the whole agenda with zero refetch, and
screens are testable by handing fixtures to the projector. Windows are quantized
to stable boundaries so keys don't churn.

Optimistic completion: snapshot → `setQueryData` → invalidate on settle, with the
unique constraint as the safety net.

## Phase 6 — Chore CRUD + the recurrence builder

The hardest UI. `ChoreForm`, `RecurrencePicker` (all 8 kinds), `AssignmentPicker`
(4 modes + rotation cadence), `SchedulePreview` (next 5 dates — also a genuinely
useful debugging tool), Someday list, skip / reschedule / archive.

Component tests here are table-driven over **every recurrence shape Jake listed
verbatim**, asserting both the emitted `RecurrenceRule` and the human-readable
`describeSchedule` string. This is the single highest-value component test.

## Phase 7 — Realtime + local notifications + settings

Realtime: one channel per household; `onChange` is **debounced 250ms** and does a
broad `invalidateQueries` on the household key rather than surgical cache patching.
A 2-person household's entire dataset is a few KB, and surgical patching is where
realtime bugs live. Correctness over cleverness. `AppState`→active triggers one
invalidation to cover events missed while backgrounded.

Notifications: **local only in v1** — remote push needs an APNs key, which needs
the $99 Apple account Jake doesn't have yet. Local scheduling needs neither an
account nor a server and fires with the app closed. `planReminders()` is a *pure*
function in `core/` (so it's property-testable) that feeds a `NotificationTransport`
seam; adding remote push later is a new transport implementation plus a DB trigger,
with no call-site changes.

**iOS caps pending local notifications at 64** — the planner sorts by fire time,
takes the nearest 60, reserves a slot for a daily keep-alive that re-tops-up the
queue if the app goes unopened, and only schedules for the current user. This is a
documented workaround, not a fix; the real fix is remote push post-v1.

## Phase 8 — E2E, polish, release prep

Five Maestro flows: signup→household · create recurring rotating chore and verify
it lands on the right days · complete→relaunch→still complete · **skip today and
confirm the next occurrence survives** (the direct regression guard for failures
1 and 2) · partner joins by invite and sees the same chore.

Local e2e drives Expo Go; CI drives an EAS-built simulator `.app`, cached and
rebuilt only when native deps change (hash of `package.json` + `app.config.ts`).
Runs nightly + on demand, never per-PR — macOS runners bill at 10× and the EAS
free tier is 15 builds/month.

Plus app icon/splash, error boundaries, empty/loading/error states, a11y pass.

## Verification

Per phase, all green before moving on:

```bash
npm run typecheck && npm run lint     # incl. the core purity rule
npm test -- --selectProjects core     # ~1s, coverage-gated
npm test -- --selectProjects app
supabase db reset && supabase test db # pgTAP
npm test -- --selectProjects integration
```

Coverage gates: **≥95% lines and branches** on `core/recurrence`, `core/rotation`,
`core/civil`. CI runs `core` under four hostile timezones and results must be
byte-identical.

18 fast-check invariants are catalogued in `docs/TESTING.md`. The highest-value
ones: **window composability** (`expand([a,c]) === expand([a,b]) ++ expand([b+1,c])`
for any split — catches every boundary bug at once), **floating cardinality**
(every complete period has exactly `k` occurrences — kills failure 1 directly),
**rotation is completion-independent** (byte-identical under arbitrary completion
sets — kills failure 2), **monthly clamp never terminates** over 20 years (kills
failure 3), and **week-start independence** (kills failure 4).

~40 golden fixtures in `src/core/__fixtures__/recurrence-cases.json` — human-readable
`{description, schedule, window, expectedDates}` cases including every requirement
Jake stated. These are executable documentation.

End-to-end manual check at Phase 7: two simulators signed in as both partners;
complete a chore on one and watch it appear on the other within a second.

## Docs kept in-repo

`README.md` · `CLAUDE.md` (agent invariants: never import react/supabase in
`src/core`; never materialize occurrences; never use `Date` in core; never
service-role inside an assertion; EAS budget rule) · `docs/ARCHITECTURE.md` ·
`RECURRENCE.md` · `ROTATION.md` · `DATA_MODEL.md` · `TESTING.md` ·
`NOTIFICATIONS.md` · `DESIGN_SYSTEM.md` · **`ROADMAP.md`** (9 phases with
checkboxes + demo criteria, then post-v1: stats/history, remote push, widget,
chore templates, multi-household) · `OPERATIONS.md` · `POSTMORTEM-SWIFT.md` ·
`docs/decisions/ADR-0001..0006.md`.

`POSTMORTEM-SWIFT.md` maps each of the seven prototype failures to the specific
mechanism and test preventing its recurrence — it's what stops an autonomous agent
from re-deriving the same design six weeks from now.

**Stats/history needs no future schema change.** `chore_completions` is an
append-only log with `household_id`, `chore_id`, `due_on`, `completed_on`,
`completed_by`, already indexed — streaks and on-time rate are plain aggregates.
And "expected vs. actual", the interesting stat, works *only* because occurrences
are computed: you replay the pure expander over any past window and diff. In a
materialized design that number would depend on whether a backfill job ran.

## What Jake needs to do (I can't)

- Create a free Supabase account, then projects `chore-hero-dev` and
  `chore-hero-test` (I'll wire up the keys).
- Create a free Expo account for EAS builds (not needed until Phase 7/8).
- Approve `brew install colima docker docker-compose`.
- Eventually: $99/yr Apple Developer account — required for remote push and for
  TestFlight/App Store. Nothing in v1 is blocked on it.

---

## Addendum — deviations from the plan as written

Recorded as they happen, so this file stays trustworthy.

**Route directory.** The SDK 57 `create-expo-app` default template places routes
in `src/app/`, not `app/` at the repo root. We follow the template convention.
Everything else under `src/` (`core/`, `data/`, `design/`, `features/`) is as
planned.

**Swift archive.** The old `Delimiters/chore-hero` remote already contained an
unrelated React Native scaffold from Dec 2024. Rather than discard it, the Swift
prototype was pushed to `Delimiters/chore-hero-archive` on a **`swift-prototype`
branch**, with the old scaffold left on `main`. Build artifacts (85M `build/`,
50M `TestResults.xcresult/`) were gitignored rather than committed.
