import { civilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import { flaggedFirst, liveFlagsByChore, liveFlagsFor, toggleFlag, type ChoreFlag } from './flag';

const d = (s: string): CivilDate => civilDate(s);

const ME = 'user-me';
const THEM = 'user-them';

const flag = (choreId: string, flaggedOn: string, userId = ME): ChoreFlag => ({
  choreId,
  userId,
  flaggedOn: d(flaggedOn),
});

// An ordinary day. Nothing here computes a week any more; the date is only
// something for the fixtures to carry.
const THURSDAY = d('2026-08-27');

describe('a flag has no expiry', () => {
  /*
   * There used to be five tests here about week boundaries. A flag now lasts
   * until it is lifted or the chore is completed, and the completion is
   * cleared by a database trigger — so "is it live" has no calendar component
   * left and nothing in this module can answer it wrongly.
   *
   * What remains is the guarantee that age is not consulted: a flag from
   * months ago counts exactly as much as one raised this morning.
   */
  it('counts a flag from long ago the same as one from today', () => {
    const old = flag('gutters', '2026-01-04');
    const fresh = flag('dishes', '2026-08-12');

    expect(liveFlagsFor([old, fresh], ME)).toEqual(new Set(['gutters', 'dishes']));
  });

  it('counts a flag dated in the future, rather than hiding it', () => {
    // Nothing compares the date to anything, so a clock skew on one phone
    // cannot make a flag invisible to the other.
    expect(liveFlagsFor([flag('bins', '2027-01-01')], ME)).toEqual(new Set(['bins']));
  });
});

describe('whose flags', () => {
  const flags = [
    flag('dishes', '2026-08-25', ME),
    flag('trash', '2026-08-25', THEM),
    flag('plants', '2026-08-10', ME),
  ];

  it('returns only mine', () => {
    /*
     * `plants` is mine and months old; `trash` is theirs. Ownership
     * is the only thing that decides, so both have to be in the fixture — one
     * of each would pass against a filter that tested the wrong field.
     */
    expect([...liveFlagsFor(flags, ME)].sort()).toEqual(['dishes', 'plants']);
  });

  it('returns everyone for the shared view', () => {
    const byChore = liveFlagsByChore(flags);
    expect([...byChore.keys()].sort()).toEqual(['dishes', 'plants', 'trash']);
    expect(byChore.get('trash')).toEqual([THEM]);
  });

  it('gathers both people on one chore', () => {
    const both = liveFlagsByChore([flag('car', '2026-08-25', ME), flag('car', '2026-08-26', THEM)]);
    expect(both.get('car')?.length).toBe(2);
  });
});

describe('flagged first', () => {
  const items = [
    { choreId: 'a', n: 1 },
    { choreId: 'b', n: 2 },
    { choreId: 'c', n: 3 },
    { choreId: 'd', n: 4 },
  ];

  it('lifts the flagged ones without scrambling the rest', () => {
    // The order arriving here is already meaningful — urgency, or priority —
    // so pinning must be a partition rather than a sort. `c` before `a` in the
    // output would mean the caller's ordering had been thrown away.
    const out = flaggedFirst(items, new Set(['c', 'a']));
    expect(out.map((i) => i.choreId)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns the list untouched when nothing is flagged', () => {
    expect(flaggedFirst(items, new Set())).toBe(items);
  });

  it('keeps every item', () => {
    const out = flaggedFirst(items, new Set(['b']));
    expect(out.map((i) => i.choreId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('toggling', () => {
  it('raises a flag on something unflagged', () => {
    expect(toggleFlag(undefined, THURSDAY)).toBe(THURSDAY);
  });

  it('clears one that is there', () => {
    expect(toggleFlag(flag('c', '2026-08-25'), THURSDAY)).toBeNull();
  });

  it('clears an old one rather than re-raising it', () => {
    /*
     * The reverse of what this did before. A flag used to go invisible at the
     * end of its week while its row stayed, so tapping had to re-raise it or
     * the first tap appeared to do nothing. Now every row is visible, so a tap
     * on a flagged chore means what it looks like it means.
     */
    expect(toggleFlag(flag('c', '2026-01-04'), THURSDAY)).toBeNull();
  });
});
