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
      return isSameOrAfter(rule.dueOn, from) && isSameOrBefore(rule.dueOn, to)
        ? [build(rule.dueOn, dayPeriodKey(rule.dueOn), 0, 0, rule.dueOn, rule.dueOn)]
        : [];

    case 'daily':
      return expandDaily(schedule.startsOn, rule.everyNDays, from, to, build);

    case 'weekly':
      return expandWeekly(schedule.startsOn, rule.everyNWeeks, rule.weekdays, cal, from, to, build);

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
) => Occurrence;

function makeBuilder(choreId: string, subject: string | null): Build {
  return (dueOn, periodKey, slot, occurrenceIndex, flexibleFrom, flexibleUntil) => ({
    choreId,
    occurrenceKey: occurrenceKeyOf(choreId, periodKey, slot, subject),
    occurrenceIndex,
    dueOn,
    periodKey,
    slot,
    subject,
    flexibleFrom,
    flexibleUntil,
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

function expandWeekly(
  anchor: CivilDate,
  everyNWeeks: number,
  weekdays: readonly Weekday[],
  cal: CalendarConfig,
  from: CivilDate,
  to: CivilDate,
  build: Build,
): Occurrence[] {
  const anchorWeek = startOfWeek(anchor, cal.weekStartsOn);
  const sorted = [...weekdays].sort((a, b) => a - b);

  // First on-cycle week at or before `from`, so occurrences earlier in that
  // week are still considered.
  const weeksIn = weeksBetween(anchorWeek, startOfWeek(from, cal.weekStartsOn), cal.weekStartsOn);
  const firstCycle = Math.max(0, Math.floor(weeksIn / everyNWeeks));

  const out: Occurrence[] = [];
  for (let cycle = firstCycle; ; cycle += 1) {
    const weekStart = addDays(anchorWeek, cycle * everyNWeeks * 7);
    if (compareCivil(weekStart, to) > 0) break;

    for (const [slot, weekday] of sorted.entries()) {
      const dueOn = addDays(weekStart, offsetToWeekday(weekday, cal.weekStartsOn));
      if (compareCivil(dueOn, from) < 0 || compareCivil(dueOn, to) > 0) continue;
      out.push(build(dueOn, dayPeriodKey(dueOn), 0, cycle * sorted.length + slot, dueOn, dueOn));
    }
  }
  return sortOccurrences(out);
}

/** Days from a week's start to the given weekday within that same week. */
function offsetToWeekday(weekday: Weekday, weekStartsOn: Weekday): number {
  return (((weekday - weekStartsOn) % 7) + 7) % 7;
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
    // All slots anchor to the week's start; the flexible range is the week.
    // They differ only by slot index, which is exactly what stops them
    // deduplicating into one.
    if (compareCivil(weekStart, from) < 0 || compareCivil(weekStart, to) > 0) continue;

    for (let slot = 0; slot < timesPerPeriod; slot += 1) {
      out.push(
        build(
          weekStart,
          weekPeriodKey(weekStart, cal.weekStartsOn),
          slot,
          cycle * timesPerPeriod + slot,
          weekStart,
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
    if (compareCivil(monthStart, from) < 0) continue;

    const monthEnd = endOfMonth(monthStart);
    for (let slot = 0; slot < timesPerPeriod; slot += 1) {
      out.push(
        build(
          monthStart,
          monthPeriodKey(monthStart),
          slot,
          cycle * timesPerPeriod + slot,
          monthStart,
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
