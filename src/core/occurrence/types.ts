/**
 * The view model every screen consumes.
 *
 * A `ProjectedOccurrence` is what you get when a chore's rule is expanded over
 * a window and then reconciled with the two things that actually get stored:
 * completions and exceptions.
 *
 * Note what is *derived* rather than stored: status, lateness, and assignee.
 * The previous implementation stored all three, which is why they drifted.
 */

import type { CivilDate } from '../civil/types';
import type { Occurrence, Schedule } from '../recurrence/types';
import type { Assignment, AssigneeResolution } from '../rotation/types';

/** A chore as the engine needs to see it. The database row carries more. */
export interface ChoreInput {
  readonly id: string;
  readonly title: string;
  readonly schedule: Schedule;
  readonly assignment: Assignment;
  /** Soft-deleted chores produce no occurrences. */
  readonly archived: boolean;
}

/** A stored completion, keyed by occurrence. */
export interface CompletionInput {
  readonly choreId: string;
  readonly occurrenceKey: string;
  /** Household-local civil date on which it was completed. */
  readonly completedOn: CivilDate;
  readonly completedBy: string;
}

/** A stored deviation from the schedule. */
export interface ExceptionInput {
  readonly choreId: string;
  readonly occurrenceKey: string;
  readonly kind: 'skip' | 'reschedule';
  /** Required when `kind` is `'reschedule'`; the date it moved to. */
  readonly movedTo: CivilDate | null;
}

/**
 * Derived status.
 *
 * `overdue` is `dueOn < today && !completed && !skipped` — computed at render,
 * never written. There is no state machine and nothing to migrate.
 */
export type OccurrenceStatus = 'due' | 'upcoming' | 'overdue' | 'completed' | 'skipped';

export interface ProjectedOccurrence extends Occurrence {
  readonly choreTitle: string;
  readonly status: OccurrenceStatus;
  readonly assignee: AssigneeResolution;
  /** Set when the occurrence has been completed. */
  readonly completedOn: CivilDate | null;
  readonly completedBy: string | null;
  /** Days late, relative to `dueOn`. Zero when on time or not yet completed. */
  readonly daysLate: number;
  /** True when an exception moved this occurrence off its original date. */
  readonly rescheduled: boolean;
  /** The date the rule originally produced, when `rescheduled`. */
  readonly originalDueOn: CivilDate | null;
  /**
   * True when a reschedule moved this occurrence out of the requested window.
   *
   * Present only so supersession can see that a newer occurrence exists. Never
   * display one: its date is outside what the caller asked for.
   */
  readonly displaced: boolean;
}

/** Everything the projector needs. All of it is plain data. */
export interface ProjectionInput {
  readonly chores: readonly ChoreInput[];
  readonly completions: readonly CompletionInput[];
  readonly exceptions: readonly ExceptionInput[];
  /** Current household roster, used to fan out `everyone` chores. */
  readonly memberIds: readonly string[];
  /** Household-local today. The engine never reads a clock. */
  readonly today: CivilDate;
}
