import { positionBetween, reorder, targetIndex } from './reorder';

// Deliberately uneven: uniform heights make every off-by-one in the cumulative
// arithmetic invisible, because every row is its own neighbour's size.
const HEIGHTS = [40, 80, 40, 120, 40];

describe('where a dragged row lands', () => {
  it('stays put when it has barely moved', () => {
    expect(targetIndex(HEIGHTS, 0, 5)).toBe(0);
  });

  it('passes a row once its centre clears that row&apos;s midpoint', () => {
    /*
     * Row 0 is 40 tall, centre at 20. Row 1 is 80 tall, spanning 40–120, so its
     * midpoint is 80. A drag of 55 puts the centre at 75 — not past it yet.
     * A drag of 65 puts it at 85, which is.
     */
    expect(targetIndex(HEIGHTS, 0, 55)).toBe(0);
    expect(targetIndex(HEIGHTS, 0, 65)).toBe(1);
  });

  it('does not swap on the first pixel of overlap', () => {
    // Comparing edges rather than midpoints makes the list twitch away from
    // your finger the moment two rows touch.
    expect(targetIndex(HEIGHTS, 0, 21)).toBe(0);
  });

  it('accounts for a tall row taking longer to pass', () => {
    /*
     * The case a fixed row height gets wrong. Row 3 is 120 tall: dragging row 2
     * down past it needs far more travel than passing the 40-tall row 4, and an
     * implementation assuming uniform rows lands a place early.
     *
     * Row 2 spans 120–160, centre 140. Row 3 spans 160–280, midpoint 220.
     */
    expect(targetIndex(HEIGHTS, 2, 60)).toBe(2);
    expect(targetIndex(HEIGHTS, 2, 90)).toBe(3);
  });

  it('moves up as well as down', () => {
    // Row 3 spans 160–280, centre 220. Row 2 spans 120–160, midpoint 140.
    expect(targetIndex(HEIGHTS, 3, -60)).toBe(3);
    expect(targetIndex(HEIGHTS, 3, -90)).toBe(2);
  });

  it('cannot be dragged off either end', () => {
    expect(targetIndex(HEIGHTS, 0, -500)).toBe(0);
    expect(targetIndex(HEIGHTS, 4, 500)).toBe(4);
  });

  it('survives an empty list and an index that is not in it', () => {
    expect(targetIndex([], 0, 10)).toBe(0);
    expect(targetIndex(HEIGHTS, 9, 10)).toBe(9);
  });
});

describe('reordering the list', () => {
  const items = ['a', 'b', 'c', 'd'];

  it('moves an item down', () => {
    expect(reorder(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(reorder(items, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the same list when nothing moved', () => {
    expect(reorder(items, 1, 1)).toBe(items);
  });

  it('keeps every item', () => {
    // Identity, not length: two lists of four also holds for an implementation
    // that duplicates one item and drops another.
    expect([...reorder(items, 0, 3)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the position a moved row takes', () => {
  it('lands between its new neighbours', () => {
    expect(positionBetween(1, 2)).toBe(1.5);
  });

  it('goes above everything, and below everything', () => {
    expect(positionBetween(null, 1)).toBe(0);
    expect(positionBetween(3, null)).toBe(4);
  });

  it('handles the only row in the list', () => {
    expect(positionBetween(null, null)).toBe(1);
  });

  it('keeps producing a value strictly between, repeatedly', () => {
    /*
     * The failure mode of averaging is running out of room, and asserting one
     * drag says nothing about the fiftieth. Floats collide at about the 53rd
     * successive drag into the same gap; fifty is inside the safe range and is
     * far more drags into one place than anybody makes.
     */
    let low = 1;
    const high = 2;
    for (let i = 0; i < 50; i += 1) {
      const mid = positionBetween(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      low = mid;
    }
  });
});
