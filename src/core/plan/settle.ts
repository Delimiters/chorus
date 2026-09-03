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
 * **The row does not move at the moment you tick it.** The tick and the jump
 * are two different pieces of feedback, and running them together loses both:
 * the row you just touched leaves from under your finger before you have seen
 * it change, and if it was the wrong row, undo means finding it again somewhere
 * else. So a just-completed row is *held* in place for a few seconds — long
 * enough to see the tick land — and only then sinks.
 *
 * The caller owns the timers and passes the held keys in, which keeps this a
 * pure function of its arguments and lets the delay be tested without a clock.
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
  held: ReadonlySet<string>,
  // The plan wraps each row with the position it was given, so what is being
  // partitioned is not itself the thing whose status decides the answer.
  settleableOf: (item: T) => Settleable,
): { readonly active: readonly T[]; readonly sunk: readonly T[] } {
  const active: T[] = [];
  const sunk: T[] = [];

  for (const item of items) {
    const { occurrenceKey, status } = settleableOf(item);
    const done = status === 'completed' || status === 'skipped';
    if (done && !held.has(occurrenceKey)) sunk.push(item);
    else active.push(item);
  }

  return { active, sunk };
}
