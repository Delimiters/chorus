/**
 * Where a dragged row lands, and what position to give it.
 *
 * The arithmetic lives here, away from the gesture, because it is the part that
 * can be wrong in ways nobody notices: a drag that lands one place off looks
 * like a slippery finger rather than a bug. The component that owns the
 * PanResponder is then only responsible for turning touches into a `dy`.
 *
 * Rows are **measured**, not assumed. The list this replaces used a fixed row
 * height so the offset divided by the height *was* the number of places moved —
 * exact, and only true for uniform rows. Plan rows are not uniform: a chore
 * whose name needs two lines is a taller row, which was a deliberate decision.
 */

/**
 * The index a row dragged by `dy` should end up at.
 *
 * Decided by where the dragged row's *centre* has got to, compared against the
 * midpoints of the rows it is passing. Comparing edges instead makes a row
 * swap as soon as it overlaps its neighbour by a pixel, which feels like the
 * list twitching away from you.
 */
export function targetIndex(heights: readonly number[], from: number, dy: number): number {
  if (heights.length === 0) return 0;
  if (from < 0 || from >= heights.length) return from;

  /*
   * Midpoints in one pass, capturing the dragged row's own on the way past.
   *
   * Indexed reads would each need a `?? 0` that the bounds check above has
   * already ruled out — unreachable branches that coverage counts and no test
   * can honestly reach.
   */
  const midpoints: number[] = [];
  let running = 0;
  let own = 0;
  for (const [i, height] of heights.entries()) {
    const midpoint = running + height / 2;
    midpoints.push(midpoint);
    if (i === from) own = midpoint;
    running += height;
  }

  const centre = own + dy;
  let target = from;

  for (const [i, midpoint] of midpoints.entries()) {
    /*
     * Moving down: pass a row once the centre reaches that row's midpoint.
     *
     * Inclusive, and it has to be. Held inside the list, the furthest a row can
     * travel puts its centre *exactly* on the last row's midpoint when the rows
     * are the same height — so with a strict comparison the last slot could not
     * be reached at all, however hard you dragged.
     */
    if (i > from && centre >= midpoint) target = i;
    // Moving up: the same test in the other direction, inclusive for the same
    // reason. Only one of the two can fire, because the centre cannot be past
    // midpoints on both sides of where it started; `min` keeps the furthest one
    // travelled to.
    if (i < from && centre <= midpoint) target = Math.min(target, i);
  }

  return target;
}

/** The order a list takes once one item has moved from `from` to `to`. */
export function reorder<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/**
 * The position a row should take between its new neighbours.
 *
 * Averaging rather than renumbering: one row moves, so one row is written.
 * Renumbering the day would turn a drag into N writes and make two people
 * dragging at once a merge conflict rather than two independent facts.
 *
 * `before` is what it lands after and `after` is what it lands before; either
 * may be absent at the ends of the list.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

/**
 * How far a row that is *not* being dragged should move out of the way.
 *
 * A drag with no live gap gives you nothing to aim at: the rows sit still while
 * you hold one over them, and the list only rearranges after you let go, which
 * reads as the list jumping rather than as you having placed something. The
 * dragged row's own height is what opens up, because that is the space it will
 * occupy.
 *
 * Returns a signed offset in points: negative to slide up, positive down.
 */
export function shiftFor(from: number, to: number, index: number, draggedHeight: number): number {
  if (index === from || from === to) return 0;

  // Dragging down: everything it has passed slides up into the gap it left.
  if (from < to) return index > from && index <= to ? -draggedHeight : 0;

  // Dragging up: everything it has passed slides down.
  return index >= to && index < from ? draggedHeight : 0;
}

/**
 * A drag offset, held so the row cannot leave the list.
 *
 * Unclamped, a row dragged past either end follows the finger out into the page
 * and then teleports back on release — and the further you overshot, the larger
 * the jump. Stopping at the ends also says, honestly, that there is nowhere
 * further to go.
 *
 * The limit is where the dragged row's **centre** may travel: no further than
 * the first and last rows' midpoints, which is exactly what {@link targetIndex}
 * compares against. Clamping to the summed heights above and below instead —
 * which is the intuitive reading of "inside the list" — silently made the ends
 * unreachable for any row taller than the one at the end: a two-line chore
 * stopped 16pt short of the midpoint it needed to cross and simply would not go
 * to the top, however hard it was dragged. Non-uniform rows are the entire
 * reason this list measures anything, so that was the ordinary case.
 */
export function clampToList(heights: readonly number[], from: number, dy: number): number {
  if (heights.length === 0 || from < 0 || from >= heights.length) return dy;

  const midpoints: number[] = [];
  let running = 0;
  let own = 0;
  for (const [index, height] of heights.entries()) {
    const midpoint = running + height / 2;
    midpoints.push(midpoint);
    if (index === from) own = midpoint;
    running += height;
  }

  const first = midpoints[0] ?? own;
  const last = midpoints[midpoints.length - 1] ?? own;

  // `+ 0` normalises the negative zero `Math.max(-0, …)` produces at the top of
  // the list, which is harmless in a transform and confusing in a test.
  return Math.max(first - own, Math.min(last - own, dy)) + 0;
}
