import fc from 'fast-check';

import {
  comparePriority,
  DEFAULT_PRIORITY,
  describePriority,
  isPriority,
  PRIORITIES,
  priorityRank,
  toPriority,
  type Priority,
} from './priority';

const anyPriority = fc.constantFrom(...PRIORITIES);

/**
 * `Math.sign` with -0 normalised to 0.
 *
 * Without this the antisymmetry property fails on every equal pair, because
 * `Math.sign(0)` is `0`, `-Math.sign(0)` is `-0`, and Jest's `toBe` is
 * `Object.is`, which distinguishes them. A test artefact, not a defect.
 */
const sign = (n: number): number => Math.sign(n) || 0;

describe('priority', () => {
  it('orders most important first', () => {
    expect([...PRIORITIES]).toEqual(['crucial', 'normal', 'minor']);
    expect(comparePriority('crucial', 'minor')).toBeLessThan(0);
    expect(comparePriority('minor', 'crucial')).toBeGreaterThan(0);
    expect(comparePriority('normal', 'normal')).toBe(0);
  });

  it('defaults to normal, so an unset priority inflates nothing', () => {
    expect(DEFAULT_PRIORITY).toBe('normal');
    expect(comparePriority(DEFAULT_PRIORITY, 'crucial')).toBeGreaterThan(0);
    expect(comparePriority(DEFAULT_PRIORITY, 'minor')).toBeLessThan(0);
  });

  it('sorts a shuffled list back into declaration order', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...PRIORITIES], { minLength: 3 }), (shuffled) => {
        expect([...shuffled].sort(comparePriority)).toEqual([...PRIORITIES]);
      }),
    );
  });

  describe('as a comparator it is a total order', () => {
    it('is antisymmetric', () => {
      fc.assert(
        fc.property(anyPriority, anyPriority, (a, b) => {
          expect(sign(comparePriority(a, b))).toBe(sign(-comparePriority(b, a)));
        }),
      );
    });

    it('is transitive', () => {
      fc.assert(
        fc.property(anyPriority, anyPriority, anyPriority, (a, b, c) => {
          if (comparePriority(a, b) <= 0 && comparePriority(b, c) <= 0) {
            expect(comparePriority(a, c)).toBeLessThanOrEqual(0);
          }
        }),
      );
    });

    it('agrees with rank', () => {
      fc.assert(
        fc.property(anyPriority, anyPriority, (a, b) => {
          expect(sign(comparePriority(a, b))).toBe(sign(priorityRank(a) - priorityRank(b)));
        }),
      );
    });
  });

  describe('reading values that crossed the database boundary', () => {
    it('accepts exactly the three levels', () => {
      fc.assert(
        fc.property(anyPriority, (p) => {
          expect(isPriority(p)).toBe(true);
          expect(toPriority(p)).toBe(p);
        }),
      );
    });

    it('rejects anything else', () => {
      for (const value of [null, undefined, 0, 1, '', 'CRUCIAL', 'urgent', {}, []]) {
        expect(isPriority(value)).toBe(false);
      }
    });

    it('degrades an unknown level to the default rather than corrupting a sort', () => {
      // The point: a row written by a future version with a fourth level must
      // not produce NaN out of priorityRank and scramble the order.
      expect(toPriority('blocker')).toBe(DEFAULT_PRIORITY);
      expect(priorityRank(toPriority('blocker'))).toBe(priorityRank(DEFAULT_PRIORITY));
      expect(Number.isNaN(priorityRank(toPriority('blocker')))).toBe(false);
    });

    it('never returns a value outside PRIORITIES, for any input at all', () => {
      fc.assert(
        fc.property(fc.anything(), (value) => {
          expect(PRIORITIES).toContain(toPriority(value));
        }),
      );
    });
  });

  it('labels every level, with no gaps', () => {
    const labels = PRIORITIES.map((p: Priority) => describePriority(p));
    expect(labels).toEqual(['Crucial', 'Normal', 'Minor']);
    expect(new Set(labels).size).toBe(PRIORITIES.length);
  });
});
