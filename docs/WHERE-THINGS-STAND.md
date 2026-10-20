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

## Addendum, 30 September 2026

Four things Jake asked for after the notification work landed: Notes takes the
Chores tab's place, a badge on it for unread notes, pushes when somebody writes
or edits a note, and a weekly chore chart with backdated ticking. All four are
in. **`docs/CHORE-CHART.md` is the one to read** — it covers why four tabs and
not five, why the badge is derived rather than stored, and why a backdated tick
has to carry its own date.

Two things worth adding to the list above, because both are new shapes of the
same old lesson.

**A defect can be invisible to every test *and* to review, and still be obvious
on a screen.** Three of them were, on the chart alone: a week seeded from a
household that had not loaded yet, two of the three box states rendering
identically because `colors.overdue` is the same value as `colors.text`, and a
"today" tint that was either a one-unit colour difference or a grey block louder
than the real content. The suite was green for all three.

The cheap way to look is worth writing down. `npx expo export:embed`, copy the
result over `Chorus.app/main.jsbundle` inside the simulator's app container,
relaunch. No native rebuild, about thirty seconds, and it runs against the real
household. To land on the screen under review, temporarily point
`(tabs)/index.tsx` at it and cold-start — a deep link raises an "Open in
Chorus?" alert that needs a tap, and driving the simulator's UI from a script
needs an Accessibility grant that is not there.

**Mutation testing found a defect that review did not.** The badge cleared while
the notes board was *mounted* rather than *focused*, and a tab screen stays
mounted after you leave it — so a note arriving over realtime cleared a badge
that had never appeared. The wiring test passed with the focus effect deleted
outright, which is what gave it away. Deleting the thing under test and watching
the suite stay green is now the last step before every commit here.

## Addendum, 20 October 2026 — the identity-key bug class

Eleven changes landed between #141 and #152. Four of them were the *same bug*,
and that is the thing worth remembering from this stretch.

**Every one was an identity question answered with the wrong key.**

| Where | The key it used | The key it needed |
|---|---|---|
| `horizonUpcoming` dedupe | `choreId` | `choreId::subject` |
| the owed badge | the calendar date | the household day |
| the nag ration | the chore's due date | the date the alarm fires |
| the claim effect | whichever occurrence matched first | the one currently due |

Each read plausibly. Each type-checked. Each produced a symptom that looked
like a sync problem — a chore appearing twice in the picker, a badge counting
something 23 hours early, 36 notifications on one day, a phantom completion for
tomorrow — which is why Jake's read of it ("our system for automatically
updating the plan is causing sync issues") was reasonable and wrong.

`docs/decisions/plan-audit-2026-10-11.md` is the audit that settled it: nothing
is lost between the database and the screen, and the architecture did not need
reevaluating. Four predicates needed fixing.

**The shape to watch for:** any time a line reduces a set — a `dedupe`, a
`find`, a `Set` of ids, a per-day counter — ask out loud what *one thing* it is
claiming each key stands for, and whether that is the same thing the feature
means. An `everyone` chore is one row and N occurrences; a 3am day break means
the wall-clock date and the household day disagree for three hours a night; a
nag ladder fires on a date that is not necessarily the date the chore is due.
The mistake is never in the arithmetic, it is in the noun.

### The tests kept passing, again

Seven tests this stretch could not have failed: a roster test asserting
`view.theirs === []` (true with the fix *and* with the bug), a "loses no words"
list that passed with the words reversed and duplicated, a transport test that
stayed green with sound and interruption level stripped out entirely, a ration
test whose fixture shared one due date, a footprint test asserting a spacer
existed rather than that it was 20pt, a "folds back" test asserting a chevron
was absent rather than that the row collapsed, and clamp tests on a branch
nothing could reach.

The habit from the September addendum held up every time it was applied, so it
is now the rule rather than the suggestion: **revert the guard, watch the suite
go red, then commit.** A test written after the fix, against the fixture that
exposed the bug, is the one most likely to be vacuous — because the fixture was
chosen to be minimal, and minimal fixtures make assertions true by accident.

### Build 63 and the Time Sensitive entitlement

The nag ladder ships audible but does *not* break through Focus. Adding
`com.apple.developer.usernotifications.time-sensitive` worked at the
`app.json` → entitlements-file level and then failed at signing: builds 49–62
reused a cached profile, and adding a capability forces a new one, which needs
an Apple ID signed into Xcode. There is none here, and Xcode's cached team
record still says `isFreeProvisioningTeam = 1` / "Personal Team" despite the
membership being paid since September.

`docs/decisions/nagging-reminders.md` has the exact text of both errors and
what to click. Two warnings live there and are repeated here because both have
cost a day before: signing into Xcode has previously minted a **second**
development certificate the existing profile did not carry, which breaks local
signing until the Apple ID password is re-entered; and the same portal work
gates the widget App Group (`group.com.delimiters.chorus`), which is why
`targets/plan/` is still on an unmerged branch.
