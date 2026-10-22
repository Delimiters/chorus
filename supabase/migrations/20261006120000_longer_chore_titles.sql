/*
 * A chore name can be 200 characters, not 120.
 *
 * Emily ran out of room naming a chore and the field simply stopped accepting
 * keystrokes — Jake: *"I'm wondering if we can't increase the max title
 * length?"*. 120 is about a sentence, and the names this household actually
 * writes are errands with an address or a condition in them.
 *
 * 200 rather than unbounded. A title is drawn in one line on the plan, in a
 * notification body, and in the widget snapshot, so it has to stay a label; a
 * name that needs a paragraph wants the notes field, which already holds 2000.
 *
 * Widening a CHECK can never fail against existing rows — every title that
 * satisfied 1..120 satisfies 1..200 — so this needs no backfill and no
 * validation pass. The reverse would.
 *
 * The client cap moves in the same change (`CHORE_TITLE_MAX`). Both exist on
 * purpose: the input stops you at the boundary, and this is the backstop for
 * anything that reaches the table another way.
 */

alter table public.chores drop constraint chores_title_check;

alter table public.chores
  add constraint chores_title_check check (char_length(title) between 1 and 200);
