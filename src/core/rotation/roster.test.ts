/**
 * Roster changes.
 *
 * One guarantee, stated once and then tested from several angles: **a roster
 * change never alters who was responsible in the past.** Everything else here
 * is a consequence of it.
 *
 * This matters because the failure is silent and permanent. Rewriting a
 * settled segment does not error, does not warn, and does not look wrong on any
 * screen — it just means last month's answer to "whose turn was it?" quietly
 * becomes a different answer, and the stats view built on that history is
 * wrong from then on.
 */

import { civilDate } from '../civil/date';
import type { CalendarConfig, CivilDate } from '../civil/types';
import { assigneeFor } from './assign';
import { rosterChangeDate, rosterIsStale, withRoster } from './roster';
import type { Assignment } from './types';

const d = (s: string): CivilDate => civilDate(s);
const CAL: CalendarConfig = { weekStartsOn: 0 };

const ALICE = 'alice';
const BOB = 'bob';
const CARO = 'caro';

const ANCHOR = d('2026-01-05'); // a Monday

const rotating = (segments: Assignment extends { segments: infer S } ? S : never): Assignment =>
  ({
    kind: 'rotate',
    cadence: { unit: 'occurrence', every: 1 },
    segments,
  }) as Assignment;

const original = rotating([{ effectiveFrom: ANCHOR, memberIds: [ALICE, BOB], offset: 0 }] as never);

/** Who owns the occurrence at a given index and date. */
const owner = (assignment: Assignment, index: number, dueOn: CivilDate): string | null => {
  const resolved = assigneeFor(
    {
      choreId: 'c',
      occurrenceKey: `k${index}`,
      occurrenceIndex: index,
      dueOn,
      flexibleFrom: dueOn,
      flexibleUntil: dueOn,
      periodKey: String(dueOn),
      slot: 0,
      subject: null,
    } as never,
    assignment,
    CAL,
    ANCHOR,
  );
  return resolved.kind === 'member' ? resolved.memberId : null;
};

describe('appending a roster', () => {
  const change = withRoster({
    assignment: original,
    roster: [ALICE, BOB, CARO],
    effectiveFrom: d('2026-03-01'),
    lastAssigneeId: BOB,
    nextTurn: 8,
  });

  it('keeps the segment that was already in effect, untouched', () => {
    expect(change.kind).toBe('rotate');
    if (change.kind !== 'rotate') return;
    expect(change.segments[0]).toEqual({
      effectiveFrom: ANCHOR,
      memberIds: [ALICE, BOB],
      offset: 0,
    });
  });

  it('adds a second segment rather than editing the first', () => {
    if (change.kind !== 'rotate') return;
    expect(change.segments).toHaveLength(2);
    expect(change.segments[1]?.effectiveFrom).toBe('2026-03-01');
    expect(change.segments[1]?.memberIds).toEqual([ALICE, BOB, CARO]);
  });

  it('leaves every past occurrence assigned to exactly who had it', () => {
    // The guarantee, checked the way it actually matters: by asking who owned
    // each past occurrence before and after the change.
    for (let i = 0; i < 8; i += 1) {
      const before = owner(original, i, d('2026-01-05'));
      const after = owner(change, i, d('2026-01-05'));
      expect(after).toBe(before);
    }
  });

  it('continues the existing cycle rather than restarting it', () => {
    // Bob went last, so Alice is next — the rotation carries on exactly as it
    // would have, and Caro joins at her position in the list rather than
    // jumping the queue. Restarting at the top instead would be visible as
    // somebody getting two turns in a row across the boundary.
    expect(owner(change, 8, d('2026-03-02'))).toBe(ALICE);
    expect(owner(change, 9, d('2026-03-03'))).toBe(BOB);
    expect(owner(change, 10, d('2026-03-04'))).toBe(CARO);
  });

  it('gives the new person a turn within one cycle', () => {
    // The thing somebody joining actually cares about: not being invisible.
    const owners = [8, 9, 10].map((i) => owner(change, i, d('2026-03-02')));
    expect(owners).toContain(CARO);
  });
});

describe('changing your mind before it takes effect', () => {
  it('replaces a segment that has not started yet, rather than stacking another', () => {
    // Nothing has ever been assigned under a future segment, so there is no
    // history to protect — and two segments arguing about the same future is
    // its own bug.
    const first = withRoster({
      assignment: original,
      roster: [ALICE, BOB, CARO],
      effectiveFrom: d('2026-03-01'),
      lastAssigneeId: BOB,
      nextTurn: 8,
    });
    const second = withRoster({
      assignment: first,
      roster: [ALICE, CARO],
      effectiveFrom: d('2026-03-01'),
      lastAssigneeId: BOB,
      nextTurn: 8,
    });

    if (second.kind !== 'rotate') throw new Error('expected a rotation');
    expect(second.segments).toHaveLength(2);
    expect(second.segments[1]?.memberIds).toEqual([ALICE, CARO]);
  });

  it('still refuses to touch a segment that has taken effect', () => {
    const later = withRoster({
      assignment: original,
      roster: [CARO],
      // Well after the original took effect.
      effectiveFrom: d('2026-06-01'),
      lastAssigneeId: ALICE,
      nextTurn: 20,
    });
    if (later.kind !== 'rotate') throw new Error('expected a rotation');
    expect(later.segments[0]?.memberIds).toEqual([ALICE, BOB]);
  });
});

describe('turning a non-rotating chore into a rotating one', () => {
  it('starts one segment, because there is no history to keep', () => {
    const result = withRoster({
      assignment: { kind: 'anyone' },
      roster: [ALICE, BOB],
      effectiveFrom: d('2026-03-01'),
      lastAssigneeId: null,
      nextTurn: 0,
    });
    if (result.kind !== 'rotate') throw new Error('expected a rotation');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.offset).toBe(0);
  });
});

describe('when a change should take effect', () => {
  it('is tomorrow, not today', () => {
    // Today's occurrence may already be on somebody's screen. Moving it out
    // from under them mid-day is worse than starting tomorrow.
    expect(rosterChangeDate(d('2026-07-31'))).toBe('2026-08-01');
  });
});

describe('spotting a rotation that has drifted from the household', () => {
  it('notices somebody who has left', () => {
    // A rotation containing a departed housemate keeps handing them turns, and
    // nothing on the agenda explains why a chore belongs to nobody who lives
    // here.
    expect(rosterIsStale(original, [ALICE, CARO], d('2026-02-01'))).toBe(true);
  });

  it('notices somebody who has joined and was never added', () => {
    expect(rosterIsStale(original, [ALICE, BOB, CARO], d('2026-02-01'))).toBe(true);
  });

  it('is quiet when the rotation matches the household', () => {
    expect(rosterIsStale(original, [ALICE, BOB], d('2026-02-01'))).toBe(false);
  });

  it('says nothing about a chore that does not rotate', () => {
    expect(rosterIsStale({ kind: 'anyone' }, [ALICE], d('2026-02-01'))).toBe(false);
    expect(rosterIsStale({ kind: 'fixed', memberId: ALICE }, [ALICE], d('2026-02-01'))).toBe(false);
  });

  it('flags a rotation with nobody in it', () => {
    const empty = rotating([{ effectiveFrom: ANCHOR, memberIds: [], offset: 0 }] as never);
    expect(rosterIsStale(empty, [ALICE], d('2026-02-01'))).toBe(true);
  });
});
