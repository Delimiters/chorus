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
 * noise dressed as news — so the tab bar seeds it from `latestNoteStamp` as
 * soon as a list is in hand, and this is what holds until then.
 *
 * Timestamps are compared as **strings**, and both sides now come from the
 * same clock: `lastSeenAt` is a stamp copied off a note, not a reading of the
 * phone's own time. ISO-8601 in UTC sorts lexicographically in the same order
 * it sorts chronologically, so the comparison is exact. Parsing to `Date` would
 * need a clock in `core`, which invariant 2 forbids anyway.
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
 * The newest edit on the board, or null when there is nothing on it.
 *
 * This is what "seen" is recorded as, and the reason is that it comes from
 * **Postgres**. Recording the phone's own clock compared a device time against
 * server timestamps, and two clocks that disagree break it in both directions:
 * a phone running ninety seconds slow leaves a badge on a board it is looking
 * at, and a phone that briefly reads 2027 — a manual set, a bad sync — writes a
 * moment nothing can ever exceed. `markSeen` only moves forward, so that second
 * one kills the badge for a year with no way to reset it from inside the app.
 *
 * Marking the newest stamp instead costs nothing: a note saved after the list
 * was fetched has an `updatedAt` greater than this, so it is still news.
 */
export function latestNoteStamp(notes: readonly SeenCandidate[]): string | null {
  let latest: string | null = null;
  for (const note of notes) {
    if (latest === null || note.updatedAt > latest) latest = note.updatedAt;
  }
  return latest;
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
