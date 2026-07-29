/**
 * Civil date arithmetic — pure integer math over `'YYYY-MM-DD'` strings.
 *
 * There is deliberately no `Date` object in this file, and a lint rule enforces
 * that. `Date` carries an instant and a timezone; a due date has neither. Every
 * timezone bug in the previous implementation came from mixing the two.
 *
 * The epoch-day conversions are Howard Hinnant's civil-calendar algorithms,
 * which are exact for the whole proleptic Gregorian calendar and avoid the
 * iterate-and-hope loops that broke on short months.
 *
 * @see docs/RECURRENCE.md
 */

import type { CivilDate, NthWeek, Weekday } from './types';

const DATE_PATTERN = /^-?\d{4,6}-\d{2}-\d{2}$/;

/** Days from 1970-01-01 to 0000-03-01, the shifted era epoch Hinnant's math uses. */
const DAYS_TO_ERA_EPOCH = 719_468;
const DAYS_PER_ERA = 146_097;

export class InvalidCivilDateError extends Error {
  constructor(value: string, reason: string) {
    super(`Invalid civil date ${JSON.stringify(value)}: ${reason}`);
    this.name = 'InvalidCivilDateError';
  }
}

// ── Construction & validation ───────────────────────────────────────────────

const pad = (n: number, width: number): string => String(Math.abs(n)).padStart(width, '0');

/** Formats y/m/d as a `CivilDate` without validating that the date exists. */
function format(year: number, month: number, day: number): CivilDate {
  const sign = year < 0 ? '-' : '';
  return `${sign}${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as CivilDate;
}

/** True for years divisible by 4, except centuries not divisible by 400. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in the given month. Handles February correctly. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new RangeError(`Month out of range: ${month}`);
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Parses a `CivilDate` into its parts. Assumes the input is already valid. */
export function partsOf(date: CivilDate): { year: number; month: number; day: number } {
  const negative = date.startsWith('-');
  const body = negative ? date.slice(1) : date;
  const [y, m, d] = body.split('-');
  return {
    year: (negative ? -1 : 1) * Number(y),
    month: Number(m),
    day: Number(d),
  };
}

/**
 * Validates and brands a date string.
 *
 * Rejects malformed strings and dates that don't exist (`'2026-02-30'`), so an
 * impossible date can never enter the engine from user input or a database row.
 */
export function civilDate(value: string): CivilDate {
  if (!DATE_PATTERN.test(value)) {
    throw new InvalidCivilDateError(value, 'expected YYYY-MM-DD');
  }
  const { year, month, day } = partsOf(value as CivilDate);
  if (month < 1 || month > 12) {
    throw new InvalidCivilDateError(value, `month ${month} out of range`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new InvalidCivilDateError(value, `day ${day} does not exist in ${year}-${pad(month, 2)}`);
  }
  return value as CivilDate;
}

/** Like {@link civilDate} but returns null instead of throwing. */
export function tryCivilDate(value: string): CivilDate | null {
  try {
    return civilDate(value);
  } catch {
    return null;
  }
}

/** Builds a `CivilDate` from parts, validating that the date exists. */
export function fromParts(year: number, month: number, day: number): CivilDate {
  return civilDate(format(year, month, day));
}

// ── Epoch-day conversion (Hinnant) ──────────────────────────────────────────

/**
 * Days since 1970-01-01. Negative before the epoch.
 *
 * Shifts the year to start in March so the leap day lands at the end of the
 * year, which removes February as a special case entirely.
 */
export function toEpochDay(date: CivilDate): number {
  const { year, month, day } = partsOf(date);
  const y = month <= 2 ? year - 1 : year;
  // Hinnant writes this as `(y >= 0 ? y : y - 399) / 400` because C++ integer
  // division truncates toward zero and he needs a floor. `Math.floor` already
  // floors, so applying the adjustment too would correct twice and land an era
  // early for negative years.
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * DAYS_PER_ERA + doe - DAYS_TO_ERA_EPOCH;
}

/** Inverse of {@link toEpochDay}. */
export function fromEpochDay(epochDay: number): CivilDate {
  const z = epochDay + DAYS_TO_ERA_EPOCH;
  // See the note in toEpochDay: Hinnant's `z - (DAYS_PER_ERA - 1)` adjustment
  // emulates floor division in C++. `Math.floor` does it directly.
  const era = Math.floor(z / DAYS_PER_ERA);
  const doe = z - era * DAYS_PER_ERA; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11], March-based
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return format(month <= 2 ? y + 1 : y, month, day);
}

// ── Arithmetic ──────────────────────────────────────────────────────────────

/** Adds (or subtracts) whole days. */
export function addDays(date: CivilDate, days: number): CivilDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Signed count of days from `a` to `b`. */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/**
 * Adds months, clamping the day to the last valid day of the target month.
 *
 * `2026-01-31 + 1 month` is `2026-02-28`, not a nonexistent Feb 31 and not a
 * silent overflow into March. This is the direct fix for the bug that stopped
 * monthly chores from recurring at all in the previous implementation.
 *
 * Note this is intentionally not reversible: adding then subtracting a month
 * from Jan 31 gives Jan 28. That is inherent to calendar arithmetic, which is
 * why the recurrence engine always computes from a fixed anchor rather than by
 * stepping repeatedly.
 */
export function addMonthsClamped(date: CivilDate, months: number): CivilDate {
  const { year, month, day } = partsOf(date);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = zeroBased - targetYear * 12 + 1;
  return format(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** Signed count of whole calendar months from `a` to `b`, ignoring day-of-month. */
export function monthsBetween(a: CivilDate, b: CivilDate): number {
  const from = partsOf(a);
  const to = partsOf(b);
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/** First day of the month containing `date`. */
export function startOfMonth(date: CivilDate): CivilDate {
  const { year, month } = partsOf(date);
  return format(year, month, 1);
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: CivilDate): CivilDate {
  const { year, month } = partsOf(date);
  return format(year, month, daysInMonth(year, month));
}

// ── Weeks ───────────────────────────────────────────────────────────────────

/**
 * Day of the week, 0 = Sunday.
 *
 * 1970-01-01 was a Thursday (4), hence the offset. The extra `+ 7) % 7` keeps
 * the result non-negative for pre-epoch dates, where `%` would otherwise yield
 * a negative remainder.
 */
export function weekdayOf(date: CivilDate): Weekday {
  return ((((toEpochDay(date) + 4) % 7) + 7) % 7) as Weekday;
}

/** Start of the week containing `date`, per the household's week-start setting. */
export function startOfWeek(date: CivilDate, weekStartsOn: Weekday): CivilDate {
  const offset = (((weekdayOf(date) - weekStartsOn) % 7) + 7) % 7;
  return addDays(date, -offset);
}

/** Signed count of whole weeks between the week-starts containing `a` and `b`. */
export function weeksBetween(a: CivilDate, b: CivilDate, weekStartsOn: Weekday): number {
  const from = startOfWeek(a, weekStartsOn);
  const to = startOfWeek(b, weekStartsOn);
  return daysBetween(from, to) / 7;
}

/**
 * The date of the `nth` `weekday` in the given month. `nth = -1` means "last".
 *
 * Always succeeds: the shortest possible month is 28 days, which contains
 * exactly four of every weekday, and `NthWeek` is constrained to 1–4 or -1.
 * There is deliberately no null case for callers to handle.
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  nth: NthWeek,
  weekday: Weekday,
): CivilDate {
  if (nth === -1) {
    const last = format(year, month, daysInMonth(year, month));
    const back = (((weekdayOf(last) - weekday) % 7) + 7) % 7;
    return addDays(last, -back);
  }
  const first = format(year, month, 1);
  const forward = (((weekday - weekdayOf(first)) % 7) + 7) % 7;
  return format(year, month, 1 + forward + (nth - 1) * 7);
}

// ── Comparison ──────────────────────────────────────────────────────────────

/** Negative if a < b, zero if equal, positive if a > b. */
export function compareCivil(a: CivilDate, b: CivilDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

export const isBefore = (a: CivilDate, b: CivilDate): boolean => compareCivil(a, b) < 0;
export const isAfter = (a: CivilDate, b: CivilDate): boolean => compareCivil(a, b) > 0;
export const isSameOrBefore = (a: CivilDate, b: CivilDate): boolean => compareCivil(a, b) <= 0;
export const isSameOrAfter = (a: CivilDate, b: CivilDate): boolean => compareCivil(a, b) >= 0;

/** True if `date` falls within `[start, end]`, inclusive. */
export function isWithin(date: CivilDate, start: CivilDate, end: CivilDate): boolean {
  return isSameOrAfter(date, start) && isSameOrBefore(date, end);
}

export const minCivil = (a: CivilDate, b: CivilDate): CivilDate => (isBefore(a, b) ? a : b);
export const maxCivil = (a: CivilDate, b: CivilDate): CivilDate => (isAfter(a, b) ? a : b);
