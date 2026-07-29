# Testing

The shape of the test suite follows from the architecture: because the
scheduling engine is pure, almost all of the correctness budget is spent there,
where tests are fast, exhaustive, and cheap to write.

## Running things

```bash
npm run verify            # typecheck + lint + engine tests — before every commit
npm run test:core         # engine, ~3s, no preset, no mocks
npm run test:app          # component tests (jest-expo)
npm run test:integration  # RLS proofs, needs local Supabase
npm run test:coverage     # engine coverage gate
npm run test:watch
```

## The four tiers

| Tier | What | Where | Speed |
|---|---|---|---|
| **Unit + property** | The scheduling engine | `src/core/**/*.test.ts` | ~3s |
| **Integration** | RLS policies against real Postgres | `test/integration/` | ~30s |
| **Component** | Key screens and forms | `src/**/*.test.tsx` | ~5s |
| **E2E** | Five happy paths | `.maestro/` | minutes |

Deliberately *not* tested: styling, animation, navigation minutiae. The
instruction was happy-path UI coverage without bloat.

## Tier 1 — the engine

**Gate: ≥95% lines and branches, 100% functions** on `core/civil`,
`core/recurrence`, `core/rotation`, `core/occurrence`. Enforced in CI.

The `core` jest project deliberately does **not** use the `jest-expo` preset. It
runs in plain Node in about a second, which is what makes an exhaustive property
suite practical.

### The timezone matrix

CI runs the engine suite under `UTC`, `America/New_York`, `Pacific/Kiritimati`
(UTC+14), and `Pacific/Niue` (UTC−11), and requires byte-identical results. Ten
lines of YAML that permanently retire a whole class of bug — possible only
because the engine contains no `Date`.

### Property invariants

Property tests use [fast-check](https://fast-check.dev). Arbitraries live in
`src/core/__testing__/`. The P-numbers are referenced from test files.

| # | Invariant | Guards against |
|---|---|---|
| P1 | **Determinism** — same input, same output | general |
| P2 | **Window composability** — `expand([a,c]) === expand([a,b]) ++ expand([b+1,c])` for any split | *the* highest-value property; catches every off-by-one at every window edge, in every rule, at once |
| P3 | **Ordering and key uniqueness** — sorted by `(dueOn, slot)`; all keys distinct | prototype failure #1 |
| P4 | **Floating cardinality** — every complete period holds exactly `timesPerPeriod` occurrences | prototype failure #1, directly |
| P6 | **Monthly clamp never terminates** — the 31st yields one occurrence every month for 20 years | prototype failure #3 |
| P7 | **Skip semantics** — `overflow: 'skip'` omits short months without shifting any other | prototype failure #3 |
| P8 | **`once` ≤ 1, `unscheduled` = 0** over any window | prototype failure #5 |
| P9 | **Bounds** — nothing outside the window, `startsOn`, or `endsOn` | general |
| P15 | **Week-start independence** — anchored weekly rules produce the same dates under either week start | prototype failure #4 |
| P16 | **Timezone immunity** — the CI matrix above | prototype failures #3/#4 |
| P18 | **Civil arithmetic** — epoch-day round-trips; `addMonthsClamped` never yields an invalid date | prototype failure #3 |

P10–P14 (rotation) arrive with Phase 2. P17 (notification planner) with Phase 7.

### Golden fixtures

`src/core/recurrence/golden.test.ts` holds ~35 hand-written cases with their
expected dates spelled out. They are executable documentation: read them to
learn what the engine does without reading the engine.

Every recurrence shape in `ROADMAP.md` appears as a named case, and the suite
asserts that every rule kind is covered. The dates were verified against an
independent implementation rather than by recording whatever the code produced —
a golden file that only blesses current behaviour is worse than no test.

## Tier 2 — integration (RLS proofs)

Needs Postgres, which needs a container runtime:

```bash
colima start
supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor
```

The exclusion list keeps the stack light on a 2018 Intel Mac; `db`, `auth`,
`rest`, and `kong` are all the policy tests need.

**CI is the source of truth for database tests.** GitHub Actions has Docker
natively, so `supabase start` is fast and free there. Local Docker is a
convenience — a Colima hiccup must never block progress. Do not re-litigate
this; it exists so that autonomous work can proceed when the local VM misbehaves.

Two critical rules:

1. **RLS filters silently.** A blocked read returns an empty set, *not* an
   error. The assertion is therefore `data.length === 0 && error === null`.
   Asserting "an error was thrown" is a false negative that passes forever.
2. **Never assert against the service-role client.** It bypasses RLS, so the
   test proves nothing. `admin` is for setup and teardown only. A lint rule
   fails the build if `admin` appears inside an `expect()`.

Tests use three clients: `admin` (setup/teardown), `alice` (household A), and
`bob` (household B).

## Tier 3 — component

`jest-expo` + `@testing-library/react-native`, mocking at the `src/data/api/*`
boundary rather than mocking Supabase internals.

**RNTL v14 is async.** It adopted React 19's rendering model, so `render`,
`fireEvent`, `renderHook`, and `rerender` all return promises and must be
awaited:

```tsx
it('renders', async () => {
  await render(<Screen />);
  expect(screen.getByText('Chore Hero')).toBeOnTheScreen();
});
```

Forgetting the `await` fails with the thoroughly unhelpful
`render function has not been called`. If you see that message, this is why.

The highest-value component test is `RecurrencePicker`: table-driven over every
recurrence shape, asserting both the emitted `RecurrenceRule` and the
`describeSchedule` string.

## Tier 4 — E2E

Five Maestro flows (Phase 8):

1. Sign up → create household → empty Today
2. Create "trash, Mon/Wed/Fri, rotating weekly" → verify it lands on the right
   days and *not* on others
3. Complete an occurrence → relaunch → still complete
4. **Skip today's occurrence → gone from Today, next occurrence still present**
   (the regression guard for prototype failures #1 and #2)
5. Generate an invite → sign up as the partner → redeem → see the same chore

E2E runs nightly and on demand, **never per-PR**: macOS runners bill at 10× and
the simulator build consumes the EAS free-tier quota (15 iOS builds/month).
Rebuild the simulator artifact only when native dependencies change.

## CI

`ci.yml` on every push and PR:

- typecheck, lint (including the `core` purity boundary), format check
- engine tests × 4 timezones
- engine coverage gate
- component tests
- `expo-doctor`

A phase is not done until this is green.
