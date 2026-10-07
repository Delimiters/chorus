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
- **Full** — *"You've used all 200 characters — that's the limit."* It replaces
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

**Then the rest, at Jake's word — *"yeah make the same change"***. Routine item
names, chore steps and note headings are all 200 now, in
`20261007120000_longer_titles_everywhere.sql`.

Each CHECK keeps its own shape and only its ceiling moves, because the three
differ in ways that matter:

| column | CHECK | what the shape protects |
| --- | --- | --- |
| `chore_subtasks.title` | `char_length(title) between 1 and 200` | not empty |
| `routine_items.title` | `char_length(trim(title)) between 1 and 200` | not empty **and not only spaces** |
| `household_notes.title` | `title is null or length(title) <= 200` | may be **absent** — a note is its body |

Flattening them into one form would quietly change three other things. The notes
and body caps (2000, 20000) did not move.

Every cap now lives in **`src/core/text/limits.ts`**, one module, because the
chore title's move proved what happens otherwise: it lived in five places and
four of them kept the old number while the change was described as shipped.
`src/core/chore/limits.ts` was folded into it.

## Pinned by

- `src/design/Field.test.tsx` — seventeen tests over the three states, the
  threshold for short and long fields, precedence against hint and error, the
  footer row's presence and absence, the spoken announcement, and the haptic
  firing once per arrival, never on mount.
- `src/core/text/limits.test.ts` — every constant against the bound parsed out of
  the migrations, in either direction. This parser took **three** rounds of
  review to get right, and each round it was passing while being wrong:
  1. First it keyed on a constraint *name* and matched case-sensitively, so a
     future widening written in uppercase, or with the constraint renamed, or as
     `>= 1 and <= 200`, was skipped — and the *old* bound still matched, so the
     test reported agreement.
  2. Then it keyed on the column name alone, which was luck with four `title`
     CHECKs in the schema and would have broken outright here.
  3. Then its table filter was a substring test, which let an unqualified `alter
     table x` followed by a newline go unseen, let a later `create table` with
     `references public.chores (id)` hijack the chores assertion, and — already
     happening — made `chores.notes` read `routine_items`, because that
     migration contains the comment *"mirror chores for the same reason"*. Both
     passed only because the two bounds were equal.

  It now strips SQL comments, matches the statement's own `create table` /
  `alter table` target, and throws rather than passing when it finds nothing.
  Each leak above is checked by adding a hypothetical migration and confirming
  the test follows it.
- `supabase/tests/title-lengths.test.sql` — per table: 200 accepted, 121 accepted
  (the point of the change), 201 rejected, empty rejected. No *database* test
  asserted the old 120, which is how a widened CHECK loses its upper bound
  unnoticed.
- `src/features/chores/ChoreForm.test.tsx` and `RoutineForm.test.tsx` — a
  150-character and a 200-character name reach `onSubmit` **through the button**,
  and whitespace still does not. This is the test the change actually needed.
- Caps that only a `maxLength` enforces — chore steps and a note's heading — are
  typed with `userEvent.type`, which maintains text state and so *does* enforce
  `maxLength`. `fireEvent.changeText` sets the value directly and bypasses it,
  which is why these were briefly prop assertions; a review showed the
  behavioural test was available after all. A note's 20,000-character body stays
  a prop assertion, because typing it one keystroke at a time takes minutes.

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
