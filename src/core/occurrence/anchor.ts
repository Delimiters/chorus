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
 * The earliest completed occurrence due strictly after `after`.
 *
 * Earliest rather than latest, and taken one at a time, because the series has
 * to be walked *forward*: each completion moves the dates that follow it, so
 * the occurrence a later completion belongs to does not exist until the earlier
 * one has been applied.
 *
 * By `dueOn` rather than by `completedOn`: doing next week's early does not
 * make it the one the clock restarts from — the sequence is what has a
 * position, not the calendar.
 */
function nextCompleted(
  series: readonly Occurrence[],
  completionFor: (key: string) => CompletedAt | undefined,
  after: CivilDate | null,
): { dueOn: CivilDate; completedOn: CivilDate; index: number } | null {
  let best: { dueOn: CivilDate; completedOn: CivilDate; index: number } | null = null;
  for (const occ of series) {
    if (after !== null && compareCivil(occ.dueOn, after) <= 0) continue;
    const completion = completionFor(occ.occurrenceKey);
    if (completion === undefined) continue;
    if (best === null || compareCivil(occ.dueOn, best.dueOn) < 0) {
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
  hasException: (key: string) => boolean,
): readonly Occurrence[] {
  if (schedule.rule.kind !== 'daily') return raw;

  const everyNDays = schedule.rule.everyNDays;

  /*
   * Walked forward, one completion at a time, rather than re-anchored once.
   *
   * The first version found the *latest* completion in `raw` and re-expanded
   * from it — and `raw` is the fixed grid, so after one re-anchor the series'
   * real dates no longer appeared in it and no later completion was ever
   * found. Every chore re-anchored exactly once in its life and then reverted
   * to the fixed grid, which is the "no amount of doing it ever catches up"
   * condition this module exists to remove. Verified: a second late completion
   * moved nothing at all.
   *
   * Each pass therefore applies the earliest completion not yet accounted for
   * and rebuilds the tail, so the next pass can see the occurrence that only
   * exists because of this one.
   */
  let series = raw;
  let after: CivilDate | null = null;

  // Bounded by the number of occurrences: each pass consumes one completion,
  // and every completion belongs to an occurrence in the window.
  for (let guard = 0; guard <= raw.length; guard += 1) {
    const current = nextCompleted(series, completionFor, after);
    if (current === null) return series;

    /*
     * The next one is due N days after it was *done*, not after it was due.
     *
     * Never earlier than the day after the completed occurrence, so finishing
     * something early cannot produce two occurrences on overlapping dates or a
     * key that collides with the one just ticked.
     */
    const restart = addDays(current.completedOn, everyNDays);
    const earliest = addDays(current.dueOn, 1);
    const nextDue = compareCivil(restart, earliest) > 0 ? restart : earliest;

    /*
     * History keeps everything up to the completion, *including* occurrences
     * the caller has an exception for.
     *
     * Filtering purely on date silently dropped a skipped or rescheduled
     * occurrence that fell in the gap — a row somebody had explicitly moved
     * vanishing from the agenda with no trace, which is the disappearing-row
     * complaint again.
     */
    const history = series.filter(
      (occ) =>
        compareCivil(occ.dueOn, current.dueOn) <= 0 ||
        (compareCivil(occ.dueOn, nextDue) < 0 && hasException(occ.occurrenceKey)),
    );

    /*
     * Indices continue the sequence rather than restarting at zero.
     *
     * `occurrenceIndex` is what date-independent rotation counts turns with, so
     * a grid that restarted from zero would hand the chore back to whoever had
     * the first turn every time anybody completed anything.
     */
    const future = expandFrom(nextDue)
      .filter((occ) => compareCivil(occ.dueOn, nextDue) >= 0)
      .map((occ, i) => ({ ...occ, occurrenceIndex: current.index + 1 + i }));

    series = [...history, ...future];
    after = current.dueOn;
  }

  return series;
}
