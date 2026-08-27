import { civilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import {
  flaggedFirst,
  isFlagLive,
  liveFlagsByChore,
  liveFlagsFor,
  toggleFlag,
  type ChoreFlag,
} from './flag';

const d = (s: string): CivilDate => civilDate(s);

const ME = 'user-me';
const THEM = 'user-them';

const flag = (choreId: string, flaggedOn: string, userId = ME): ChoreFlag => ({
  choreId,
  userId,
  flaggedOn: d(flaggedOn),
});

// 2026-08-27 is a Thursday. Monday of its week is 2026-08-24, Sunday 2026-08-23.
const THURSDAY = d('2026-08-27');

describe('a flag is live only for its own week', () => {
  it('counts a flag raised earlier the same week', () => {
    expect(isFlagLive(flag('c', '2026-08-25'), THURSDAY, 1)).toBe(true);
  });

  it('lets last week go', () => {
    expect(isFlagLive(flag('c', '2026-08-20'), THURSDAY, 1)).toBe(false);
  });

  it('is decided by the week boundary, not by how many days ago', () => {
    /*
     * The distinguishing case, and the reason this is not `daysBetween <= 7`.
     * Sunday 2026-08-23 is four days before Thursday either way — but with a
     * Monday week start it belongs to the *previous* week and is dead, and
     * with a Sunday start it is this week and is live. An age-based
     * implementation returns true for both and passes a test that only ever
     * asks one of them.
     */
    const sunday = flag('c', '2026-08-23');
    expect(isFlagLive(sunday, THURSDAY, 1)).toBe(false);
    expect(isFlagLive(sunday, THURSDAY, 0)).toBe(true);
  });

  it('counts the day it was raised', () => {
    expect(isFlagLive(flag('c', '2026-08-27'), THURSDAY, 1)).toBe(true);
  });

  it('does not count a flag from the future week', () => {
    expect(isFlagLive(flag('c', '2026-09-02'), THURSDAY, 1)).toBe(false);
  });
});

describe('whose flags', () => {
  const flags = [
    flag('dishes', '2026-08-25', ME),
    flag('trash', '2026-08-25', THEM),
    flag('plants', '2026-08-10', ME),
  ];

  it('returns only mine, and only this week', () => {
    // Three flags, three different reasons to be included or not — so a
    // fixture where every flag qualifies cannot pass this.
    expect([...liveFlagsFor(flags, ME, THURSDAY, 1)]).toEqual(['dishes']);
  });

  it('returns everyone for the shared view', () => {
    const byChore = liveFlagsByChore(flags, THURSDAY, 1);
    expect([...byChore.keys()].sort()).toEqual(['dishes', 'trash']);
    expect(byChore.get('trash')).toEqual([THEM]);
  });

  it('gathers both people on one chore', () => {
    const both = liveFlagsByChore(
      [flag('car', '2026-08-25', ME), flag('car', '2026-08-26', THEM)],
      THURSDAY,
      1,
    );
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
    expect(toggleFlag(undefined, THURSDAY, 1)).toBe(THURSDAY);
  });

  it('clears one raised this week', () => {
    expect(toggleFlag(flag('c', '2026-08-25'), THURSDAY, 1)).toBeNull();
  });

  it('re-raises a stale one rather than clearing something invisible', () => {
    // The row exists but is not live, so the person sees an unflagged chore.
    // Clearing it would make their first tap appear to do nothing.
    expect(toggleFlag(flag('c', '2026-07-01'), THURSDAY, 1)).toBe(THURSDAY);
  });
});
