/**
 * How many notes have changed since you last looked at the board.
 *
 * Jake: *"a little notification count on the tab icon when there are
 * updates"*. The count is derived rather than stored — there is no "unread"
 * column, and adding one would mean a write from every device on every glance,
 * plus a row per person per note to write it into.
 *
 * Instead each phone remembers the moment it last had the board open, and the
 * badge is a comparison against the `updated_at` the list already carries. The
 * cost is that it does not follow you to a second phone: reading the board on
 * the iPad would leave the iPhone still badged. That is the right trade for a
 * two-person household, and the same one the view and reminder preferences
 * make.
 *
 * Pure, `Date`-free: the caller passes both the notes and the timestamp.
 */

/** Only the fields the count needs — so this compiles against `Note` and against a test fixture. */
export interface SeenCandidate {
  /** Who touched it last. Your own edits are never news to you. */
  readonly updatedBy: string | null;
  /** ISO-8601 from Postgres. Compared as a string; see below. */
  readonly updatedAt: string;
}

/**
 * Notes changed by somebody else since `lastSeenAt`.
 *
 * `lastSeenAt` of `null` counts nothing. A fresh install has never opened the
 * board, and badging it with a "14" for a year of notes nobody has changed is
 * noise dressed as news — so the store seeds the timestamp on first hydrate
 * and this is the safety net behind it.
 *
 * Timestamps are compared as **strings**, which is exact rather than lucky:
 * both sides are UTC ISO-8601 from the same two sources — Postgres's
 * `now()` serialised by PostgREST, and `Date.toISOString()` — and that format
 * sorts lexicographically in the same order it sorts chronologically. Parsing
 * to `Date` would need a clock in `core`, which invariant 2 forbids.
 *
 * A note written by nobody (`updated_by` nulled when its author deleted their
 * account) counts: it was somebody else's, and it is certainly not yours.
 */
export function countUnseenNotes(
  notes: readonly SeenCandidate[],
  options: { readonly userId: string | null; readonly lastSeenAt: string | null },
): number {
  const { userId, lastSeenAt } = options;
  if (lastSeenAt === null) return 0;

  return notes.filter((note) => note.updatedBy !== userId && note.updatedAt > lastSeenAt).length;
}

/**
 * What the tab bar should show, capped.
 *
 * iOS renders a long badge as a widening pill that shoves the label off
 * centre, and past a certain point the exact number stops being the point:
 * "9+" and "23" prompt the same action. `null` rather than `0` because that is
 * what `tabBarBadge` wants for "no badge" — `0` would render a circle
 * containing a zero.
 */
export function noteBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}
