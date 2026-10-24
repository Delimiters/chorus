import { partitionSettled } from './settle';

const item = (occurrenceKey: string, status = 'due') => ({ occurrenceKey, status });
const keys = (items: readonly { occurrenceKey: string }[]) => items.map((i) => i.occurrenceKey);

/** Both halves: what is still yours to arrange, and what has sunk below it. */
const split = (day: readonly { occurrenceKey: string; status: string }[]) => {
  const { active, sunk } = partitionSettled(day, (i) => i);
  return { active: keys(active), sunk: keys(sunk) };
};

describe('splitting the day into what is left and what is done', () => {
  it('leaves an untouched day entirely active', () => {
    expect(split([item('a'), item('b'), item('c')])).toEqual({
      active: ['a', 'b', 'c'],
      sunk: [],
    });
  });

  it('sinks what is done', () => {
    expect(split([item('a', 'completed'), item('b'), item('c')])).toEqual({
      active: ['b', 'c'],
      sunk: ['a'],
    });
  });

  it('sinks a row the moment it is done, with nothing held back', () => {
    /*
     * A just-ticked row used to be held in the active half for three seconds.
     * That put a reflow three seconds after the tap, by which time the finger
     * has moved to the next row — which is how it caused mis-taps. The undo
     * toast on the plan screen answers the same worry without moving anything.
     *
     * Same fixture as the sinking case above with no hold argument, because
     * there is no longer one to pass: a second parameter reappearing here is
     * the regression this test is for.
     */
    expect(split([item('a', 'completed'), item('b'), item('c')])).toEqual({
      active: ['b', 'c'],
      sunk: ['a'],
    });
  });

  it('sinks a skipped row too', () => {
    // "Not today" is as finished as done, for the purpose of what is left —
    // and this must agree with every other tally on the plan screen, which
    // counts a skip as closing the row.
    expect(split([item('a', 'skipped'), item('b')])).toEqual({
      active: ['b'],
      sunk: ['a'],
    });
  });

  it('keeps the incoming order within each half', () => {
    /*
     * Stability is the whole reason this is a partition rather than a sort: a
     * comparator returning 0 for two finished rows is free to swap them, and a
     * list that reshuffles its finished half on every render is unreadable.
     * The active half's order matters more still — it is fed to the drag list,
     * whose position arithmetic assumes it is the stored order.
     */
    expect(
      split([
        item('a', 'completed'),
        item('b'),
        item('c', 'completed'),
        item('d'),
        item('e', 'completed'),
      ]),
    ).toEqual({ active: ['b', 'd'], sunk: ['a', 'c', 'e'] });
  });

  it('returns a row to the active half when it is no longer done', () => {
    /*
     * Why this is a display rule rather than a stored position: unticking
     * something that had sunk must put it back where it was in the day, not
     * leave it at the bottom having quietly destroyed the order you built.
     * Same fixture as the sinking case, one status changed — so it cannot pass
     * by being a day nothing happens to.
     */
    const done = split([item('a', 'completed'), item('b'), item('c')]);
    const undone = split([item('a'), item('b'), item('c')]);

    expect(done).toEqual({ active: ['b', 'c'], sunk: ['a'] });
    expect(undone).toEqual({ active: ['a', 'b', 'c'], sunk: [] });
  });

  it('sinks several at once', () => {
    expect(split([item('a', 'completed'), item('b', 'completed'), item('c')])).toEqual({
      active: ['c'],
      sunk: ['a', 'b'],
    });
  });

  it('sinks a day that is entirely finished, leaving nothing to arrange', () => {
    // Not "does nothing": every row moves out of the draggable half, which is
    // what stops a finished day still offering to be reordered.
    expect(split([item('a', 'completed'), item('b', 'completed')])).toEqual({
      active: [],
      sunk: ['a', 'b'],
    });
  });
});
