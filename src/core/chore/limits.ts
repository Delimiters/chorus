/**
 * How long the text on a chore may be.
 *
 * One definition, imported by the form and mirrored by a CHECK in
 * `20261006120000_longer_chore_titles.sql`. Both exist on purpose: the input
 * stops you at the boundary so the limit is visible, and the constraint is the
 * backstop for anything reaching the table another way.
 *
 * The name's cap was 120 until Emily ran out of room writing one. 200 keeps a
 * title a label — it is drawn on one line on the plan, inside a notification
 * body, and in the widget snapshot — while being long enough for an errand with
 * an address in it. Anything that wants a paragraph wants `NOTES_MAX`.
 *
 * Raising either number means a migration as well as this file. Lowering one
 * means a backfill too, because existing rows would no longer satisfy the
 * CHECK — which is why these only ever go up.
 */

/** The longest a chore's name may be, in characters. */
export const CHORE_TITLE_MAX = 200;

/** The longest a chore's notes may be. Unchanged; here so both live together. */
export const CHORE_NOTES_MAX = 2000;
