/**
 * Resolving whose turn it is.
 *
 * `assigneeFor` takes no completions, no exceptions, no clock, and no mutable
 * state. It is a total function of `(occurrence, assignment, calendar, anchor)`.
 *
 * That is the whole design. Because the turn derives from the date, a week
 * nobody completed still advances the rotation; because nothing is stored, a
 * roster change cannot rewrite the past.
 *
 * @see docs/ROTATION.md
 */

import { compareCivil, monthsBetween, weeksBetween } from '../civil/date';
import type { CalendarConfig, CivilDate } from '../civil/types';
import { assertNever } from '../lib/assertNever';
import type { Occurrence } from '../recurrence/types';
import type { Assignment, AssigneeResolution, RotationCadence, RotationSegment } from './types';

/**
 * Which segment governs a given date: the last one that has taken effect.
 *
 * Returns null for dates preceding every segment, which is why
 * `AssigneeResolution` has an `unassignable` case rather than silently
 * defaulting to the first roster.
 */
export function segmentFor(
  segments: readonly RotationSegment[],
  dueOn: CivilDate,
): RotationSegment | null {
  let found: RotationSegment | null = null;
  for (const segment of segments) {
    if (compareCivil(segment.effectiveFrom, dueOn) <= 0) {
      if (found === null || compareCivil(segment.effectiveFrom, found.effectiveFrom) >= 0) {
        found = segment;
      }
    }
  }
  return found;
}

/**
 * The 0-based rotation turn for an occurrence.
 *
 * All three cadences measure from the schedule's own anchor, not from the
 * segment, so that appending a segment never renumbers turns. A segment shifts
 * *who* holds a turn (via its `offset`), never *which* turn a date is.
 */
export function turnFor(
  occ: Occurrence,
  cadence: RotationCadence,
  cal: CalendarConfig,
  anchor: CivilDate,
): number {
  switch (cadence.unit) {
    case 'occurrence':
      return Math.floor(occ.occurrenceIndex / cadence.every);
    case 'week':
      return Math.floor(weeksBetween(anchor, occ.dueOn, cal.weekStartsOn) / cadence.every);
    case 'month':
      return Math.floor(monthsBetween(anchor, occ.dueOn) / cadence.every);
    default:
      return assertNever(cadence, 'rotation cadence');
  }
}

/**
 * Who is responsible for this occurrence.
 *
 * @param anchor the schedule's `startsOn` — the origin for date-based cadences
 */
export function assigneeFor(
  occ: Occurrence,
  assignment: Assignment,
  cal: CalendarConfig,
  anchor: CivilDate,
): AssigneeResolution {
  switch (assignment.kind) {
    case 'anyone':
      return { kind: 'anyone' };

    case 'fixed':
      return { kind: 'member', memberId: assignment.memberId, turn: 0 };

    case 'everyone':
      // Fan-out tags each occurrence with its subject during expansion, so the
      // assignee is simply that subject.
      return occ.subject === null
        ? { kind: 'unassignable', reason: 'empty-roster' }
        : { kind: 'member', memberId: occ.subject, turn: 0 };

    case 'rotate': {
      const segment = segmentFor(assignment.segments, occ.dueOn);
      if (segment === null) return { kind: 'unassignable', reason: 'no-applicable-segment' };
      if (segment.memberIds.length === 0) {
        return { kind: 'unassignable', reason: 'empty-roster' };
      }

      const turn = turnFor(occ, assignment.cadence, cal, anchor);
      const size = segment.memberIds.length;
      // Non-negative modulo: turns before the anchor are legitimate when a
      // window reaches back past `startsOn`.
      const position = (((turn + segment.offset) % size) + size) % size;
      return { kind: 'member', memberId: segment.memberIds[position] as string, turn };
    }

    default:
      return assertNever(assignment, 'assignment');
  }
}

/**
 * The roster in effect on a date, for UI that needs to show the rotation order.
 */
export function rosterOn(assignment: Assignment, dueOn: CivilDate): readonly string[] {
  if (assignment.kind !== 'rotate') return [];
  return segmentFor(assignment.segments, dueOn)?.memberIds ?? [];
}

/**
 * The offset for a new segment, so the rotation continues fairly across a
 * roster change instead of restarting at the top of the list.
 *
 * Given who most recently held a turn, this picks the offset that puts the
 * *next* person in the new roster on the next turn. If that person has left,
 * it falls back to the front of the new roster.
 *
 * @param nextTurn the turn number the first occurrence of the new segment will have
 */
export function nextSegmentOffset(
  previousRoster: readonly string[],
  lastAssigneeId: string | null,
  newRoster: readonly string[],
  nextTurn: number,
): number {
  if (newRoster.length === 0) return 0;

  // Who "should" go next: the person after the last assignee in the old roster,
  // if they're still around.
  let preferred: string | null = null;
  if (lastAssigneeId !== null && previousRoster.length > 0) {
    const lastIndex = previousRoster.indexOf(lastAssigneeId);
    if (lastIndex >= 0) {
      for (let step = 1; step <= previousRoster.length; step += 1) {
        const candidate = previousRoster[(lastIndex + step) % previousRoster.length] as string;
        if (newRoster.includes(candidate)) {
          preferred = candidate;
          break;
        }
      }
    }
  }

  const target = preferred === null ? 0 : newRoster.indexOf(preferred);
  const size = newRoster.length;
  // Solve (nextTurn + offset) % size === target for the smallest offset >= 0.
  return (((target - nextTurn) % size) + size) % size;
}

/**
 * Expands one occurrence into one per member for `everyone` assignments.
 *
 * Each copy gets its own `subject`, and therefore its own occurrence key — so
 * the two of you can tick your own laundry off independently.
 *
 * Non-fan-out assignments pass through unchanged.
 */
export function fanOut(
  occ: Occurrence,
  assignment: Assignment,
  memberIds: readonly string[],
  keyFor: (occ: Occurrence, subject: string) => string,
): readonly Occurrence[] {
  if (assignment.kind !== 'everyone') return [occ];
  return memberIds.map((memberId) => ({
    ...occ,
    subject: memberId,
    occurrenceKey: keyFor(occ, memberId),
  }));
}
