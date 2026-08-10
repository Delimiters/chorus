/**
 * Property tests for rotation. P-numbers refer to docs/TESTING.md.
 *
 * P11 and P12 are the direct structural guards against the prototype's
 * stuck-rotation bug — see docs/POSTMORTEM-SWIFT.md #2.
 */

import fc from 'fast-check';

import { addDays, civilDate } from '../civil/date';
import type { CalendarConfig, CivilDate } from '../civil/types';
import { projectOccurrences } from '../occurrence/project';
import { expandOccurrences } from '../recurrence/expand';
import type { Occurrence, Schedule } from '../recurrence/types';
import { assigneeFor, nextSegmentOffset, segmentFor } from './assign';
import type { Assignment, RotationCadence, RotationSegment } from './types';

const CAL: CalendarConfig = { weekStartsOn: 0 };
const ANCHOR = civilDate('2026-01-04'); // a Sunday

const arbRoster = (min = 1, max = 5): fc.Arbitrary<readonly string[]> =>
  fc.uniqueArray(
    fc.integer({ min: 0, max: 20 }).map((n) => `member-${n}`),
    { minLength: min, maxLength: max },
  );

const arbCadence = (): fc.Arbitrary<RotationCadence> =>
  fc.oneof(
    fc.record({ unit: fc.constant('occurrence' as const), every: fc.integer({ min: 1, max: 4 }) }),
    fc.record({ unit: fc.constant('week' as const), every: fc.integer({ min: 1, max: 4 }) }),
    fc.record({ unit: fc.constant('month' as const), every: fc.integer({ min: 1, max: 3 }) }),
  );

const rotateWith = (
  memberIds: readonly string[],
  cadence: RotationCadence = { unit: 'occurrence', every: 1 },
  effectiveFrom: CivilDate = ANCHOR,
  offset = 0,
): Assignment => ({
  kind: 'rotate',
  cadence,
  segments: [{ effectiveFrom, memberIds, offset }],
});

/** Daily occurrences from the anchor — the simplest sequence to reason about. */
function dailyOccurrences(count: number): readonly Occurrence[] {
  const schedule: Schedule = {
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: ANCHOR,
    endsOn: null,
    timesOfDay: [],
  };
  return expandOccurrences('chore', schedule, CAL, {
    start: ANCHOR,
    end: addDays(ANCHOR, count - 1),
  });
}

describe('P10 — rotation fairness', () => {
  it('gives each member exactly k turns over k×roster consecutive occurrences', () => {
    fc.assert(
      fc.property(arbRoster(1, 5), fc.integer({ min: 1, max: 6 }), (roster, k) => {
        const total = k * roster.length;
        const occurrences = dailyOccurrences(total);
        const assignment = rotateWith(roster);

        const counts = new Map<string, number>();
        for (const occ of occurrences) {
          const resolved = assigneeFor(occ, assignment, CAL, ANCHOR);
          if (resolved.kind !== 'member') throw new Error('expected a member');
          counts.set(resolved.memberId, (counts.get(resolved.memberId) ?? 0) + 1);
        }

        expect(counts.size).toBe(roster.length);
        for (const member of roster) expect(counts.get(member)).toBe(k);
      }),
    );
  });

  it('cycles in roster order', () => {
    const roster = ['alice', 'bob', 'carol'];
    const assignment = rotateWith(roster);
    const assignees = dailyOccurrences(7).map((occ) => {
      const r = assigneeFor(occ, assignment, CAL, ANCHOR);
      return r.kind === 'member' ? r.memberId : null;
    });
    expect(assignees).toEqual(['alice', 'bob', 'carol', 'alice', 'bob', 'carol', 'alice']);
  });

  it('honours the segment offset', () => {
    const roster = ['alice', 'bob', 'carol'];
    const assignment = rotateWith(roster, { unit: 'occurrence', every: 1 }, ANCHOR, 1);
    const assignees = dailyOccurrences(3).map((occ) => {
      const r = assigneeFor(occ, assignment, CAL, ANCHOR);
      return r.kind === 'member' ? r.memberId : null;
    });
    expect(assignees).toEqual(['bob', 'carol', 'alice']);
  });

  it('advances only every N occurrences when the cadence says so', () => {
    const assignment = rotateWith(['alice', 'bob'], { unit: 'occurrence', every: 2 });
    const assignees = dailyOccurrences(6).map((occ) => {
      const r = assigneeFor(occ, assignment, CAL, ANCHOR);
      return r.kind === 'member' ? r.memberId : null;
    });
    expect(assignees).toEqual(['alice', 'alice', 'bob', 'bob', 'alice', 'alice']);
  });
});

describe('P11 — rotation is completion-independent', () => {
  // The core structural guard against the prototype's stuck rotation.
  //
  // This used to call `assigneeFor` twice with IDENTICAL arguments and assert
  // equality — which is determinism restated, and would have passed even if the
  // function were entirely wrong. It constructed no completions at all. The real
  // property has to run through the projector, because that is the only place
  // completions and exceptions exist. Stated properly, it catches the bug where
  // a reschedule moved the rotation turn to the other person.
  it('assignees are identical under arbitrary completions and exceptions', () => {
    fc.assert(
      fc.property(
        arbRoster(2, 4),
        arbCadence(),
        // Arbitrary sets of deviations over the same window.
        fc.uniqueArray(fc.nat({ max: 29 }), { maxLength: 12 }),
        fc.uniqueArray(fc.nat({ max: 29 }), { maxLength: 8 }),
        (roster, cadence, completedIndexes, skippedIndexes) => {
          const assignment = rotateWith(roster, cadence);
          const chore = {
            id: 'chore',
            title: 'Rotating chore',
            schedule: {
              rule: { kind: 'daily' as const, everyNDays: 1 },
              startsOn: ANCHOR,
              endsOn: null,
              timesOfDay: [],
            },
            assignment,
            archived: false,
          };
          const window = { start: ANCHOR, end: addDays(ANCHOR, 29) };
          const base = {
            chores: [chore],
            memberIds: [...roster],
            today: addDays(ANCHOR, 15),
          };

          const clean = projectOccurrences(
            { ...base, completions: [], exceptions: [] },
            CAL,
            window,
          );

          // Turn the index sets into real completions and skips.
          const completions = completedIndexes
            .map((i) => clean[i])
            .filter((o): o is NonNullable<typeof o> => o !== undefined)
            .map((o) => ({
              choreId: 'chore',
              occurrenceKey: o.occurrenceKey,
              completedOn: o.dueOn,
              completedBy: roster[0] as string,
            }));
          const exceptions = skippedIndexes
            .map((i) => clean[i])
            .filter((o): o is NonNullable<typeof o> => o !== undefined)
            // Skip only where there is no completion, so the two don't collide.
            .filter((o) => !completions.some((c) => c.occurrenceKey === o.occurrenceKey))
            .map((o) => ({
              choreId: 'chore',
              occurrenceKey: o.occurrenceKey,
              kind: 'skip' as const,
              movedTo: null,
            }));

          const withHistory = projectOccurrences({ ...base, completions, exceptions }, CAL, window);

          // Same occurrences, same assignees. Only status may differ.
          const assigneesOf = (list: readonly { occurrenceKey: string; assignee: unknown }[]) =>
            list.map((o) => [o.occurrenceKey, JSON.stringify(o.assignee)]);
          expect(assigneesOf(withHistory)).toEqual(assigneesOf(clean));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a reschedule moves the date but never the assignee', () => {
    // The specific case the old test missed by using an occurrence-based cadence,
    // the one cadence where `dueOn` is not an input at all.
    fc.assert(
      fc.property(
        arbCadence(),
        fc.nat({ max: 10 }),
        fc.integer({ min: 1, max: 20 }),
        (cadence, targetIndex, moveBy) => {
          const assignment = rotateWith(['alice', 'bob'], cadence);
          const chore = {
            id: 'chore',
            title: 'Rotating chore',
            schedule: {
              rule: { kind: 'weekly' as const, everyNWeeks: 1, weekdays: [3 as const] },
              startsOn: ANCHOR,
              endsOn: null,
              timesOfDay: [],
            },
            assignment,
            archived: false,
          };
          const window = { start: ANCHOR, end: addDays(ANCHOR, 90) };
          const base = {
            chores: [chore],
            memberIds: ['alice', 'bob'],
            today: addDays(ANCHOR, 45),
            completions: [],
          };

          const before = projectOccurrences({ ...base, exceptions: [] }, CAL, window);
          const target = before[targetIndex];
          if (target === undefined) return;

          const after = projectOccurrences(
            {
              ...base,
              exceptions: [
                {
                  choreId: 'chore',
                  occurrenceKey: target.occurrenceKey,
                  kind: 'reschedule' as const,
                  movedTo: addDays(target.dueOn, moveBy),
                },
              ],
            },
            CAL,
            window,
          );

          const moved = after.find((o) => o.occurrenceKey === target.occurrenceKey);
          if (moved === undefined) return; // moved outside the window
          expect(moved.assignee).toEqual(target.assignee);

          // And nobody else's turn changed either.
          for (const other of after) {
            if (other.occurrenceKey === target.occurrenceKey) continue;
            const original = before.find((o) => o.occurrenceKey === other.occurrenceKey);
            expect(other.assignee).toEqual(original?.assignee);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('advances across a week nobody completed', () => {
    // Weekly chore, weekly rotation, four weeks, zero completions.
    const schedule: Schedule = {
      rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1] },
      startsOn: ANCHOR,
      endsOn: null,
      timesOfDay: [],
    };
    const occurrences = expandOccurrences('chore', schedule, CAL, {
      start: ANCHOR,
      end: addDays(ANCHOR, 27),
    });
    const assignment = rotateWith(['alice', 'bob'], { unit: 'week', every: 1 });

    const assignees = occurrences.map((occ) => {
      const r = assigneeFor(occ, assignment, CAL, ANCHOR);
      return r.kind === 'member' ? r.memberId : null;
    });
    // The prototype would have returned alice, alice, alice, alice.
    expect(assignees).toEqual(['alice', 'bob', 'alice', 'bob']);
  });
});

describe('P12/P13 — deviations do not disturb the rotation', () => {
  it('is a function of the occurrence alone, so skipping one changes no other', () => {
    const assignment = rotateWith(['alice', 'bob', 'carol']);
    const occurrences = dailyOccurrences(9);

    const before = occurrences.map((o) => assigneeFor(o, assignment, CAL, ANCHOR));
    // "Skip" occurrence 3 — in the real projector this hides it from the
    // agenda. Its index is unchanged, so everything downstream is unchanged.
    const remaining = occurrences.filter((_, i) => i !== 3);
    const after = remaining.map((o) => assigneeFor(o, assignment, CAL, ANCHOR));

    expect(after).toEqual(before.filter((_, i) => i !== 3));
  });

  it('keeps the assignee when an occurrence is rescheduled with its index intact', () => {
    // A rescheduled occurrence retains occurrenceIndex, so an occurrence-cadence
    // rotation resolves to the same person on the new date.
    const assignment = rotateWith(['alice', 'bob', 'carol']);
    const [occ] = dailyOccurrences(1);
    const original = occ as Occurrence;
    const moved: Occurrence = { ...original, dueOn: addDays(original.dueOn, 5) };

    expect(assigneeFor(moved, assignment, CAL, ANCHOR)).toEqual(
      assigneeFor(original, assignment, CAL, ANCHOR),
    );
  });
});

describe('P14 — segment history is immutable', () => {
  it('appending a segment changes no assignee before its effective date', () => {
    fc.assert(
      fc.property(
        arbRoster(2, 4),
        arbRoster(2, 4),
        fc.integer({ min: 1, max: 25 }),
        fc.nat({ max: 5 }),
        (rosterA, rosterB, splitDay, offset) => {
          const occurrences = dailyOccurrences(30);
          const effectiveFrom = addDays(ANCHOR, splitDay);

          const before: Assignment = rotateWith(rosterA);
          const after: Assignment = {
            kind: 'rotate',
            cadence: { unit: 'occurrence', every: 1 },
            segments: [
              { effectiveFrom: ANCHOR, memberIds: rosterA, offset: 0 },
              { effectiveFrom, memberIds: rosterB, offset },
            ],
          };

          for (const occ of occurrences) {
            if (occ.dueOn >= effectiveFrom) continue;
            expect(assigneeFor(occ, after, CAL, ANCHOR)).toEqual(
              assigneeFor(occ, before, CAL, ANCHOR),
            );
          }
        },
      ),
    );
  });

  it('uses the newest segment that has taken effect', () => {
    const segments: RotationSegment[] = [
      { effectiveFrom: civilDate('2026-01-01'), memberIds: ['alice'], offset: 0 },
      { effectiveFrom: civilDate('2026-02-01'), memberIds: ['bob'], offset: 0 },
      { effectiveFrom: civilDate('2026-03-01'), memberIds: ['carol'], offset: 0 },
    ];
    expect(segmentFor(segments, civilDate('2026-01-15'))?.memberIds).toEqual(['alice']);
    expect(segmentFor(segments, civilDate('2026-02-01'))?.memberIds).toEqual(['bob']);
    expect(segmentFor(segments, civilDate('2026-06-01'))?.memberIds).toEqual(['carol']);
    expect(segmentFor(segments, civilDate('2025-12-31'))).toBeNull();
  });

  it('is unassignable before the first segment', () => {
    const assignment = rotateWith(
      ['alice'],
      { unit: 'occurrence', every: 1 },
      civilDate('2026-06-01'),
    );
    const [occ] = dailyOccurrences(1);
    expect(assigneeFor(occ as Occurrence, assignment, CAL, ANCHOR)).toEqual({
      kind: 'unassignable',
      reason: 'no-applicable-segment',
    });
  });

  it('is unassignable with an empty roster', () => {
    const assignment: Assignment = {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: ANCHOR, memberIds: [], offset: 0 }],
    };
    const [occ] = dailyOccurrences(1);
    expect(assigneeFor(occ as Occurrence, assignment, CAL, ANCHOR)).toEqual({
      kind: 'unassignable',
      reason: 'empty-roster',
    });
  });
});

describe('nextSegmentOffset', () => {
  it('puts the next person up on the next turn', () => {
    // alice just went; bob should be next in the new roster.
    const offset = nextSegmentOffset(['alice', 'bob'], 'alice', ['alice', 'bob'], 10);
    const assignment: Assignment = {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: ANCHOR, memberIds: ['alice', 'bob'], offset }],
    };
    const occ = { ...(dailyOccurrences(1)[0] as Occurrence), occurrenceIndex: 10 };
    const resolved = assigneeFor(occ, assignment, CAL, ANCHOR);
    expect(resolved.kind === 'member' && resolved.memberId).toBe('bob');
  });

  it('skips a departed member when choosing who is next', () => {
    // bob just went, carol would be next, but carol has left.
    const offset = nextSegmentOffset(['alice', 'bob', 'carol'], 'bob', ['alice', 'bob'], 0);
    const assignment: Assignment = {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: ANCHOR, memberIds: ['alice', 'bob'], offset }],
    };
    const occ = { ...(dailyOccurrences(1)[0] as Occurrence), occurrenceIndex: 0 };
    const resolved = assigneeFor(occ, assignment, CAL, ANCHOR);
    expect(resolved.kind === 'member' && resolved.memberId).toBe('alice');
  });

  it('always yields an offset within the roster', () => {
    fc.assert(
      fc.property(
        arbRoster(1, 5),
        arbRoster(1, 5),
        fc.option(fc.string(), { nil: null }),
        fc.integer({ min: 0, max: 100 }),
        (prev, next, last, turn) => {
          const offset = nextSegmentOffset(prev, last, next, turn);
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(offset).toBeLessThan(next.length);
        },
      ),
    );
  });

  it('returns 0 for an empty new roster', () => {
    expect(nextSegmentOffset(['alice'], 'alice', [], 3)).toBe(0);
  });
});

describe('non-rotating assignments', () => {
  it('anyone resolves to anyone', () => {
    const [occ] = dailyOccurrences(1);
    expect(assigneeFor(occ as Occurrence, { kind: 'anyone' }, CAL, ANCHOR)).toEqual({
      kind: 'anyone',
    });
  });

  it('fixed always resolves to the same member', () => {
    const assignment: Assignment = { kind: 'fixed', memberId: 'alice' };
    for (const occ of dailyOccurrences(5)) {
      expect(assigneeFor(occ, assignment, CAL, ANCHOR)).toEqual({
        kind: 'member',
        memberId: 'alice',
        turn: 0,
      });
    }
  });

  it('everyone resolves to the occurrence subject', () => {
    const schedule: Schedule = {
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: ANCHOR,
      endsOn: null,
      timesOfDay: [],
    };
    const [occ] = expandOccurrences(
      'chore',
      schedule,
      CAL,
      {
        start: ANCHOR,
        end: ANCHOR,
      },
      'bob',
    );
    expect(assigneeFor(occ as Occurrence, { kind: 'everyone' }, CAL, ANCHOR)).toEqual({
      kind: 'member',
      memberId: 'bob',
      turn: 0,
    });
  });

  it('everyone is unassignable without a subject', () => {
    const [occ] = dailyOccurrences(1);
    expect(assigneeFor(occ as Occurrence, { kind: 'everyone' }, CAL, ANCHOR)).toEqual({
      kind: 'unassignable',
      reason: 'empty-roster',
    });
  });
});

describe('cadence independence from the chore schedule', () => {
  // "Trash goes out Mon/Wed/Fri but whose job it is flips weekly."
  it('holds one person for a whole week when the cadence is weekly', () => {
    const schedule: Schedule = {
      rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 3, 5] },
      startsOn: ANCHOR,
      endsOn: null,
      timesOfDay: [],
    };
    const occurrences = expandOccurrences('chore', schedule, CAL, {
      start: ANCHOR,
      end: addDays(ANCHOR, 13),
    });
    const assignment = rotateWith(['alice', 'bob'], { unit: 'week', every: 1 });
    const assignees = occurrences.map((occ) => {
      const r = assigneeFor(occ, assignment, CAL, ANCHOR);
      return r.kind === 'member' ? r.memberId : null;
    });
    expect(assignees).toEqual(['alice', 'alice', 'alice', 'bob', 'bob', 'bob']);
  });

  it('alternates every trash day when the cadence is per-occurrence', () => {
    const schedule: Schedule = {
      rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 3, 5] },
      startsOn: ANCHOR,
      endsOn: null,
      timesOfDay: [],
    };
    const occurrences = expandOccurrences('chore', schedule, CAL, {
      start: ANCHOR,
      end: addDays(ANCHOR, 13),
    });
    const assignment = rotateWith(['alice', 'bob'], { unit: 'occurrence', every: 1 });
    const assignees = occurrences.map((occ) => {
      const r = assigneeFor(occ, assignment, CAL, ANCHOR);
      return r.kind === 'member' ? r.memberId : null;
    });
    expect(assignees).toEqual(['alice', 'bob', 'alice', 'bob', 'alice', 'bob']);
  });

  it('holds one person for a whole month when the cadence is monthly', () => {
    const schedule: Schedule = {
      rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1] },
      startsOn: civilDate('2026-01-04'),
      endsOn: null,
      timesOfDay: [],
    };
    const occurrences = expandOccurrences('chore', schedule, CAL, {
      start: civilDate('2026-01-04'),
      end: civilDate('2026-03-01'),
    });
    const assignment = rotateWith(['alice', 'bob'], { unit: 'month', every: 1 });
    const byMonth = new Map<string, Set<string>>();
    for (const occ of occurrences) {
      const r = assigneeFor(occ, assignment, CAL, civilDate('2026-01-04'));
      if (r.kind !== 'member') continue;
      const month = occ.dueOn.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? new Set()).add(r.memberId));
    }
    // Exactly one person owns each month.
    for (const members of byMonth.values()) expect(members.size).toBe(1);
    expect(byMonth.size).toBeGreaterThan(1);
  });
});
