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

import { addDays, compareCivil, daysBetween } from '../civil/date';
import type { CivilDate } from '../civil/types';
import { parseOccurrenceKey } from '../recurrence/period';
import type { Occurrence, Schedule } from '../recurrence/types';

/** What the projector knows about a completion, as this needs it. */
export interface CompletedAt {
  readonly occurrenceKey: string;
  readonly completedOn: CivilDate;
}

/**
 * The date an interval occurrence was due, read off its key.
 *
 * `v1:{choreId}:{periodKey}:{slot}:{subject}`, and for a `daily` rule the
 * period key *is* the due date — see `dayPeriodKey`. Parsed with the shared
 * `parseOccurrenceKey`, which splits from the right: reimplementing it as
 * `split(':')[2]` here reintroduced the assumption that parser exists to avoid,
 * and dropping the `subject` field on the way is what cross-wired `everyone`.
 *
 * Reading it from the key rather than from an expanded occurrence is what makes
 * the anchor independent of the window. Scanning the grid meant a completion
 * more than a few weeks old was invisible, and the projection quietly fell back
 * to the fixed grid — so Today, Upcoming, Stats and the reminder planner each
 * computed *different due dates for the same chore*, and therefore different
 * occurrence keys. A reminder could fire for an occurrence Today did not show.
 */
function dueOnFromKey(occurrenceKey: string): CivilDate | null {
  const periodKey = parseOccurrenceKey(occurrenceKey)?.periodKey;
  return periodKey !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(periodKey)
    ? (periodKey as CivilDate)
    : null;
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
  completions: readonly CompletedAt[],
  expandFrom: (anchor: CivilDate) => readonly Occurrence[],
  hasException: (key: string) => boolean,
  /** Start of the window being projected, so older segments can skip expansion. */
  windowStart: CivilDate,
): readonly Occurrence[] {
  if (schedule.rule.kind !== 'daily') return raw;

  const everyNDays = schedule.rule.everyNDays;
  // A rule with several times of day emits that many occurrences per date, and
  // every one of them has its own index. Counting dates would undercount.
  const slotsPerDate = Math.max(1, schedule.timesOfDay.length);

  const dated = completions
    .map((completion) => ({
      dueOn: dueOnFromKey(completion.occurrenceKey),
      completedOn: completion.completedOn,
    }))
    .filter((c): c is { dueOn: CivilDate; completedOn: CivilDate } => c.dueOn !== null)
    .sort((a, b) => compareCivil(a.dueOn, b.dueOn));

  if (dated.length === 0) return raw;

  /*
   * Walked segment by segment, oldest completion first.
   *
   * Each completion moves everything after it, so the occurrence a *later*
   * completion belongs to does not exist on the original grid at all — it only
   * exists on the chain the earlier completion produced. Filtering one grid by
   * date therefore loses those rows, and with them the completions attached to
   * them: a chore done twice showed the second tick as still outstanding.
   */
  const out: Occurrence[] = [];
  let anchor = schedule.startsOn;
  let applied = 0;

  /*
   * How many occurrences the chain has already been through.
   *
   * `occurrenceIndex` is what occurrence-cadence rotation counts turns with, so
   * it has to be **strictly increasing along the chain**. Deriving it from the
   * date's distance along the *original* grid does not: a chore completed a day
   * late produced 0, 2, 3, 4 — index 1 never happened, so whoever had turn 1
   * was silently skipped and the previous person got two turns in a row.
   *
   * Counting instead, from the start of the chain, is monotonic by
   * construction. It is also window-independent, which the running total below
   * is careful to preserve: a segment that ends before the window still adds
   * its occurrences to the count, even though none of them are emitted.
   */
  let chainIndex = 0;

  for (const completion of dated) {
    // A completion behind the anchor belongs to a grid already superseded.
    if (compareCivil(completion.dueOn, anchor) < 0) continue;

    /*
     * A completion has to sit *on* the chain to move it.
     *
     * A tick written against a date this chore no longer falls on — which is
     * what a stale client writes — would otherwise drag the whole series onto
     * a phase nothing was ever due on.
     */
    const offset = daysBetween(anchor, completion.dueOn);
    if (offset % everyNDays !== 0) continue;

    /*
     * Segments that end before the window are counted, not expanded.
     *
     * `expandFrom` materialises the whole window every time it is called, so
     * expanding once per completion made a chore with a couple of years of
     * history cost half a second on every recomputation — on the JS thread,
     * inside a `useMemo`, on each optimistic tick.
     */
    if (compareCivil(completion.dueOn, windowStart) >= 0) {
      for (const occ of expandFrom(anchor)) {
        if (compareCivil(occ.dueOn, completion.dueOn) > 0) break;
        out.push({ ...occ, occurrenceIndex: chainIndex + occ.occurrenceIndex });
      }
    }

    chainIndex += (offset / everyNDays + 1) * slotsPerDate;

    /*
     * N days after it was *done*, and never on or before the occurrence it
     * completed: finishing early must not re-emit dates that are already
     * history, or collide with the key just ticked.
     */
    const restart = addDays(completion.completedOn, everyNDays);
    const earliest = addDays(completion.dueOn, 1);
    anchor = compareCivil(restart, earliest) > 0 ? restart : earliest;
    applied += 1;
  }

  if (applied === 0) return raw;

  for (const occ of expandFrom(anchor)) {
    out.push({ ...occ, occurrenceIndex: chainIndex + occ.occurrenceIndex });
  }

  /*
   * A skip or a reschedule in a gap the re-anchoring removed is kept.
   *
   * Those dates are gone from every chain, so without this a row somebody had
   * explicitly moved vanished from the agenda with no trace.
   */
  const present = new Set(out.map((occ) => occ.occurrenceKey));
  for (const occ of raw) {
    if (!present.has(occ.occurrenceKey) && hasException(occ.occurrenceKey)) out.push(occ);
  }

  return out;
}
