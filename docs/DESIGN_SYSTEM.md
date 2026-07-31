# Design system

The identity: **each person is an ink.** Borrowed from risograph printing, where
a page is built from a few flat, saturated inks that overprint. Here the inks
identify people, so "whose turn is it" reads before any label does.

That is doing information work, not decoration. A shared chore list has a
question a solo to-do app doesn't — *is this mine?* — and colour answers it
faster than text.

## The rule that keeps it from being too much

**Ink appears on small marks only, and never carries meaning alone.**

Tinted: the checkbox, the avatar, the turn chip, the agenda dot.
Never tinted: page grounds, headings, buttons, tab bars, sheets.

So the page stays paper-and-ink with a few coloured marks on it. The version
this guards against — where the whole screen turns pink because Sam is up next —
is explicitly not the design.

And every coloured mark is paired with text: a blue checkbox always sits beside
"Your turn". Colour is an *enhancement* to a signal that already exists, which is
what makes the next section a matter of quality rather than access.

## Accessibility

Around 8% of men have some colour vision deficiency. Because colour is never the
sole signal, nobody is blocked — but the enhancement should still work for them.

1. **Colour is never the only signal.** Non-negotiable. Any row distinguished by
   ink is also distinguished by words.
2. **One verified combination works under colour vision deficiency.**
   Distinguishability is a property of a *combination*, not of a colour — an ink
   is only "safe" relative to what sits beside it, so flagging individual
   swatches would be meaningless. `CVD_FRIENDLY_SET` (blue, ochre, slate) is
   offered in the picker as a preset, and `inks.test.ts` verifies it by
   simulating both deuteranopia and protanopia and measuring ΔE, so the claim
   fails the build if anyone tweaks a hex.

   **Three is close to the ceiling.** Red-green deficiency flattens the palette
   onto a blue-yellow axis, so a fourth clearly-separable hue is not really
   available — a property of human vision, not of this palette. Beyond three
   people the always-present text carries it, which is why rule 1 is the
   load-bearing one. The rest of the palette stays chosen for looks.
3. **Dynamic Type is supported.** Layouts reflow rather than truncate.

## Palette

Two grounds, two theme variants each. Both themes are designed, not inverted —
the blue that works on paper goes muddy on near-black, so the dark theme lifts
every ink to a brighter register while keeping it recognisably the same person.

| Role | Light | Dark |
|---|---|---|
| Paper (ground) | `#F3F2EE` | `#121219` |
| Surface | `#FFFFFF` | `#1A1A23` |
| Sunken (rows) | `#F4F4F1` | `#22222D` |
| Text | `#17171F` | `#ECEBE6` |
| Text muted | `#4A4A55` | `#A9A8B2` |
| Overprint (flexible, previews) | `#5B2E9E` | `#B08CFF` |

**Overdue is the text colour, not a red.** A red wash over a chore list makes an
ordinary Tuesday feel like an incident. An outlined row with a solid ink chip is
unmissable without being a scold.

The eight person inks are defined in `src/design/tokens.ts` with their light and
dark pairs, and each is flagged for whether it belongs to the CVD-safe subset.

## Choosing an ink

- **Curated set of eight**, not a colour wheel. A free hex can't have a hand-tuned
  dark variant, and half of them would be illegible on one theme or the other.
- **Unique within a household**, enforced by `unique (household_id, accent)` — a
  database constraint rather than app logic that might forget. If two people
  share an ink it stops identifying anyone, which removes the reason it exists.
- **Stored on the membership, not the profile.** A global ink can't be uniquely
  constrained per household: change it to resolve a clash in one house and you
  might create one in another. Membership-scoped makes it enforceable, and makes
  multi-household free later.
- **Defaults**: first member blue, second pink — so it looks like the approved
  mockup out of the box and nobody makes a decision during onboarding.

## Typography

System faces, given character through treatment rather than exotic families.

| Role | Treatment |
|---|---|
| Display | 30px / 800 / −0.9 tracking |
| Title | 22px / 700 |
| Heading | 17px / 600 |
| Body | 15px / 500 |
| Label | 11px / 600 / uppercase / +1.4 tracking |
| Mono | 13px / 600 / tabular figures |

**Mono carries anything countable** — dates, counts, status, invite codes. It
gives tabular figures so the agenda's date column aligns, and it echoes the chore
chart on a fridge that this app replaces.

React Native only accepts font weights in hundreds. An earlier scale used `'780'`
and `'720'`, which are silently invalid.

## Screen decisions

Settled with Jake, 30 July 2026.

### Interaction

- **Tap the checkbox to complete; tap the row body to open the sheet.** Two
  targets on one row. Ticking is one tap; skip / reschedule / edit are one tap
  away and not hidden behind a long-press.
- **You can complete someone else's turn, with a confirmation.** "This was Sam's
  turn — mark it done anyway?" The completion records *you* as the completer, so
  the balance stays truthful. Housemates are a trust relationship, not an
  access-control problem.

### Today

- **Yours first, then everyone else's** below. Your own obligations get the top of
  the screen; the rest is visible because seeing it is the point of sharing.
- **Completed chores stay all day**, struck through at the bottom, attributed.
  Seeing what someone already did is half the reason to share a list — and it's
  the thing that stops you asking.
- **Someday chores** get a collapsed "Someday (4)" row at the bottom, expandable.
  Visible enough to actually happen, quiet enough not to nag.

### Upcoming

- **A collapsible month grid above the agenda.** Collapsed it's a week strip;
  pull down for the full month with a dot per chore, coloured by whose it is.
  Tapping a date jumps the agenda.

  The grid earns itself here in a way it wouldn't in a normal calendar app:
  **the dots make the rotation visible.** Trash reads pink for a week, then blue —
  you can see the hand-over coming without reading anything, which is the one
  thing this app knows that a to-do list doesn't.

- **Floating chores sit in a "sometime this week" band above the dated rail**,
  with progress pips. They genuinely aren't on a day, and putting them on one
  would make the dated list lie.

### Overdue — derived from the chore's own cadence

There is **no fixed day-count horizon**. Instead:

> Show only the **most recent** occurrence of a recurring chore that is due or
> past. A one-time chore never expires.

That single rule gives the right behaviour at every cadence:

| Chore | Missed | Shows |
|---|---|---|
| Dishes, daily | Monday | Tuesday it's just "due today" — Monday's miss is gone |
| Bathroom, weekly Sunday | Sunday | "3 days late" all week; next Sunday it's "due today" again |
| Fridge, monthly | the 31st | overdue for a month, then replaced |
| Cancel the gym, one-time | 12 days ago | "12 days late", indefinitely |

Consequences worth stating:

- **At most one overdue row per recurring chore, ever.** No wall of guilt, and a
  neglected daily chore can't put fourteen rows on Today.
- The horizon scales itself: a daily chore's miss lives a day, a monthly chore's
  lives a month.
- `overdue_horizon_days` becomes unnecessary and is removed.
- A superseded miss leaves **a quiet marker on the new occurrence** — "due today ·
  missed last time" — so it's honest without being a screen full of reproach.
- One-time chores can't come from the agenda window (a task from eight months ago
  is outside any sane range), so they're fetched by their own small query.

### Chores tab

- **Archived chores behind a "Show archived" filter.** Archiving is the only
  removal the app allows — `DELETE` is revoked at the database because it would
  cascade away the completion log — so unarchiving needs somewhere to live.

### Copy

- **"Your turn" for you, first names for everyone else.** Nobody says "Jake's
  turn" about themselves.
- **Written for N people, not two.** "Everyone in the house", not "both of you".
  The engine was already N-safe — rotation rosters are arrays and `everyone`
  fans out to however many members exist — so this is copy and a few components.
- Four tabs: **Today / Upcoming / Chores / House.**
