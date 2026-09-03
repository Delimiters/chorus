import { clampToList, positionBetween, reorder, shiftFor, targetIndex } from './reorder';

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

describe('rows getting out of the way', () => {
  const H = 60;

  it('does not move the row being dragged', () => {
    expect(shiftFor(0, 3, 0, H)).toBe(0);
  });

  it('slides passed rows up when dragging down', () => {
    // Dragging row 0 down to 2: rows 1 and 2 move up into the gap it left,
    // and row 3 — which it never reached — stays put.
    expect(shiftFor(0, 2, 1, H)).toBe(-H);
    expect(shiftFor(0, 2, 2, H)).toBe(-H);
    expect(shiftFor(0, 2, 3, H)).toBe(0);
  });

  it('slides passed rows down when dragging up', () => {
    // Dragging row 3 up to 1: rows 1 and 2 move down. Direction is the thing
    // an off-by-one here gets wrong, and it looks like the list fighting you.
    expect(shiftFor(3, 1, 1, H)).toBe(H);
    expect(shiftFor(3, 1, 2, H)).toBe(H);
    expect(shiftFor(3, 1, 0, H)).toBe(0);
  });

  it('moves nothing when the row has not left its place', () => {
    expect(shiftFor(2, 2, 0, H)).toBe(0);
    expect(shiftFor(2, 2, 3, H)).toBe(0);
  });

  it('opens exactly one row-height of space, whatever the row is', () => {
    // The gap is the *dragged* row's height, not the passed row's — the whole
    // reason this list measures rows instead of assuming a uniform height.
    expect(shiftFor(0, 1, 1, 120)).toBe(-120);
  });
});

describe('keeping the dragged row inside the list', () => {
  // 40, 80, 40, 120, 40 — the same uneven set the rest of this file uses.
  it('allows a drag that stays within the list', () => {
    expect(clampToList(HEIGHTS, 2, 50)).toBe(50);
    expect(clampToList(HEIGHTS, 2, -50)).toBe(-50);
  });

  it('stops at the top and the bottom', () => {
    // Row 2 has 120 above it (40 + 80) and 160 below (120 + 40).
    expect(clampToList(HEIGHTS, 2, -500)).toBe(-120);
    expect(clampToList(HEIGHTS, 2, 500)).toBe(160);
  });

  it('measures the room, rather than assuming a row height', () => {
    // The first row has nothing above it and everything below.
    expect(clampToList(HEIGHTS, 0, -10)).toBe(0);
    expect(clampToList(HEIGHTS, 0, 9999)).toBe(280);
  });

  it('leaves an index that is not in the list alone', () => {
    expect(clampToList(HEIGHTS, 9, 500)).toBe(500);
  });
});

describe('the ends of the list are reachable', () => {
  const UNIFORM = [60, 60, 60];

  it('reaches the last slot at the furthest a row can be dragged', () => {
    /*
     * Held inside the list, the top row's furthest travel is 120 — which puts
     * its centre at 150, exactly the last row's midpoint. A strictly-greater
     * comparison made the last slot unreachable however hard you dragged, and
     * clamping the drag is what exposed it.
     */
    const furthest = clampToList(UNIFORM, 0, 9999);
    expect(targetIndex(UNIFORM, 0, furthest)).toBe(2);
  });

  it('reaches the first slot in the same way', () => {
    const furthest = clampToList(UNIFORM, 2, -9999);
    expect(targetIndex(UNIFORM, 2, furthest)).toBe(0);
  });
});

describe('the ends stay reachable for a row that is not average height', () => {
  /*
   * A two-line chore among one-line ones — the case this list measures rows
   * for in the first place, and the case a uniform fixture cannot see.
   *
   * Clamping to the summed heights above and below stopped the tall row's
   * centre short of the midpoint it had to cross, so it could not be dragged to
   * either end at all. The reachability test written alongside that clamp used
   * three identical rows, the one shape where the arithmetic coincides.
   */
  const TALL_SECOND = [56, 88, 56, 56];

  it('can be dragged to the top', () => {
    const furthest = clampToList(TALL_SECOND, 1, -9999);
    expect(targetIndex(TALL_SECOND, 1, furthest)).toBe(0);
  });

  it('can be dragged to the bottom', () => {
    const furthest = clampToList(TALL_SECOND, 1, 9999);
    expect(targetIndex(TALL_SECOND, 1, furthest)).toBe(3);
  });

  it('holds for every row of every uneven list', () => {
    // The property, rather than two examples: from anywhere, dragging as far as
    // the clamp allows must reach the end you are dragging towards.
    for (const heights of [TALL_SECOND, HEIGHTS, [120, 40, 40], [40, 40, 120]]) {
      for (let from = 0; from < heights.length; from += 1) {
        expect(targetIndex(heights, from, clampToList(heights, from, -9999))).toBe(0);
        expect(targetIndex(heights, from, clampToList(heights, from, 9999))).toBe(
          heights.length - 1,
        );
      }
    }
  });
});
