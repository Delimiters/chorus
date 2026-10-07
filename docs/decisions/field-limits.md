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
  (the point of the change), 201 rejected, empty rejected. **Nothing in the suite
  asserted the old 120**, which is exactly how a widened CHECK loses its upper
  bound unnoticed.

Every guard mutation-verified. One of them — a `buzzed` ref meant to stop the
haptic repeating — was **deleted** when the mutation showed no test could tell
its presence from its absence: the effect's dependency list already runs it only
when `full` flips, so the ref was dead state.
