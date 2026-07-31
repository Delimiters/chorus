# Where things stand

Written at the end of the autonomous build, for the person picking it up. The
roadmap says what was planned; this says what is actually true.

## The short version

The app works. Two people can share a household, chores recur on every shape
that was asked for, rotation is fair and its history is safe, and the whole
agenda is computed rather than stored. 687 tests, ten of them property-based,
CI green on `main`.

Three things stand between this and a phone: **no native build has ever been
made**, **no notification has ever fired**, and **no Maestro flow has ever run**.
All three need hardware or an Apple account.

## What you can do today, in order

1. **Run it.** `npm start`, then Expo Go. Local Supabase needs `colima start`
   and `supabase start`.
2. **`eas build:configure`.** Nothing else in `docs/RELEASE.md` works until the
   project is linked — the workflow, the dev build, all of it.
3. **A development build on your phone.** The only way to test notifications.
   `docs/RELEASE.md` has the commands; `docs/ROADMAP.md` has the five checks.
4. **Run the Maestro flows.** Expect them to need fixing. They are written
   against the app's real labels and the YAML parses, but a flow is a guess
   until a device disagrees with it.

## What is genuinely finished

- **The engine.** Civil dates, eight recurrence rules, rotation, the projector,
  the agenda transformations, the reminder planner. Pure, `Date`-free, 95%+
  covered, and tested under four timezones on every push.
- **The database.** Row-level security proven by tests that assert as real
  users, never through the service role. Migrations apply from scratch on every
  CI run and a drift guard fails if the schema and the migrations disagree.
- **Every screen.** Today, Upcoming, Chores, House, Settings, the chore form,
  the occurrence sheet. All driven in a browser against real data.
- **Realtime**, verified with two clients.
- **Accessibility**, audited: 113 controls, none unnamed. See docs/TESTING.md
  for how to re-run it.

## What is missing, honestly

**In-app account deletion.** Apple requires it of any app offering signup, and
it does not exist. Not a quick fix: deleting a member of a shared household must
not take their completions with them, or the other person's history acquires
holes. That is a schema decision.

**Stats and history.** Designed for, not built. The data is all there —
`chore_completions` is an append-only log with everything a streak or an on-time
rate needs, already indexed. The interesting number, "expected versus actual",
is answerable *only* because occurrences are computed: replay the expander over
any past window and diff. In a materialised design that number would depend on
whether a backfill job ran.

**Remote push.** Local notifications cannot tell you your housemate did
something, which is the one thing worth pushing. Needs the Apple membership. The
transport seam is there so it is an implementation plus a database trigger, not
a rewrite.

## What I would tell the next person

Four retrospectives ran, each with fresh context. Every one found something real,
and the pattern is consistent enough to be worth stating plainly:

**The code was usually right. The tests were the problem.**

- Phase 5: the flagship floating assertion sat on zero completions — the one
  input where correct and broken agree.
- Phase 6: a fix was *inert in production*. The pure function was right, its
  unit tests passed, and the app composed the pipeline wrong. It type-checked.
- Phase 7: a fix did not work, and the test proving it worked passed because the
  fixture's roster happened to match the household exactly.
- Phase 8: the largest defect in the project — nobody could join a household —
  was invisible to every test, because they all went through the data layer the
  missing screen would have used.

So: **revert the fix and confirm the test fails.** Passing is not evidence. And
when a test's fixture is the simplest possible one, ask what it would take for
that fixture to make the assertion vacuous — the answer is usually "not much".

The other habit worth keeping is in AGENTS.md: read `Test Suites:`, not `Tests:`.
A suite that throws at import reports every test inside it as passing.
