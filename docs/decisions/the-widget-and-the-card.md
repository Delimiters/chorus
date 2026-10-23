# The widget, and the card that will not go away

Two surfaces, one mechanism. Jake asked for both:

> "did we ever get those widgets in?"
>
> "Okay and can We make like a time sensitive activity? Like where it's
> persistent and sits on your notifications?"

The second is a **Live Activity**, and it is the honest answer to the thing the
nag ladder can only approximate. A notification is an *event*: it arrives, and
then it is in a list you have to go and look at. "Keep asking until it's done"
is a *state*, and a Live Activity is the only thing iOS gives a third-party app
that holds one — it sits on the lock screen, it carries a button that completes
the chore without opening the app, and it does not stack up six copies of
itself.

## Why there is a native module at all

A widget and a Live Activity each run in their own process. Neither can execute
the app's JavaScript, so neither can ask the engine what is due. The only thing
all three share is the App Group container, and nothing in Expo can reach it —
`expo-file-system` exposes the app's own sandbox, and the container path
contains a UUID that is only discoverable from native code.

So `modules/widget-bridge` exists, and does exactly five things:

| | |
|---|---|
| `writeSnapshot(json)` | the projection the app already computed, written down |
| `reloadTimelines()` | redraw now, rather than at WidgetKit's leisure |
| `pendingTicks()` | what was ticked from the home or lock screen |
| `acknowledgeTicks(keys)` | forget those, now the database has them |
| `showActivity` / `endActivities` | raise and lower the persistent card |

**It computes nothing.** The snapshot arrives as a JSON string and is written
unexamined. Anything clever on the Swift side of that file would be a second
scheduler, and the two would drift — which is what `docs/POSTMORTEM-SWIFT.md`
is a whole document about.

## The snapshot is a projection, not a database

`src/core/widget/snapshot.ts` turns what `planFor` already ordered into a flat
list: `{ id, title, done, ink, inkDark }` per row, plus a day and two counts.
No schedules, no rules, no rotation, nothing to compare dates against.

Two deliberate choices in it:

**Rows are addressed by occurrence key, never chore id.** The same chore
tomorrow is a different thing to tick. Sending a chore id would reintroduce
precisely the identity-key mistake behind four bugs in October — see the
addendum in `docs/WHERE-THINGS-STAND.md`.

**It keeps the plan's own order** rather than deriving one. The plan is an
ordering the user built deliberately; re-sorting it on the home screen would
make that ordering meaningless, and a second ordering computed from the wrong
thing is the `useOccurrences.ts:152` shape that type-checks fine and is wrong.

The card is about **the first unfinished row in that order** — the next thing
you said you would do. Not the most overdue: that would second-guess the plan.

### The card is opt-in, per chore

The first version raised one whenever anything was outstanding, which is to say
almost always. Jake, on build 69:

> "i noticed i have a persistent focus notification though even tho I didn't set
> anything up to be focused. it shouldn't just always have a focus box it should
> be something you check for certain chores"

So it is gated on `nagUntilDone` — the switch that already existed, rather than
a second one meaning almost the same thing. One checkbox, one meaning: *insist
on this until it is done.* Turning it on gets the reminder ladder, sound, the
Focus breakthrough, **and** a card on the lock screen; leaving it off gets one
quiet reminder and nothing persistent. The form's hint says all four, because
nothing else in the app does.

Within the chores that asked, **flagged ones come first** — then plan order.

> "the persistent notification should prioritize flagged chores"

A flag is raised by hand, today; the switch is a standing property of the
chore. When both apply the flag is the more recent statement of intent, so it
decides. Anybody's flag counts, which is the rule everywhere else: flagged
means flagged, not flagged-by-me.

It reuses `flaggedFirst` from `src/core/chore/flag.ts` — a **stable
partition**, so the flagged ones move to the front without scrambling their
order relative to each other, and plan order survives inside both groups. A
sort would have thrown away the ordering the user built, and a second notion of
precedence living here is how two views of one list start disagreeing.

**Flagging is not a second way in.** The switch still decides whether there is
a card at all; the flag only decides which of the candidates it is about. A
flagged chore with the switch off gets nothing, which is what keeps the
opt-in promise above honest.

The counts describe the **whole** plan — "2 of 5 done · 3 left"
is the useful context, and a card counting only insistent chores would
disagree with the app on the same screen.

`activityState` takes `planned` directly rather than a `WidgetSnapshot`, which
is what lets it see `choreId` without putting that field into the snapshot the
widget reads. Two derived views from one projection, neither computed from the
other — the `useOccurrences.ts:152` rule. An unused field in that cross-language
contract is what `writtenAt` already cost once.

## Both inks, because a widget does not know the theme

Each row carries `ink` *and* `inkDark`. `src/design/inks.ts` is explicit that
the dark variant is hand-lifted rather than algorithmically shifted — "the blue
that reads confidently on paper goes muddy against a near-black ground" — so
sending one hex and darkening it in Swift would undo the only reason the palette
is curated. The widget reads `@Environment(\.colorScheme)` and picks.

The Dynamic Island hard-codes the dark variant, correctly: it is always drawn on
the black of the sensor housing, whatever the viewer's theme.

## A tick from the lock screen goes through the app

`TickIntent` writes an occurrence key into the App Group and reloads its own
timeline, so the box fills instantly. The *real* completion happens in
`useWidgetSync`, through `useToggleCompletion` — the same mutation the app's own
checkbox uses.

Doing the Supabase write in Swift would mean a second copy of the completion
rules, and the two would disagree about exactly what this project has already
been bitten by: which day a tick belongs to under a 3am day break, and what
completing an interval chore does to its next due date.

The queue is drained on every foreground, not only on a foreground that lands on
Today — which is why `useWidgetSync` is mounted in `(app)/_layout.tsx` beside
`useReminderSync`, and not on the plan screen.

### Read, write, then forget — in that order

The first version had one native call that returned the queue **and cleared
it**. Review found it lost ticks two different ways, both silent:

- **On a cold start**, `useOccurrences` and `useMyPlanEntries` both return `[]`
  for several round trips. The drain ran on the first render, looked every key
  up against an empty list, concluded each one was archived, and dropped it. A
  tick made on the lock screen before opening the app simply vanished.
- **Offline**, mutations have `retry: 0` and `wireOnlineManager` never pauses
  them, so the completion rejected immediately and the optimistic update rolled
  back. Nothing anywhere recorded that the tap had happened.

Neither failed loudly, and the only feedback channel — the box filling in the
widget — lives in the *other* process and would never have been corrected.

So it is two calls now, `pendingTicks()` and `acknowledgeTicks(keys)`, and a key
is forgotten only once the database has it. A failed write leaves it queued and
stops the batch; the next launch tries again.

`acknowledgeTicks` removes only the keys it is given rather than clearing the
lot, so a tick made *while* a batch is replaying is not thrown away unprocessed.

Three more things the drain does that are easy to get wrong, all tested:

- **It waits for the queries.** `ready` gates on `useOccurrences`'s
  `isLoading`, `usePlanLoading`, and the household *and* members queries. The
  first version gated on `household.data` alone, which resolves several round
  trips earlier — so every cold start also published a `totalCount: 0` snapshot
  (the widget's "Nothing left today.", a confident lie) and ended a live card
  that should have stayed up.
- **A key with no occurrence behind it is acknowledged and dropped**, not
  retried. It means the chore was archived, or rescheduled so its key changed.
  Keeping it would block everything queued behind it forever.
- **A finished key is acknowledged without a write.** Both `completed` *and*
  `skipped`: the projection counts skipped as done, so the widget draws a
  filled box, and a drain guarding only `completed` would have completed a
  chore you deliberately skipped. The box on a finished row is no longer a
  button either.

## What is deliberately *not* here

**The reverse direction.** Ticking a chore in the app does not write into the
pending-ticks queue. The app publishes a fresh snapshot instead, which is one
source of truth rather than two.

**Starting the card from a notification.** iOS only lets an app start a Live
Activity while it is in the foreground. A chore coming due at 09:00 with Chorus
closed cannot raise one — that needs a push-to-start token and a server sending
APNs, which this app does not have. So the ladder is still what gets your
attention; the card is what you see when you look, and what you tick.

A consequence worth knowing: the card appears when you next open the app, not
the moment something comes due.

**Any schedule knowledge in Swift.** Said twice on purpose.

## Two things guarding a failure with no symptom

The app and the widget never share a type. JavaScript writes the snapshot and
Swift reads it; nothing in either toolchain checks that they agree about a
single field name. When they disagree, Swift's `try? JSONDecoder().decode(…)`
returns nil and the widget shows its "never been told" state **forever** — no
crash, no log, nothing to find.

So `src/core/widget/contract.test.ts` reads the Swift source and compares:

- `Snapshot` and `Snapshot.Row` declare exactly the fields this module writes,
- both sides use the same App Group, snapshot filename and pending-ticks key,
- the two copies of `PlanActivityAttributes.swift` are **byte-identical** —
  ActivityKit routes an activity to its configuration by the attributes type's
  *name* and decodes the other process's `ContentState`, so two copies that
  differ produce a card that starts and renders the system placeholder,
- the bridge's `showActivity` names every field `ContentState` declares.

Mutation-verified: renaming a Swift field, changing the filename on one side,
or diverging the two attribute copies each turns a test red.

Why the attributes file is duplicated rather than shared: the extension compiles
`targets/plan/`, the app compiles the module's pod, and a CocoaPod may not reach
outside its own directory for sources.

## The bug that proved the point

The section above was written before the feature had ever rendered, and it was
right about the shape of the danger and wrong about where it would land.
`writtenAt` was declared `Date` in Swift with
`dateDecodingStrategy = .iso8601`, and JavaScript's `new Date().toISOString()`
always emits three fractional digits. Foundation's `.iso8601` has no
`.withFractionalSeconds`, so it rejected **every** snapshot:

```
2026-10-22T09:30:00.000Z  ->  nil (rejected)
2026-10-22T09:30:00Z      ->  decoded
```

`load()` returned nil forever. The widget showed "Open Chorus" permanently,
`markDone` bailed so the box never even filled optimistically, and nothing was
logged on either side. Build 66 shipped to both phones in exactly that state.

Every field name matched perfectly, which is why the contract test passed. It
now compares **types** as well, and asserts no decoding strategy appears in the
file at all — a `Date` there is the clue that somebody has reintroduced this.
`writtenAt` is a `String` and nothing reads it.

The lesson, which is not the one the file was already warning about: a
cross-language contract is not only a list of names. Everything crossing that
boundary is now `String`, `Int`, `Bool`, or an array of those.

## Two more things review caught

**Both tap targets were too small.** 20pt in the widget and 18–28pt on the
card, against `MIN_TARGET` of 44 — the project's single most repeated failure,
and `src/design/tapTargets.test.ts` cannot see Swift. The consequence of a
mis-tap is worse here than in the app: it completes the *wrong* chore, with no
undo anywhere on the home screen.

The card's is a true 44×44 on the lock screen, and 28pt inside the Dynamic
Island, whose leading and trailing regions flank the ~37pt sensor housing.

The widget's went through two versions. Padding the box out to 44pt worked and
cost 24pt of a small widget's ~130pt content width, cutting the title from
about thirteen characters to eight — silently, because it is `lineLimit(1)`.
So **the whole row is the button** instead: a hit region wider than 44pt at
every widget size, no cost to the title, and nothing to explain about which
part of the row to aim at. A finished row is not a button at all. The gallery
description says "tap a row", because that is now what it is.

What that trades away: there is less inert area left to open the app from. The
header, the inter-row gaps, the "+N more" line and the container margin all
still fall through to launching Chorus, but on a small widget the chore list is
most of the face. Tapping a row ticks it.

**The `staleDate` comment was fiction.** It claims "the app refreshes it every
foreground", which nothing did — the only trigger was a changed snapshot
fingerprint. Four hours after you last changed your plan, iOS dims the card to
say "this may be out of date", and it would have stayed dimmed. The AppState
listener now re-publishes it, which is also what the comment always said.

Calls into ActivityKit are serialised through a promise chain, because two
unawaited `showActivity` calls can each see no running activity and each
request one — leaving two cards for the same day, after which only the first
found is ever updated.

## Two things it took a phone to find

Both shipped to both handsets, both invisible to 2,100 green tests, and both
exactly the shape `docs/WHERE-THINGS-STAND.md` warns about: *decode the
artifact, do not read the dashboard.*

### Every colour was empty

`expo-target.config.js` declared four colours. The plugin's own type
documentation says to write them as
`{ color: "#FF0000", darkColor: "#0000FF" }`. Its code reads `color.light` and
`color.dark`. Given the documented shape both are `undefined`, and it writes:

```json
{ "colors": [], "info": { "version": 1, "author": "expo" } }
```

A colorset containing no colours. The plugin said nothing, the prebuild
succeeded, the build succeeded. `Color("$paper")` resolved to nothing, so the
widget's background was transparent and every piece of text was invisible —
a blank widget, and a Live Activity that Jake described as *"a semi transparent
notification that said chorus but had nothing on it"*.

`src/design/widgetColors.test.ts` now reads the generated `Contents.json` and
fails if a colorset is empty, is missing its dark variant, or drifts from
`src/design/tokens.ts`. It lives beside the tokens rather than in
`src/core/widget/` because it has to import them, and `src/core` may not import
outward.

### The Live Activity was never registered

`PlanActivity()` sat inside `if #available(iOS 16.2, *)` in the widget bundle.
That compiles — `WidgetBundleBuilder.buildOptional` accepts an availability
clause — by wrapping the widget in SwiftUI's type-erased
`LimitedAvailabilityWidget`. The system has to look through that to find the
`ActivityConfiguration` matching a running activity's attributes, and it did
not: iOS showed the activity's container with the app's name and no view inside
it.

The check was unreachable anyway. **The widget target's deployment target is
iOS 18.0** while the app's is 15.1 — so no availability clause below 18.0 can
ever be false inside the extension, and on iOS 15.1–17.x the app installs
normally and the widget and the card simply do not exist. `PlanAttributes`
keeps its `@available(iOS 16.2, *)` because that file is compiled into the app
too.

`contract.test.ts` fails if a conditional reappears in the bundle, or if a
second `@main` shows up.

## One race left, knowingly

`acknowledgeTicks` filters the queue and `PendingTicks.add` appends to it, from
two processes, on the same App Group `UserDefaults` key, with no atomicity. A
tick landing inside the app's read-modify-write can be lost: the app reads
`[A]`, the widget writes `[A, B]`, the app writes back `[]`, and B is gone with
the box un-filling on the next publish.

The window is microseconds wide and needs a tap inside it, so it is left alone
rather than fixed with a lock that would have to span two processes. Worth
knowing it is there, and that the snapshot beside it is written `.atomic` for
exactly this reason. It is not new — the destructive single call had the same
race and a wider window.

## Signing

Two targets need two provisioning profiles, and no command-line flag can give
them different ones. See `docs/decisions/widget-signing.md`.
