/**
 * Date formatting for the agenda.
 *
 * Deliberately outside `src/core`: these read a locale and produce prose, which
 * is presentation, not scheduling. The engine stays free of both.
 */

import { addDays, daysBetween, partsOf, weekdayOf } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** `Wednesday 14 January` */
export function formatDayLong(date: CivilDate): string {
  const { month, day } = partsOf(date);
  return `${WEEKDAYS[weekdayOf(date)] as string} ${day} ${MONTHS[month - 1] as string}`;
}

/** `Wed 14 Jan` */
export function formatDayShort(date: CivilDate): string {
  const { month, day } = partsOf(date);
  return `${WEEKDAYS_SHORT[weekdayOf(date)] as string} ${day} ${MONTHS_SHORT[month - 1] as string}`;
}

export const weekdayShort = (date: CivilDate): string => WEEKDAYS_SHORT[weekdayOf(date)] as string;

export const dayOfMonth = (date: CivilDate): number => partsOf(date).day;

export const monthName = (date: CivilDate): string => MONTHS[partsOf(date).month - 1] as string;

/**
 * A day heading, relative where that reads better.
 *
 * "Today" and "Tomorrow" are what people say; past the next few days an absolute
 * date is clearer than "in 9 days".
 */
export function formatRelativeDay(date: CivilDate, today: CivilDate): string {
  const delta = daysBetween(today, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) return WEEKDAYS[weekdayOf(date)] as string;
  return formatDayShort(date);
}

/**
 * The completion window of a floating chore, in words.
 *
 * "3× a week, any day" is the least familiar idea in the app, so the row says
 * when the window closes rather than leaving it implied.
 */
export function formatFlexibleWindow(from: CivilDate, until: CivilDate, today: CivilDate): string {
  const endsIn = daysBetween(today, until);
  if (endsIn < 0) return 'window closed';
  if (endsIn === 0) return 'last day';
  if (endsIn === 1) return 'until tomorrow';
  if (endsIn < 7) return `until ${WEEKDAYS[weekdayOf(until)] as string}`;
  void from;
  return `until ${formatDayShort(until)}`;
}

/** Heading for the band of chores that are not on any particular day. */
formatFlexibleWindow.sectionTitle = 'Sometime this week';

/**
 * The small caption under a day number on the Upcoming rail.
 *
 * The weekday is already printed directly above it, so repeating "Friday" there
 * would say nothing. Relative words earn their place; otherwise the month does,
 * since that is what the rail is missing once you scroll past a boundary.
 */
export function formatDayCaption(date: CivilDate, today: CivilDate): string {
  const delta = daysBetween(today, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  return MONTHS_SHORT[partsOf(date).month - 1] as string;
}

/** Inclusive list of dates in a window, for building an agenda or a grid. */
export function datesBetween(start: CivilDate, end: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  const span = daysBetween(start, end);
  for (let i = 0; i <= span; i += 1) out.push(addDays(start, i));
  return out;
}
