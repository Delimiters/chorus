/*
 * The same 200 for every name you can type.
 *
 * `20261006120000_longer_chore_titles.sql` moved the chore title from 120 to
 * 200 and deliberately left the others, because Jake had asked about the chore
 * name specifically. He then asked for the rest: *"yeah make the same change"*.
 *
 * Three CHECKs, three different spellings, which is why each is rewritten in
 * full rather than patched:
 *
 *   - `chore_subtasks.title`  — `char_length(title) between 1 and 120`
 *   - `routine_items.title`   — `char_length(trim(title)) between 1 and 120`,
 *                               the trim being what stops a name of spaces
 *   - `household_notes.title` — `title is null or length(title) <= 120`, the
 *                               only nullable one: a note may have no title
 *
 * Each keeps its own shape and only its upper bound moves. Flattening them into
 * one form would quietly change three other things — whether a name of spaces
 * is legal, and whether a title may be absent.
 *
 * Widening a CHECK cannot fail against existing rows, so no backfill and no
 * validation pass. The constants in `src/core/text/limits.ts` move with it, and
 * `limits.test.ts` reads these files back to prove the two agree.
 */

alter table public.chore_subtasks drop constraint chore_subtasks_title_check;

alter table public.chore_subtasks
  add constraint chore_subtasks_title_check check (char_length(title) between 1 and 200);

alter table public.routine_items drop constraint routine_items_title_check;

alter table public.routine_items
  add constraint routine_items_title_check check (char_length(trim(title)) between 1 and 200);

alter table public.household_notes drop constraint household_notes_title_len;

alter table public.household_notes
  add constraint household_notes_title_len check (title is null or length(title) <= 200);
