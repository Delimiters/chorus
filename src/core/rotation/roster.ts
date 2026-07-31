/**
 * Changing who is in a rotation, without rewriting who was in it.
 *
 * The rule this file exists to enforce: **segments are append-only.** A
 * housemate joining or leaving appends a new one from a future date; editing
 * the existing one would retroactively change who was responsible for last
 * month's chores, which corrupts the history the stats view is built from and
 * makes "whose turn was it?" unanswerable about the past.
 *
 * That was reachable in three taps before this existed. The picker rebuilt
 * `segments[0]` from current membership whenever the mode was set, so the only
 * in-app way to add somebody to an existing rotation was to overwrite the past.
 *
 * @see docs/ROTATION.md
 */

import { addDays, compareCivil } from '../civil/date';
import type { CivilDate } from '../civil/types';
import { nextSegmentOffset, rosterOn } from './assign';
import type { Assignment, RotationSegment } from './types';

export interface RosterChange {
  readonly assignment: Assignment;
  /** Who should be in the rotation from now on, in turn order. */
  readonly roster: readonly string[];
  /**
   * First date the new roster applies to.
   *
   * Defaults to tomorrow at the call site rather than today: today's occurrence
   * may already be on somebody's screen, and moving it out from under them
   * mid-day is worse than starting the change tomorrow.
   */
  readonly effectiveFrom: CivilDate;
  /** Who most recently had a turn, so the next one lands fairly. */
  readonly lastAssigneeId: string | null;
  /** The turn number the first occurrence under the new segment will have. */
  readonly nextTurn: number;
}

/**
 * Appends a segment, or replaces one that has not taken effect yet.
 *
 * The second case matters more than it looks: changing your mind twice before
 * the change lands should not leave two segments arguing about the same future.
 * A segment whose `effectiveFrom` is still ahead of the new one is not history
 * — nothing has ever been assigned under it — so replacing it loses nothing.
 */
export function withRoster(change: RosterChange): Assignment {
  const { assignment, roster, effectiveFrom, lastAssigneeId, nextTurn } = change;

  if (assignment.kind !== 'rotate') {
    // Turning a non-rotating chore into a rotating one: there is no history to
    // preserve, so one segment from the given date is the whole story.
    return {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom, memberIds: [...roster], offset: 0 }],
    };
  }

  const previous = rosterOn(assignment, effectiveFrom);
  const offset = nextSegmentOffset(previous, lastAssigneeId, roster, nextTurn);
  const appended: RotationSegment = { effectiveFrom, memberIds: [...roster], offset };

  // Everything that has already taken effect stays exactly as it is.
  const settled = assignment.segments.filter(
    (s) => compareCivil(s.effectiveFrom, effectiveFrom) < 0,
  );

  return { ...assignment, segments: [...settled, appended] };
}

/** The date a roster change should take effect: tomorrow, for the reason above. */
export function rosterChangeDate(today: CivilDate): CivilDate {
  return addDays(today, 1);
}

/**
 * Whether a rotation still names people who are no longer in the household.
 *
 * Worth surfacing rather than silently repairing: a rotation containing
 * somebody who left keeps handing them turns, and nothing on the agenda
 * explains why a chore is assigned to nobody who lives here.
 */
export function rosterIsStale(
  assignment: Assignment,
  members: readonly string[],
  on: CivilDate,
): boolean {
  if (assignment.kind !== 'rotate') return false;
  const current = rosterOn(assignment, on);
  if (current.length === 0) return true;
  const known = new Set(members);
  if (current.some((id) => !known.has(id))) return true;
  // Somebody joined and was never added.
  return members.some((id) => !current.includes(id));
}
