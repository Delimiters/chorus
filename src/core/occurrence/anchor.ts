/**
 * "Every N days" means N days after you last did it.
 *
 * The recurrence engine expands from a fixed anchor: a chore every 6 days from
 * `startsOn` falls on days 6, 12, 18 forever, whatever actually happened. Do it
 * three days late and the next one is due three days later — so a chore you are
 * slightly behind on stays permanently, quietly overdue, and no amount of doing
 * it ever catches up. Jake, exactly: *"if it's every 6 days, and I complete it 3
 * days late, the next occurrence shouldn't happen until 6 days after I completed
 * it."*
 *
 * ── Only interval rules, and that distinction is the whole design ─────────
 *
 * `every N days` means "this often", and an interval only makes sense measured
 * from the last time. `every Tuesday` and `the 15th` mean "on this day" — they
 * are facts about the calendar, and re-anchoring them to a completion would
 * walk bin day around the week forever. So this touches `daily` rules and
 * nothing else.
 *
 * Which is also why the two changes arrived together: converting the floating
 * chores to intervals is what made completion-anchoring the right default for
 * them.
 *
 * ── Why it is a re-expansion rather than a moved `startsOn` ───────────────
 *
 * Completions are matched by `occurrenceKey`, which is derived from the due
 * date. Moving the anchor changes every key, so the completion that caused the
 * move would be orphaned: the row you just ticked would vanish from Done and
 * reappear as due. The grid therefore stays put up to and including the last
 * completed occurrence — history keeps its keys — and a fresh grid runs from
 * the completion onward. The gap between the two is the restarted clock.
 */

import { addDays, compareCivil } from '../civil/date';
import type { CivilDate } from '../civil/types';
import type { Occurrence, Schedule } from '../recurrence/types';

/** What the projector knows about a completion, as this needs it. */
export interface CompletedAt {
  readonly completedOn: CivilDate;
}

/**
 * The last completed occurrence in a series, by due date.
 *
 * By `dueOn` rather than by `completedOn`: doing next week's early does not make
 * it the one the clock restarts from — the sequence is what has a position, not
 * the calendar.
 */
function lastCompleted(
  raw: readonly Occurrence[],
  completionFor: (key: string) => CompletedAt | undefined,
): { dueOn: CivilDate; completedOn: CivilDate; index: number } | null {
  let best: { dueOn: CivilDate; completedOn: CivilDate; index: number } | null = null;
  for (const occ of raw) {
    const completion = completionFor(occ.occurrenceKey);
    if (completion === undefined) continue;
    if (best === null || compareCivil(occ.dueOn, best.dueOn) > 0) {
      best = {
        dueOn: occ.dueOn,
        completedOn: completion.completedOn,
        index: occ.occurrenceIndex,
      };
    }
  }
  return best;
}

/**
 * Re-anchor an interval chore's future to its last completion.
 *
 * `expandFrom` re-expands the same schedule from a given anchor date; the
 * caller supplies it so this module stays free of the expander and of any
 * knowledge of calendars.
 *
 * Returns `raw` untouched for every rule that is not an interval, and for an
 * interval nobody has completed yet.
 */
export function anchorToCompletion(
  schedule: Schedule,
  raw: readonly Occurrence[],
  completionFor: (key: string) => CompletedAt | undefined,
  expandFrom: (anchor: CivilDate) => readonly Occurrence[],
): readonly Occurrence[] {
  if (schedule.rule.kind !== 'daily') return raw;

  const everyNDays = schedule.rule.everyNDays;
  const last = lastCompleted(raw, completionFor);
  if (last === null) return raw;

  /*
   * The next one is due N days after it was *done*, not after it was due.
   *
   * Never earlier than the day after the completed occurrence, so finishing
   * something early cannot produce two occurrences on overlapping dates or a
   * key that collides with the one just ticked.
   */
  const restart = addDays(last.completedOn, everyNDays);
  const earliest = addDays(last.dueOn, 1);
  const nextDue = compareCivil(restart, earliest) > 0 ? restart : earliest;

  const history = raw.filter((occ) => compareCivil(occ.dueOn, last.dueOn) <= 0);

  /*
   * Indices continue the sequence rather than restarting at zero.
   *
   * `occurrenceIndex` is what date-independent rotation counts turns with, so a
   * grid that restarted from zero would hand the chore back to whoever had the
   * first turn every time anybody completed anything.
   */
  const future = expandFrom(nextDue)
    .filter((occ) => compareCivil(occ.dueOn, nextDue) >= 0)
    .map((occ, i) => ({ ...occ, occurrenceIndex: last.index + 1 + i }));

  return [...history, ...future];
}
