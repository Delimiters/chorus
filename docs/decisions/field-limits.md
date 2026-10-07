# Running out of room in a field

**6 October 2026.** Emily hit the end of a chore name and the field stopped
accepting keystrokes with no explanation. Jake: *"she was struggling with the
name of the chore"*, and *"I'm wondering if we can't increase the max title
length?"* — two separate problems, both fixed.

## Why there was nothing to react to

`maxLength` on a React Native `TextInput` clips the text **before**
`onChangeText` fires. There is no event marking the rejected keystroke, so no
amount of handler code can notice it. A key that does nothing reads as a broken
keyboard rather than a full field.

The only honest fix is to say where the boundary is *before* you arrive at it.

## What a field does now

Three states, in one footer row shared with the hint and the error so nothing
below the field moves as you type:

- **Quiet** until you are near the end.
- **Counting down** — `7 left`. A countdown answers the question actually being
  asked; `113/120` makes you do the subtraction.
- **Full** — *"That's the longest a name can be — 200 characters."* It replaces
  the countdown rather than sitting beside it, and it yields to a real error.
  Plus one light haptic on arrival, so the limit is felt at the moment the
  keyboard goes dead.

The countdown starts at **a quarter of the field, capped at twenty characters**.
A flat twenty would count the nine-character invite code down from the first
keystroke; a flat quarter would put a counter on the 2000-character notes field
500 characters early. Both read as nagging.

**The limit is deliberately not an error.** The border stays neutral and the copy
does not apologise — nothing is wrong, the field is simply full. That is a fact
about the field, not a mistake you made.

This lives in `Field`, so every capped input in the app gets it: names, notes,
category names, the household name, the invite code.

## The cap itself: 120 → 200

Moved in `20261006120000_longer_chore_titles.sql` and in `CHORE_TITLE_MAX`, which
the form imports. Both exist on purpose — the input stops you at the boundary so
the limit is visible, and the CHECK is the backstop for anything reaching the
table another way.

200 rather than unbounded: a title is drawn on one line in the picker, inside a
notification body, and in the widget snapshot, so it has to stay a label. A name
that wants a paragraph wants the notes field, which already holds 2000.

Widening a CHECK can never fail against existing rows — every title satisfying
1..120 satisfies 1..200 — so no backfill and no validation pass. The reverse
would need both, which is why these numbers only go up.

**Consequence worth knowing:** the chore row's title has no `numberOfLines`, so a
200-character name wraps to four or five lines and the row grows. It does not
overflow its cell, and truncating a name somebody deliberately made long would be
worse. Only the picker and the housemate's column clip to one line.

**Left at 120:** routine item titles, subtask titles and note titles. Jake asked
about the chore title specifically, and each of those has its own CHECK to move.

## Pinned by

- `src/design/Field.test.tsx` — twelve tests over the three states, the threshold
  for short and long fields, precedence against hint and error, and the haptic
  firing once per arrival rather than per render.
- `supabase/tests/chore-title-length.test.sql` — 200 accepted, 121 accepted
  (the point of the change), 201 rejected, empty rejected. No *database* test
  asserted the old 120, which is how a widened CHECK loses its upper bound
  unnoticed.
- `src/features/chores/ChoreForm.test.tsx` — a 150-character and a 200-character
  name reach `onSubmit` **through the button**, and whitespace still does not.
  This is the test the change actually needed; see below.

## What the review caught, and it was the whole feature

The cap was raised in three places and left at 120 in two more, so **a
150-character name could be typed and then not saved**:

- `canSave` in `ChoreForm` still read `trimmed.length <= 120`, so `Add chore`
  was disabled with no explanation — and the same change deleted the
  `'That name is too long.'` error that used to say why. At `maxLength={120}`
  that gate was unreachable; raising the input's cap is what exposed it.
- `choreRow` in `src/data/api/chores.ts` still threw past 120, so even a fixed
  button would have failed on the way to the table.

A dead control with nothing explaining it is precisely the defect this PR exists
to remove, reintroduced one layer up. Both now read `CHORE_TITLE_MAX`.

The claim that "nothing in the suite asserted the old 120" was **false**:
`src/data/api/chores.test.ts` asserted that 121 characters throws, and it stayed
green the whole time — a test pinning the old behaviour while the feature it
blocked was described as shipped. It now asserts against the constant, plus that
121 is accepted.

Two more fixed in the same pass:

- **A field that mounts already full no longer buzzes.** Opening a note whose
  title is exactly 120 characters, or editing a chore named to the cap, fired a
  haptic and interrupted a screen reader for a limit the reader had not just hit.
  The effect skips its first run.
- **The limit sentence no longer names the field.** It read "the longest a
  ${label} can be", which produced "a notes", "a invite code" and "a household"
  — three of the app's nine capped fields. An article cannot be derived from a
  label, and the label is already on screen, so the sentence says only what the
  label cannot: *"You've used all 200 characters — that's the limit."*

Every guard mutation-verified, and two tests were rewritten after review showed
they could not fail:

- "renders no footer row" asserted only the absence of the countdown and the
  limit sentence — both pinned elsewhere — so it survived rendering the row
  unconditionally, the exact regression its name claims to prevent. It now
  asserts the row's absence by `testID`.
- The screen-reader announcement had no test at all and could be deleted with the
  suite green.

A `buzzed` ref was deleted earlier for the same reason, then a *different* ref
(`wasFull`) was added deliberately — not to stop repeats, which the dependency
list already handles, but to tell "mounted full" from "just became full".
