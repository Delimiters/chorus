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
 * The order to draw the day in.
 *
 * Everything unfinished keeps its position, in order; everything finished and
 * no longer held goes after it, also in order. Stable within each group, so
 * nothing shuffles for a reason nobody asked for.
 */
export function settleOrder<T>(
  items: readonly T[],
  held: ReadonlySet<string>,
  // The plan wraps each row with the position it was given, so what is being
  // ordered is not itself the thing whose status decides the order.
  settleableOf: (item: T) => Settleable,
): readonly T[] {
  const staying: T[] = [];
  const sinking: T[] = [];

  for (const item of items) {
    const { occurrenceKey, status } = settleableOf(item);
    const done = status === 'completed' || status === 'skipped';
    if (done && !held.has(occurrenceKey)) sinking.push(item);
    else staying.push(item);
  }

  return [...staying, ...sinking];
}
