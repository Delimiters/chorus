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

import type { CivilDate, CivilTime } from '../civil/types';
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
  /**
   * Null when the person who did it has since deleted their account.
   *
   * The completion survives them deliberately — it is the household's history
   * as much as theirs — so every consumer has to cope with an author who is
   * gone. The database keeps a display-name snapshot for showing it.
   */
  readonly completedBy: string | null;
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
  /**
   * The chore's reminder times, if it has any.
   *
   * Carried alongside the title for the same reason: they belong to the chore,
   * not the occurrence, and every consumer that has an occurrence would
   * otherwise need the chore too. Empty means "use the device default".
   */
  readonly timesOfDay: readonly CivilTime[];
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
/** Somebody took one occurrence that the rotation gave to the other person. */
export interface TurnOverrideInput {
  readonly occurrenceKey: string;
  /** Whose it is instead. */
  readonly userId: string;
}

export interface ProjectionInput {
  readonly chores: readonly ChoreInput[];
  readonly completions: readonly CompletionInput[];
  readonly exceptions: readonly ExceptionInput[];
  /** Current household roster, used to fan out `everyone` chores. */
  readonly memberIds: readonly string[];
  /**
   * Per-occurrence turn overrides — "actually, this one's mine".
   *
   * A deviation from the rotation, never an edit to it: the rotation stays a
   * pure function of the date (invariant 4), and this is applied on top. Take
   * the override away and the rotation answers again.
   *
   * Optional because every existing caller predates it and an absent list must
   * mean "no overrides" rather than a type error at forty call sites.
   */
  readonly turns?: readonly TurnOverrideInput[];
  /** Household-local today. The engine never reads a clock. */
  readonly today: CivilDate;
}
