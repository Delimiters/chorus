/**
 * Occurrence expansion — the heart of the scheduler.
 *
 * Given a schedule and a date window, produce every occurrence whose anchor
 * date falls inside that window. Pure, deterministic, and O(occurrences in
 * window) rather than O(occurrences since the chore was created).
 *
 * ## The window membership rule
 *
 * An occurrence belongs to a window if and only if `dueOn` falls within it.
 * Floating occurrences also carry `flexibleFrom`/`flexibleUntil` for display
 * and for "can this still be done today", but those never affect membership.
 *
 * That single rule is what makes window composability true by construction:
 * expanding `[a, c]` always equals expanding `[a, b]` concatenated with
 * `[b+1, c]`. It is the property most likely to catch an off-by-one anywhere
 * in this file.
 *
 * @see docs/RECURRENCE.md
 */

import {
  addDays,
  addMonthsClamped,
  compareCivil,
  daysBetween,
  daysInMonth,
  endOfMonth,
  fromParts,
  isSameOrAfter,
  isSameOrBefore,
  maxCivil,
  minCivil,
  monthsBetween,
  nthWeekdayOfMonth,
  partsOf,
  startOfMonth,
  startOfWeek,
  weekdayOf,
  weeksBetween,
} from '../civil/date';
import type { CalendarConfig, CivilDate, DateWindow, Weekday } from '../civil/types';
import { assertNever } from '../lib/assertNever';
import { dayPeriodKey, monthPeriodKey, occurrenceKeyOf, weekPeriodKey } from './period';
import type { Occurrence, Schedule } from './types';

/**
 * Widest window the expander will process.
 *
 * A bug that asks for ten years of daily occurrences should fail loudly rather
 * than lock up the UI building 3,650 objects nobody wanted.
 */
export const MAX_WINDOW_DAYS = 400;

export class WindowTooWideError extends Error {
  constructor(days: number) {
    super(`Expansion window of ${days} days exceeds the maximum of ${MAX_WINDOW_DAYS}`);
    this.name = 'WindowTooWideError';
  }
}

/**
 * Every occurrence of `schedule` anchored within `window`, sorted by
 * `(dueOn, slot)`.
 *
 * @param subject member id when fanning out an `everyone` chore; null otherwise
 */
export function expandOccurrences(
  choreId: string,
  schedule: Schedule,
  cal: CalendarConfig,
  window: DateWindow,
  subject: string | null = null,
): readonly Occurrence[] {
  const span = daysBetween(window.start, window.end);
  if (span < 0) return [];
  if (span + 1 > MAX_WINDOW_DAYS) throw new WindowTooWideError(span + 1);

  // Clamp the window to the schedule's own lifetime before doing any work.
  const from = maxCivil(window.start, schedule.startsOn);
  const to = schedule.endsOn ? minCivil(window.end, schedule.endsOn) : window.end;
  if (compareCivil(from, to) > 0) return [];

  const { rule } = schedule;
  const build = makeBuilder(choreId, subject);

  switch (rule.kind) {
    case 'unscheduled':
      // Someday chores are a plain list, not part of the schedule at all.
      return [];

    case 'once':
      // Deliberately bounded by the WINDOW only, not by startsOn/endsOn. Those
      // position a recurring sequence and are meaningless for a single dated
      // task — and clamping to them made "add a one-time thing I should have
      // done yesterday" write a row that appeared on no screen, which is
      // postmortem failure #5 in mirror image.
      //
      // `showFrom` rides alongside rather than widening the flexible window.
      // That window says when the occurrence may be *completed*, and a wider
      // one is exactly how `isFloatingItem` recognises "three times this week"
      // — so widening it here filed every dated chore with a lead time into
      // the floating band. `dueOn` is untouched either way.
      //
      // Clamped, because a start date after the deadline is just "now".
      return isSameOrAfter(rule.dueOn, window.start) && isSameOrBefore(rule.dueOn, window.end)
        ? [
            build(
              rule.dueOn,
              dayPeriodKey(rule.dueOn),
              0,
              0,
              // The completion window stays a single day. Widening it here is
              // what made a dated chore with a lead time read as floating.
              rule.dueOn,
              rule.dueOn,
              rule.showFrom === undefined ? null : minCivil(rule.showFrom, rule.dueOn),
            ),
          ]
        : [];

    case 'daily':
      return expandDaily(schedule.startsOn, rule.everyNDays, from, to, build);

    case 'weekly':
      return expandWeekly(schedule.startsOn, rule.everyNWeeks, rule.weekdays, from, to, build);

    case 'weeklyFloating':
      return expandWeeklyFloating(
        schedule.startsOn,
        rule.everyNWeeks,
        rule.timesPerPeriod,
        cal,
        from,
        to,
        build,
      );

    case 'monthlyByDay':
      return expandMonthlyByDay(
        schedule.startsOn,
        rule.everyNMonths,
        rule.dayOfMonth,
        rule.overflow,
        from,
        to,
        build,
      );

    case 'monthlyByWeekday':
      return expandMonthlyByWeekday(
        schedule.startsOn,
        rule.everyNMonths,
        rule.nth,
        rule.weekday,
        from,
        to,
        build,
      );

    case 'monthlyFloating':
      return expandMonthlyFloating(
        schedule.startsOn,
        rule.everyNMonths,
        rule.timesPerPeriod,
        from,
        to,
        build,
      );

    default:
      return assertNever(rule, 'recurrence rule');
  }
}

// ── Builder ─────────────────────────────────────────────────────────────────

type Build = (
  dueOn: CivilDate,
  periodKey: string,
  slot: number,
  occurrenceIndex: number,
  flexibleFrom: CivilDate,
  flexibleUntil: CivilDate,
  /** Only a one-time chore asked to appear before it is due passes this. */
  showFrom?: CivilDate | null,
) => Occurrence;

function makeBuilder(choreId: string, subject: string | null): Build {
  return (
    dueOn,
    periodKey,
    slot,
    occurrenceIndex,
    flexibleFrom,
    flexibleUntil,
    showFrom = null,
  ) => ({
    choreId,
    occurrenceKey: occurrenceKeyOf(choreId, periodKey, slot, subject),
    occurrenceIndex,
    dueOn,
    periodKey,
    slot,
    subject,
    flexibleFrom,
    flexibleUntil,
    showFrom,
  });
}

// ── Daily ───────────────────────────────────────────────────────────────────

function expandDaily(
  anchor: CivilDate,
  everyNDays: number,
  from: CivilDate,
  to: CivilDate,
  build: Build,
): Occurrence[] {
  // Jump straight to the first on-cycle day at or after `from` instead of
  // stepping from the anchor — a three-year-old daily chore must not cost a
  // thousand iterations to render today.
  const offset = daysBetween(anchor, from);
  const firstIndex = Math.max(0, Math.ceil(offset / everyNDays));

  const out: Occurrence[] = [];
  for (let i = firstIndex; ; i += 1) {
    const dueOn = addDays(anchor, i * everyNDays);
    if (compareCivil(dueOn, to) > 0) break;
    out.push(build(dueOn, dayPeriodKey(dueOn), 0, i, dueOn, dueOn));
  }
  return out;
}

// ── Weekly (anchored to specific weekdays) ──────────────────────────────────

/**
 * Anchored weekly rules.
 *
 * The cycle is phased off the **anchor date**, not off the household's week
 * start. That is deliberate and was originally wrong: phasing off
 * `startOfWeek(anchor, weekStartsOn)` made "every other Tuesday" produce
 * completely different dates depending on a display preference —
 *
 *   weekStartsOn 0 -> 2026-01-06, 01-20, 02-03 …
 *   weekStartsOn 1 -> 2026-01-13, 01-27, 02-10 …
 *
 * — so toggling Sunday/Monday in settings silently rescheduled every biweekly
 * chore by a week and orphaned its completions. "Every other Tuesday" means
 * every 14 days from the anchor; the week start has no business in that
 * arithmetic. It still governs floating rules, where the period genuinely is a
 * calendar week, and display.
 */
function expandWeekly(
  anchor: CivilDate,
  everyNWeeks: number,
  weekdays: readonly Weekday[],
  from: CivilDate,
  to: CivilDate,
  build: Build,
): Occurrence[] {
  /**
   * Ordered by **when they fall**, not by weekday number.
   *
   * This is the whole of a real bug. The dates within a block run forward from
   * the anchor's own weekday, but the index used to run in weekday-number
   * order — so unless the anchor happened to land on the earliest selected day,
   * index and date disagreed. `occurrenceIndex` is what an `occurrence`-cadence
   * rotation counts turns with, and that is the default cadence, so "bins
   * Mon/Wed/Fri, we alternate" produced:
   *
   *   Fri alice · Mon alice · Wed bob · Fri bob · Mon bob · Wed alice …
   *
   * Nobody who asks for alternation gets three in a row. The expander even
   * called `sortOccurrences` afterwards to fix the *display* order, which
   * repaired the symptom and left the indices scrambled.
   */
  /**
   * The block begins on the **earliest weekday you chose**, not on whichever
   * day you happened to create the chore.
   *
   * That distinction only shows up for `everyNWeeks >= 2`, and it showed up
   * badly. Blocks used to start at the anchor date, and each weekday was placed
   * by counting forward from the anchor's own weekday — so "every 2 weeks on
   * Monday and Wednesday", set up on a Wednesday, gave:
   *
   *     Wed 29 Jul · Mon 3 Aug   (nine-day gap)   Wed 12 Aug · Mon 17 Aug
   *
   * The pair straddled two calendar weeks, because "Monday" meant the Monday
   * five days *after* the Wednesday rather than the one two days before it.
   * Anchoring the block to Monday instead groups them:
   *
   *     Wed 29 Jul   ·   Mon 10 · Wed 12   ·   Mon 24 · Wed 26
   *
   * With `everyNWeeks: 1` nothing changes at all — consecutive blocks tile the
   * calendar with no gaps, so every weekday lands once a week wherever the
   * block starts.
   *
   * Note what this deliberately does NOT consult: the household's week-start
   * setting. Phasing off `startOfWeek(anchor, weekStartsOn)` was the original
   * implementation and it meant toggling Sunday/Monday in settings silently
   * moved every biweekly chore by a week, orphaning its completions. The
   * earliest chosen weekday is stored on the rule, so it cannot change
   * underneath a chore.
   */
  const origin = [...weekdays].sort((a, b) => a - b)[0] as Weekday;
  const inDateOrder = [...weekdays].sort(
    (a, b) => offsetToWeekday(a, origin) - offsetToWeekday(b, origin),
  );

  /**
   * Phase the blocks so that the **first occurrence on or after `startsOn`**
   * lands in block zero.
   *
   * Two simpler rules both fail, and a golden fixture caught the second:
   *
   * - the nearest origin weekday *after* `startsOn` skips days left in the
   *   current week, so a Mon+Wed chore created on Wednesday waits five days
   *   instead of firing that day;
   * - the nearest one *before* it shifts the whole sequence back a week, so
   *   "every other Monday" starting Sunday 4 Jan produced 12 Jan rather than
   *   5 Jan — the 5th fell in the gap between blocks.
   *
   * Finding the first real occurrence and working backwards to its origin
   * weekday gets both: the Wednesday still fires, and the Monday sequence keeps
   * the week the author asked for.
   */
  const toFirstHit = Math.min(...weekdays.map((w) => offsetToWeekday(w, weekdayOf(anchor))));
  const firstHit = addDays(anchor, toFirstHit);
  const blockOrigin = addDays(firstHit, -offsetToWeekday(weekdayOf(firstHit), origin));

  // Stepping back one cycle from `from` guarantees occurrences early in that
  // block are still considered.
  const daysIn = daysBetween(blockOrigin, from);
  const firstCycle = Math.max(0, Math.floor(daysIn / (everyNWeeks * 7)));

  const out: Occurrence[] = [];
  for (let cycle = firstCycle; ; cycle += 1) {
    const blockStart = addDays(blockOrigin, cycle * everyNWeeks * 7);
    if (compareCivil(blockStart, to) > 0) break;

    for (const [slot, weekday] of inDateOrder.entries()) {
      // Days forward from the anchor's own weekday to the requested weekday.
      const dueOn = addDays(blockStart, offsetToWeekday(weekday, origin));
      if (compareCivil(dueOn, from) < 0 || compareCivil(dueOn, to) > 0) continue;
      out.push(
        build(dueOn, dayPeriodKey(dueOn), 0, cycle * inDateOrder.length + slot, dueOn, dueOn),
      );
    }
  }
  return sortOccurrences(out);
}

/** Days forward from `origin` weekday to `weekday`, within one 7-day block. */
function offsetToWeekday(weekday: Weekday, origin: Weekday): number {
  return (((weekday - origin) % 7) + 7) % 7;
}

// ── Weekly floating ("N times per week, any days") ──────────────────────────

function expandWeeklyFloating(
  anchor: CivilDate,
  everyNWeeks: number,
  timesPerPeriod: number,
  cal: CalendarConfig,
  from: CivilDate,
  to: CivilDate,
  build: Build,
): Occurrence[] {
  const anchorWeek = startOfWeek(anchor, cal.weekStartsOn);
  const weeksIn = weeksBetween(anchorWeek, startOfWeek(from, cal.weekStartsOn), cal.weekStartsOn);
  const firstCycle = Math.max(0, Math.floor(weeksIn / everyNWeeks));

  const out: Occurrence[] = [];
  for (let cycle = firstCycle; ; cycle += 1) {
    const weekStart = addDays(anchorWeek, cycle * everyNWeeks * 7);
    if (compareCivil(weekStart, to) > 0) break;

    const weekEnd = addDays(weekStart, 6);

    // The occurrence anchors at the later of the period start and the schedule
    // start, so a chore created mid-week still produces that week's occurrences.
    // Previously the partial period was skipped entirely: "gym 3x a week" created
    // on a Tuesday produced nothing at all until the following Sunday.
    //
    // Anchoring to max(periodStart, anchor) rather than to the window keeps
    // window composability intact, because the date still does not depend on
    // which window is being expanded.
    const dueOn = maxCivil(weekStart, anchor);
    const flexibleFrom = dueOn;
    if (compareCivil(dueOn, from) < 0 || compareCivil(dueOn, to) > 0) continue;

    for (let slot = 0; slot < timesPerPeriod; slot += 1) {
      out.push(
        build(
          dueOn,
          weekPeriodKey(weekStart, cal.weekStartsOn),
          slot,
          cycle * timesPerPeriod + slot,
          flexibleFrom,
          weekEnd,
        ),
      );
    }
  }
  return sortOccurrences(out);
}

// ── Monthly by day-of-month ─────────────────────────────────────────────────

function expandMonthlyByDay(
  anchor: CivilDate,
  everyNMonths: number,
  dayOfMonth: number,
  overflow: 'clamp' | 'skip',
  from: CivilDate,
  to: CivilDate,
  build: Build,
): Occurrence[] {
  const monthsIn = monthsBetween(startOfMonth(anchor), startOfMonth(from));
  const firstCycle = Math.max(0, Math.floor(monthsIn / everyNMonths));

  const out: Occurrence[] = [];
  for (let cycle = firstCycle; ; cycle += 1) {
    const monthStart = addMonthsClamped(startOfMonth(anchor), cycle * everyNMonths);
    if (compareCivil(monthStart, to) > 0) break;

    const { year, month } = partsOf(monthStart);
    const length = daysInMonth(year, month);

    if (dayOfMonth > length && overflow === 'skip') continue;
    const dueOn = fromParts(year, month, Math.min(dayOfMonth, length));

    if (compareCivil(dueOn, from) < 0 || compareCivil(dueOn, to) > 0) continue;
    out.push(build(dueOn, dayPeriodKey(dueOn), 0, cycle, dueOn, dueOn));
  }
  return out;
}

// ── Monthly by Nth weekday ──────────────────────────────────────────────────

function expandMonthlyByWeekday(
  anchor: CivilDate,
  everyNMonths: number,
  nth: 1 | 2 | 3 | 4 | -1,
  weekday: Weekday,
  from: CivilDate,
  to: CivilDate,
  build: Build,
): Occurrence[] {
  const monthsIn = monthsBetween(startOfMonth(anchor), startOfMonth(from));
  const firstCycle = Math.max(0, Math.floor(monthsIn / everyNMonths));

  const out: Occurrence[] = [];
  for (let cycle = firstCycle; ; cycle += 1) {
    const monthStart = addMonthsClamped(startOfMonth(anchor), cycle * everyNMonths);
    if (compareCivil(monthStart, to) > 0) break;

    const { year, month } = partsOf(monthStart);
    const dueOn = nthWeekdayOfMonth(year, month, nth, weekday);

    if (compareCivil(dueOn, from) < 0 || compareCivil(dueOn, to) > 0) continue;
    out.push(build(dueOn, dayPeriodKey(dueOn), 0, cycle, dueOn, dueOn));
  }
  return out;
}

// ── Monthly floating ("N times per month, any days") ────────────────────────

function expandMonthlyFloating(
  anchor: CivilDate,
  everyNMonths: number,
  timesPerPeriod: number,
  from: CivilDate,
  to: CivilDate,
  build: Build,
): Occurrence[] {
  const monthsIn = monthsBetween(startOfMonth(anchor), startOfMonth(from));
  const firstCycle = Math.max(0, Math.floor(monthsIn / everyNMonths));

  const out: Occurrence[] = [];
  for (let cycle = firstCycle; ; cycle += 1) {
    const monthStart = addMonthsClamped(startOfMonth(anchor), cycle * everyNMonths);
    if (compareCivil(monthStart, to) > 0) break;

    const monthEnd = endOfMonth(monthStart);
    // See the weekly-floating note: anchor at max(periodStart, schedule anchor)
    // so a chore created mid-month still produces that month's occurrences.
    const dueOn = maxCivil(monthStart, anchor);
    if (compareCivil(dueOn, from) < 0 || compareCivil(dueOn, to) > 0) continue;

    for (let slot = 0; slot < timesPerPeriod; slot += 1) {
      out.push(
        build(
          dueOn,
          monthPeriodKey(monthStart),
          slot,
          cycle * timesPerPeriod + slot,
          dueOn,
          monthEnd,
        ),
      );
    }
  }
  return sortOccurrences(out);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Sorts by due date, then slot — the canonical occurrence ordering. */
function sortOccurrences(list: Occurrence[]): Occurrence[] {
  return list.sort((a, b) => compareCivil(a.dueOn, b.dueOn) || a.slot - b.slot);
}
