/**
 * What actually happened, over a window.
 *
 * The interesting number here is **expected versus actual**, and it is
 * answerable only because occurrences are computed rather than stored: replay
 * the expander over any past window and compare it against the completions
 * that were recorded. In a materialised design that number would silently
 * depend on whether a backfill job had run.
 *
 * Everything below is a fold over projected occurrences. No clock, no `Date`,
 * no database — `today` arrives as a parameter like everywhere else in the
 * engine, so a stats screen is testable by handing it fixtures.
 *
 * Deliberately descriptive rather than competitive. This is a household, not a
 * leaderboard: the per-person figures exist so two people can see the shape of
 * who does what, and there is no score, no streak-shaming and no ranking.
 */

import { compareCivil, daysBetween } from '../civil/date';
import type { CivilDate } from '../civil/types';
import type { ProjectedOccurrence } from '../occurrence/types';

export interface PersonTotals {
  /** Null for somebody who has since deleted their account. */
  readonly memberId: string | null;
  readonly completed: number;
  /** Of those completed, how many were done on or before the day they were due. */
  readonly onTime: number;
}

export interface ChoreTotals {
  readonly choreId: string;
  readonly choreTitle: string;
  readonly expected: number;
  readonly completed: number;
  readonly skipped: number;
  /** Still outstanding and past their date, at `today`. */
  readonly missed: number;
}

export interface Summary {
  /**
   * How many occurrences the schedule produced in the window.
   *
   * Completed, skipped and missed all count toward it: the question is "how
   * much did this household take on", not "how much is left".
   */
  readonly expected: number;
  readonly completed: number;
  readonly skipped: number;
  readonly missed: number;
  /** Completed on or before the due date. Never exceeds `completed`. */
  readonly onTime: number;
  /**
   * Average days late across completed occurrences that *were* late.
   *
   * Excludes the on-time ones on purpose. Averaging zeros in makes a household
   * that is punctual about most things and a week late on one look identical
   * to one that is two days late on everything, and the second is the one
   * worth noticing.
   */
  readonly averageDaysLate: number;
  readonly byPerson: readonly PersonTotals[];
  readonly byChore: readonly ChoreTotals[];
}

/** Only occurrences due within the window, ignoring ones displaced out of it. */
function inWindow(occ: ProjectedOccurrence, from: CivilDate, to: CivilDate): boolean {
  if (occ.displaced) return false;
  return compareCivil(occ.dueOn, from) >= 0 && compareCivil(occ.dueOn, to) <= 0;
}

export function summarise(input: {
  readonly occurrences: readonly ProjectedOccurrence[];
  readonly from: CivilDate;
  readonly to: CivilDate;
  /**
   * Where "missed" stops being "not yet".
   *
   * An occurrence due tomorrow is neither missed nor late, and a window that
   * runs into the future would otherwise count it as a failure the moment it
   * was created.
   */
  readonly today: CivilDate;
}): Summary {
  const { from, to, today } = input;
  const occurrences = input.occurrences.filter((o) => inWindow(o, from, to));

  let completed = 0;
  let skipped = 0;
  let missed = 0;
  let onTime = 0;
  let lateTotal = 0;
  let lateCount = 0;

  const people = new Map<string | null, { completed: number; onTime: number }>();
  const chores = new Map<
    string,
    { choreTitle: string; expected: number; completed: number; skipped: number; missed: number }
  >();

  for (const occ of occurrences) {
    const chore = chores.get(occ.choreId) ?? {
      choreTitle: occ.choreTitle,
      expected: 0,
      completed: 0,
      skipped: 0,
      missed: 0,
    };
    chore.expected += 1;

    if (occ.status === 'completed') {
      completed += 1;
      chore.completed += 1;

      // `daysLate` is relative to the occurrence's own due date, so a
      // rescheduled chore is judged against where it was moved to.
      if (occ.daysLate <= 0) {
        onTime += 1;
      } else {
        lateTotal += occ.daysLate;
        lateCount += 1;
      }

      const person = people.get(occ.completedBy) ?? { completed: 0, onTime: 0 };
      person.completed += 1;
      if (occ.daysLate <= 0) person.onTime += 1;
      people.set(occ.completedBy, person);
    } else if (occ.status === 'skipped') {
      skipped += 1;
      chore.skipped += 1;
    } else if (compareCivil(occ.dueOn, today) < 0) {
      // Outstanding and past. Anything due today or later is simply not done
      // yet, which is not the same thing.
      missed += 1;
      chore.missed += 1;
    }

    chores.set(occ.choreId, chore);
  }

  return {
    expected: occurrences.length,
    completed,
    skipped,
    missed,
    onTime,
    averageDaysLate: lateCount === 0 ? 0 : lateTotal / lateCount,
    byPerson: [...people.entries()]
      .map(([memberId, totals]) => ({ memberId, ...totals }))
      // Most first, then by id so the order is total and does not depend on
      // the order occurrences happened to arrive in.
      .sort(
        (a, b) => b.completed - a.completed || (a.memberId ?? '').localeCompare(b.memberId ?? ''),
      ),
    byChore: [...chores.entries()]
      .map(([choreId, totals]) => ({ choreId, ...totals }))
      .sort((a, b) => b.expected - a.expected || a.choreTitle.localeCompare(b.choreTitle)),
  };
}

/**
 * The longest run of consecutive days on which something was completed.
 *
 * Days, not occurrences: doing four chores on Tuesday is one day of the
 * streak, not four. Counted back from `today` only if today or yesterday has a
 * completion — otherwise a streak that ended in March would still be reported
 * as "the streak", which is flattering and wrong.
 */
export function currentStreak(
  occurrences: readonly ProjectedOccurrence[],
  today: CivilDate,
): number {
  const days = new Set(
    occurrences
      .filter((o) => o.status === 'completed' && o.completedOn !== null)
      .map((o) => o.completedOn as CivilDate),
  );
  if (days.size === 0) return 0;

  // Allow one day of grace: at 9am on Tuesday a household that did everything
  // on Monday has not broken anything yet.
  const startsToday = days.has(today);
  const sorted = [...days].sort(compareCivil);
  const mostRecent = sorted[sorted.length - 1] as CivilDate;
  if (!startsToday && daysBetween(mostRecent, today) > 1) return 0;

  let streak = 1;
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    const day = sorted[i] as CivilDate;
    const previous = sorted[i - 1] as CivilDate;
    if (daysBetween(previous, day) === 1) streak += 1;
    else break;
  }
  return streak;
}
