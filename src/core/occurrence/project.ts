/**
 * The projector: rules + completions + exceptions + rotation → what a screen renders.
 *
 * This is the composition point of the whole engine, and the only place the
 * four concerns meet. It is pure, so every screen that consumes it can be
 * tested by handing it fixtures — no network, no database, no clock.
 *
 * @see docs/ARCHITECTURE.md
 */

import { addDays, compareCivil, daysBetween, isWithin } from '../civil/date';
import type { CalendarConfig, CivilDate, DateWindow } from '../civil/types';
import { MAX_WINDOW_DAYS, expandOccurrences } from '../recurrence/expand';
import { occurrenceKeyOf } from '../recurrence/period';
import type { Occurrence } from '../recurrence/types';
import { assigneeFor } from '../rotation/assign';
import type {
  CompletionInput,
  ExceptionInput,
  ProjectedOccurrence,
  ProjectionInput,
  OccurrenceStatus,
} from './types';

/**
 * How far outside the requested window to expand, so that an occurrence
 * *rescheduled into* the window still appears.
 *
 * A reschedule that moves an occurrence more than this far will not show up in
 * the destination window. 31 days covers "push it to next month", which is the
 * realistic ceiling for a household chore. Documented rather than unbounded,
 * because an unbounded search would mean expanding every chore's entire history.
 */
export const RESCHEDULE_PAD_DAYS = 31;

export class ProjectionWindowTooWideError extends Error {
  constructor(days: number) {
    super(
      `Projection window of ${days} days (including ${RESCHEDULE_PAD_DAYS} days of reschedule padding ` +
        `on each side) exceeds the maximum of ${MAX_WINDOW_DAYS}`,
    );
    this.name = 'ProjectionWindowTooWideError';
  }
}

/**
 * Projects every chore over a window.
 *
 * Skipped occurrences are **included**, with `status: 'skipped'`, rather than
 * filtered out — the caller decides whether to show them, and keeping them
 * makes "show skipped" a display toggle rather than a re-query.
 */
export function projectOccurrences(
  input: ProjectionInput,
  cal: CalendarConfig,
  window: DateWindow,
): readonly ProjectedOccurrence[] {
  const paddedSpan = daysBetween(window.start, window.end) + 1 + RESCHEDULE_PAD_DAYS * 2;
  if (paddedSpan > MAX_WINDOW_DAYS) throw new ProjectionWindowTooWideError(paddedSpan);

  const padded: DateWindow = {
    start: addDays(window.start, -RESCHEDULE_PAD_DAYS),
    end: addDays(window.end, RESCHEDULE_PAD_DAYS),
  };

  const completions = indexBy(input.completions, (c) => c.occurrenceKey);
  const exceptions = indexBy(input.exceptions, (e) => e.occurrenceKey);

  const out: ProjectedOccurrence[] = [];

  for (const chore of input.chores) {
    if (chore.archived) continue;

    // `everyone` chores produce one occurrence per member, each independently
    // completable; everything else produces a single unsubjected occurrence.
    const subjects: readonly (string | null)[] =
      chore.assignment.kind === 'everyone' ? input.memberIds : [null];

    for (const subject of subjects) {
      const raw = expandOccurrences(chore.id, chore.schedule, cal, padded, subject);

      for (const occ of raw) {
        const exception = exceptions.get(occ.occurrenceKey);

        // A reschedule moves the occurrence but keeps its identity — same key,
        // same index, therefore same rotation turn and same completion record.
        const effective: Occurrence =
          exception?.kind === 'reschedule' && exception.movedTo !== null
            ? { ...occ, dueOn: exception.movedTo }
            : occ;

        // Window membership is decided by the *effective* date, so something
        // moved out drops away and something moved in appears.
        if (!isWithin(effective.dueOn, window.start, window.end)) continue;

        const completion = completions.get(occ.occurrenceKey);
        const status = statusOf(effective.dueOn, input.today, completion, exception);

        out.push({
          ...effective,
          choreTitle: chore.title,
          status,
          assignee: assigneeFor(effective, chore.assignment, cal, chore.schedule.startsOn),
          completedOn: completion?.completedOn ?? null,
          completedBy: completion?.completedBy ?? null,
          daysLate: completion
            ? Math.max(0, daysBetween(effective.dueOn, completion.completedOn))
            : 0,
          rescheduled: exception?.kind === 'reschedule',
          originalDueOn: exception?.kind === 'reschedule' ? occ.dueOn : null,
        });
      }
    }
  }

  return sortForDisplay(out);
}

/**
 * Derived status. Nothing here is stored, which is why there is no state
 * machine and no migration when the rules change.
 */
function statusOf(
  dueOn: CivilDate,
  today: CivilDate,
  completion: CompletionInput | undefined,
  exception: ExceptionInput | undefined,
): OccurrenceStatus {
  if (completion) return 'completed';
  if (exception?.kind === 'skip') return 'skipped';
  const delta = compareCivil(dueOn, today);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'due';
  return 'upcoming';
}

/** Due date, then chore title, then slot — stable and readable. */
function sortForDisplay(list: ProjectedOccurrence[]): ProjectedOccurrence[] {
  return list.sort(
    (a, b) =>
      compareCivil(a.dueOn, b.dueOn) ||
      a.choreTitle.localeCompare(b.choreTitle) ||
      a.slot - b.slot ||
      (a.subject ?? '').localeCompare(b.subject ?? ''),
  );
}

function indexBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item);
  return map;
}

// ── Convenience views ───────────────────────────────────────────────────────

/** Everything actionable today: due today, plus anything still overdue. */
export function todayView(
  projected: readonly ProjectedOccurrence[],
  today: CivilDate,
  options: { readonly includeCompleted?: boolean } = {},
): readonly ProjectedOccurrence[] {
  return projected.filter((occ) => {
    if (occ.status === 'skipped') return false;
    if (occ.status === 'completed') {
      return options.includeCompleted === true && occ.completedOn === today;
    }
    return occ.status === 'due' || occ.status === 'overdue';
  });
}

/** Occurrences belonging to one person, plus the unassigned ones anyone can do. */
export function forMember(
  projected: readonly ProjectedOccurrence[],
  memberId: string,
): readonly ProjectedOccurrence[] {
  return projected.filter(
    (occ) =>
      occ.assignee.kind === 'anyone' ||
      (occ.assignee.kind === 'member' && occ.assignee.memberId === memberId),
  );
}

/** Groups occurrences by due date, for an agenda list. */
export function groupByDate(
  projected: readonly ProjectedOccurrence[],
): ReadonlyMap<CivilDate, readonly ProjectedOccurrence[]> {
  const map = new Map<CivilDate, ProjectedOccurrence[]>();
  for (const occ of projected) {
    const bucket = map.get(occ.dueOn);
    if (bucket) bucket.push(occ);
    else map.set(occ.dueOn, [occ]);
  }
  return map;
}

/**
 * Rebuilds the occurrence key for a fanned-out subject.
 *
 * Exposed because the data layer needs it when writing a completion for one
 * member of an `everyone` chore.
 */
export function keyForSubject(occ: Occurrence, subject: string | null): string {
  return occurrenceKeyOf(occ.choreId, occ.periodKey, occ.slot, subject);
}
