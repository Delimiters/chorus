/**
 * How long the names and bodies you type may be.
 *
 * One home for every cap, because the last time one of these moved it lived in
 * five places — the input, the screen's save gate, the API layer, the database
 * CHECK, and the tests pinning all four — and four of them stayed at the old
 * number while the change was described as shipped. A number duplicated across
 * TypeScript and SQL has no compiler keeping it honest, so `limits.test.ts`
 * reads the bounds back out of the migrations and fails if they disagree.
 *
 * Every title is 200. Separate constants rather than one shared `TITLE_MAX`
 * because each has its own CHECK with its own shape, and the next change may
 * well move only one of them — a shared constant would make that look like a
 * one-line edit when it is a migration.
 *
 * 200 keeps a title a label: it is drawn on one line in the picker, inside a
 * notification body, and in the widget snapshot. Anything that wants a
 * paragraph wants the body or the notes.
 *
 * Raising any of these means a migration as well as this file. Lowering one
 * means a backfill too, because existing rows would stop satisfying the CHECK
 * — which is why these only ever go up.
 */

/** A chore's name. */
export const CHORE_TITLE_MAX = 200;

/** A chore's notes. Unchanged; here so the pair lives together. */
export const CHORE_NOTES_MAX = 2000;

/** One step of a chore. */
export const SUBTASK_TITLE_MAX = 200;

/** A personal routine item's name. */
export const ROUTINE_TITLE_MAX = 200;

/** A routine item's notes. */
export const ROUTINE_NOTES_MAX = 2000;

/**
 * A note's heading, which is optional — the only nullable one of these.
 *
 * Its CHECK is `title is null or length(title) <= 200`: no floor, because a
 * note with a body and no heading is an ordinary note.
 */
export const NOTE_TITLE_MAX = 200;

/** A note's body, which is the note. */
export const NOTE_BODY_MAX = 20000;
