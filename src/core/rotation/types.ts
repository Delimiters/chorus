/**
 * Assignment and rotation.
 *
 * The governing constraint: **whose turn it is must be a pure function of the
 * date**, never a stored pointer. The previous implementation advanced a
 * mutable `currentAssigneeIndex` only when someone completed a chore, so an
 * unfinished rotation never moved — the one situation where a rotation most
 * needs to. See docs/POSTMORTEM-SWIFT.md #2.
 *
 * @see docs/ROTATION.md
 */

import type { CivilDate } from '../civil/types';

/**
 * How often the rotation advances.
 *
 * Deliberately independent of the chore's own recurrence. "Trash goes out
 * Mon/Wed/Fri but we swap whose job it is weekly" is a weekly rule with an
 * `occurrence`-cadence of... no: it is a weekly rule with a `week` cadence.
 * With `{ unit: 'occurrence', every: 1 }` the two of you would alternate every
 * single trash day instead. Both are one-line configurations of one function.
 */
export type RotationCadence =
  /** Advance every N occurrences. */
  | { readonly unit: 'occurrence'; readonly every: number }
  /** Advance every N weeks, however many occurrences fall in them. */
  | { readonly unit: 'week'; readonly every: number }
  /** Advance every N months. */
  | { readonly unit: 'month'; readonly every: number };

/**
 * A rotation epoch: who was in the rotation, starting when.
 *
 * Append-only, and never mutated. The roster is stored on the chore rather than
 * read from current household membership, because reading current membership
 * would retroactively rewrite who was responsible for last month's chores —
 * corrupting history the moment somebody joins or leaves.
 */
export interface RotationSegment {
  /** First date this roster applies to. Segments are sorted by this. */
  readonly effectiveFrom: CivilDate;
  /** Ordered roster. Must be non-empty. */
  readonly memberIds: readonly string[];
  /**
   * Rotates who lands on which turn.
   *
   * Chosen by {@link nextSegmentOffset} when a segment is appended, so the next
   * occurrence falls to whoever fairness says is next rather than resetting to
   * the top of the list.
   */
  readonly offset: number;
}

export type Assignment =
  /** Either housemate may complete it; one completion satisfies the occurrence. */
  | { readonly kind: 'anyone' }
  /** Always the same person. */
  | { readonly kind: 'fixed'; readonly memberId: string }
  /**
   * Everyone does their own — one occurrence per member, each independently
   * completable. "We each do our own laundry."
   */
  | { readonly kind: 'everyone' }
  /** Take turns. */
  | {
      readonly kind: 'rotate';
      readonly cadence: RotationCadence;
      readonly segments: readonly RotationSegment[];
    };

export type AssignmentKind = Assignment['kind'];

/** The resolved answer to "who is responsible for this occurrence?" */
export type AssigneeResolution =
  /** Anybody in the household. */
  | { readonly kind: 'anyone' }
  /** This specific person. `turn` is the 0-based rotation turn, for display. */
  | { readonly kind: 'member'; readonly memberId: string; readonly turn: number }
  /**
   * Nobody can be assigned. Happens when a rotation has no segment covering
   * this date — e.g. an occurrence predating the chore's first roster.
   */
  | { readonly kind: 'unassignable'; readonly reason: 'no-applicable-segment' | 'empty-roster' };

/** True if this assignment produces one occurrence per member. */
export function isFanOut(assignment: Assignment): boolean {
  return assignment.kind === 'everyone';
}
