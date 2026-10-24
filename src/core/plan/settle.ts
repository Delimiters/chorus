/**
 * Finished work sinking to the bottom of the day, a moment after you tick it.
 *
 * A plan you are working through reads best with what is left at the top, and
 * a struck-through row sitting between two outstanding ones is a small tax paid
 * on every glance for the rest of the day.
 *
 * ── Two decisions, and both are about not being clever ────────────────────
 *
 * **It is a display rule, not a stored order.** Writing a new position on
 * completion would mean unticking something left it stranded at the bottom,
 * having quietly destroyed the order you built. Positions are yours; this
 * function only decides how they are shown.
 *
 * **The row moves at the moment you tick it.** It used to be held in place
 * for three seconds first, so you could watch the tick land before it sank.
 * The reasoning was that the tick and the jump are two pieces of feedback and
 * running them together loses both. What that missed is where the finger is
 * three seconds later: on the next row, while the list shifts underneath it.
 * Jake: *"feels glitchy and honestly ends up making me click the wrong chore
 * sometimes when I'm moving fast"*.
 *
 * The worry the hold addressed — "that was the wrong row" — is now answered by
 * an undo toast, which never moves anything while you are still working. See
 * the note in `PlanScreen.tsx` where the hold used to live.
 */

export interface Settleable {
  readonly occurrenceKey: string;
  readonly status: string;
}

/**
 * The day split into what is still yours to arrange, and what is done.
 *
 * Two lists rather than one ordered list, because the caller does different
 * things with them: `active` is draggable and `sunk` is not. Returning a single
 * concatenated order was the first attempt, and it put the screen in the
 * position of handing its drag list a *display* order while computing positions
 * from the *stored* one — which is how a "move down" ended up writing a
 * position that sent the row to the top.
 *
 * Both keep their incoming order, so nothing shuffles for a reason nobody
 * asked for.
 */
export function partitionSettled<T>(
  items: readonly T[],
  // The plan wraps each row with the position it was given, so what is being
  // partitioned is not itself the thing whose status decides the answer.
  settleableOf: (item: T) => Settleable,
): { readonly active: readonly T[]; readonly sunk: readonly T[] } {
  const active: T[] = [];
  const sunk: T[] = [];

  for (const item of items) {
    const { status } = settleableOf(item);
    const done = status === 'completed' || status === 'skipped';
    if (done) sunk.push(item);
    else active.push(item);
  }

  return { active, sunk };
}
