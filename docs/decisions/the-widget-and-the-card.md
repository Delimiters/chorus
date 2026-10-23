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

So `modules/widget-bridge` exists, and does exactly four things:

| | |
|---|---|
| `writeSnapshot(json)` | the projection the app already computed, written down |
| `reloadTimelines()` | redraw now, rather than at WidgetKit's leisure |
| `takePendingTicks()` | drain what was ticked from the home or lock screen |
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

Three things the drain does that are easy to get wrong, and are tested:

- A key with no occurrence behind it is **dropped, not retried**. It means the
  chore was archived or rescheduled since the tap. Keeping it would replay it
  forever.
- An already-completed key is skipped, so a double tap is not a double write.
  `unique (chore_id, occurrence_key)` would make it harmless anyway; this makes
  it quiet.
- One drain at a time. `takePendingTicks` is destructive, so two overlapping
  drains would each take half the queue.

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

## Signing

Two targets need two provisioning profiles, and no command-line flag can give
them different ones. See `docs/decisions/widget-signing.md`.
