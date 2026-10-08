/**
 * When one day becomes the next.
 *
 * Midnight is the wrong answer for a household. Jake: *"if I'm doing something
 * late at night it doesn't count as the next day"* — tick the last chore at
 * 00:40 and it landed on tomorrow's record, so tonight looked unfinished and
 * tomorrow started with a chore nobody had done yet. Twice wrong from one
 * timestamp.
 *
 * So the household names an hour, and a day runs from that hour to the same
 * hour the next morning. Pure and `Date`-free like the rest of `core`: these
 * take a wall-clock date and hour and answer with a civil day, which keeps the
 * one place that reads a clock — `src/data/today.ts` — the only such place.
 *
 * **The boundary instant belongs to the day that is starting.** With a 3 AM
 * break, 02:59 is the previous day and 03:00 is the new one. Jake described it
 * as *"3am or earlier on Tuesday should [count] as Monday"*, which read
 * literally puts 03:00:00 on Monday; the direction is what he was pinning, and
 * a half-open window `[D 03:00, D+1 03:00)` is the only version where every
 * instant belongs to exactly one day. Said plainly rather than fudged, because
 * it is one minute of the day and somebody will eventually test it.
 */

import { addDays } from './date';
import type { CivilDate, CivilTime } from './types';

/** Midnight — the ordinary calendar day, for anyone who wants it back. */
export const DAY_START_MIN = 0;

/**
 * Noon, and not higher.
 *
 * A break after midday would mean a day whose own afternoon is "yesterday", and
 * the half-open window stops making sense to read: 11 AM on Tuesday filed under
 * Monday. The upper bound is the mirror of the lower one — a day has to contain
 * its own daylight.
 */
export const DAY_START_MAX = 12;

/** What Jake asked for. */
export const DAY_START_DEFAULT = 3;

/**
 * An hour from untrusted storage, clamped to something usable.
 *
 * The column has a CHECK, but a row can predate it and `undefined` arrives
 * every time the household query has not landed. A bad value here would shift
 * every date in the app, so it degrades to the default rather than throwing on
 * a render.
 */
export function safeDayStart(hour: number | null | undefined): number {
  if (hour === null || hour === undefined || !Number.isInteger(hour)) return DAY_START_DEFAULT;
  if (hour < DAY_START_MIN || hour > DAY_START_MAX) return DAY_START_DEFAULT;
  return hour;
}

/** The hour of a `CivilTime`, as a number. */
function hourOf(time: CivilTime): number {
  return Number(time.slice(0, 2));
}

/**
 * Which civil day a wall-clock moment belongs to.
 *
 * The small hours belong to the night before: at a 3 AM break, Tuesday 00:40 is
 * still Monday.
 */
export function dayOfWallClock(
  wallDate: CivilDate,
  wallTime: CivilTime,
  dayStartsAtHour: number,
): CivilDate {
  return hourOf(wallTime) < safeDayStart(dayStartsAtHour) ? addDays(wallDate, -1) : wallDate;
}

/**
 * The inverse: the wall-clock date on which a time-of-day for a civil day
 * actually happens.
 *
 * A chore on Monday with a 01:00 reminder fires on Tuesday morning by the
 * calendar, because 01:00 Tuesday *is* Monday night. Without this the reminder
 * was scheduled for 01:00 on Monday — twenty-three hours early, and already in
 * the past by the time the plan was made, so it never fired at all.
 */
export function wallDateFor(day: CivilDate, atTime: CivilTime, dayStartsAtHour: number): CivilDate {
  return hourOf(atTime) < safeDayStart(dayStartsAtHour) ? addDays(day, 1) : day;
}

/**
 * How the break reads in a sentence: `3` → `"3 AM"`.
 *
 * Here rather than in the settings screen because the notification copy and the
 * chart's day labels want the same words, and three spellings of "3 AM" is how
 * an interface stops sounding like one thing.
 */
export function describeDayStart(hour: number): string {
  const safe = safeDayStart(hour);
  if (safe === 0) return 'midnight';
  if (safe === 12) return 'noon';
  return `${String(safe)} AM`;
}
