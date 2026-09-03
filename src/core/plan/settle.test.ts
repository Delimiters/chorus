import { settleOrder } from './settle';

const item = (occurrenceKey: string, status = 'due') => ({ occurrenceKey, status });
const keys = (items: readonly { occurrenceKey: string }[]) => items.map((i) => i.occurrenceKey);

const NONE: ReadonlySet<string> = new Set();

describe('finished work sinking to the bottom', () => {
  it('leaves an untouched day exactly as it was', () => {
    const day = [item('a'), item('b'), item('c')];
    expect(keys(settleOrder(day, NONE, (i) => i))).toEqual(['a', 'b', 'c']);
  });

  it('moves what is done below what is not', () => {
    const day = [item('a', 'completed'), item('b'), item('c')];
    expect(keys(settleOrder(day, NONE, (i) => i))).toEqual(['b', 'c', 'a']);
  });

  it('holds a row that was just ticked', () => {
    // The tick and the jump are separate pieces of feedback; running them
    // together means the row leaves before you have seen it change.
    const day = [item('a', 'completed'), item('b'), item('c')];
    expect(keys(settleOrder(day, new Set(['a']), (i) => i))).toEqual(['a', 'b', 'c']);
  });

  it('sinks a skipped row too', () => {
    // "Not today" is as finished as done, for the purpose of what is left.
    const day = [item('a', 'skipped'), item('b')];
    expect(keys(settleOrder(day, NONE, (i) => i))).toEqual(['b', 'a']);
  });

  it('keeps the order within each group', () => {
    /*
     * Stability is the whole reason this is a partition rather than a sort:
     * a comparator returning 0 for two finished rows is free to swap them, and
     * a list that reshuffles its finished half on every render is unreadable.
     */
    const day = [
      item('a', 'completed'),
      item('b'),
      item('c', 'completed'),
      item('d'),
      item('e', 'completed'),
    ];
    expect(keys(settleOrder(day, NONE, (i) => i))).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('puts a row back when it is unticked', () => {
    /*
     * The reason this is a display rule and not a stored position. Unticking
     * something that had sunk must return it to where it was in the day, not
     * leave it at the bottom having destroyed the order you built.
     */
    const day = [item('a'), item('b'), item('c')];
    expect(keys(settleOrder(day, NONE, (i) => i))).toEqual(['a', 'b', 'c']);
  });

  it('holds several at once, independently', () => {
    const day = [item('a', 'completed'), item('b', 'completed'), item('c')];
    expect(keys(settleOrder(day, new Set(['b']), (i) => i))).toEqual(['b', 'c', 'a']);
  });

  it('does nothing to a day that is entirely finished', () => {
    const day = [item('a', 'completed'), item('b', 'completed')];
    expect(keys(settleOrder(day, NONE, (i) => i))).toEqual(['a', 'b']);
  });
});
