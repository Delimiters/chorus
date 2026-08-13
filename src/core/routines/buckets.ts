/**
 * The four parts of a day a routine item can sit in.
 *
 * A routine is not really scheduled the way a chore is. "Stretch in the
 * morning" is a true statement about when it happens and a false one about
 * 07:00 — so an item may carry a specific time, or just a bucket, and the two
 * are exclusive: a time files the item automatically, and picking a bucket
 * means declining to be specific.
 *
 * The day starts at 05:00 rather than midnight, because that is where a
 * person's day starts. Everything from 21:00 to 04:59 is one continuous
 * evening-into-night, which is the source of the one real subtlety here.
 */

import type { CivilTime } from '../civil/types';

export type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';

/** Display order, and the order the day happens in. */
export const BUCKETS: readonly TimeBucket[] = ['morning', 'afternoon', 'evening', 'night'];

/**
 * Where each bucket begins.
 *
 * Also the time an item's reminder fires when it has no time of its own: a
 * bucket means "sometime this morning", so the start of the window is the
 * honest moment to say so.
 */
const STARTS: Record<TimeBucket, CivilTime> = {
  morning: '05:00' as CivilTime,
  afternoon: '12:00' as CivilTime,
  evening: '17:00' as CivilTime,
  night: '21:00' as CivilTime,
};

const LABELS: Record<TimeBucket, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

/** Minutes since midnight. Internal — the exported ordering is day-relative. */
function minutesSinceMidnight(time: CivilTime): number {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return hh * 60 + mm;
}

/** The day starts at 05:00, so night can be one span rather than two. */
const DAY_START = minutesSinceMidnight('05:00' as CivilTime);
const MINUTES_PER_DAY = 24 * 60;

/**
 * How far into the day a time falls, with 05:00 as zero.
 *
 * This exists because **night wraps midnight**. Sorting raw `'HH:MM'` strings
 * puts `00:30` before `21:00`, so a Night section listing "half past midnight"
 * above "nine in the evening" reads backwards — and the bug is invisible until
 * somebody actually keeps a late routine.
 *
 * Every ordering in this feature goes through here rather than comparing the
 * strings, so there is one definition of "later in the day" instead of one per
 * call site.
 */
export function minutesFromDayStart(time: CivilTime): number {
  return (minutesSinceMidnight(time) - DAY_START + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Which part of the day a specific time belongs to. */
/**
 * Whether a time falls on the calendar day *after* the routine day it belongs
 * to.
 *
 * The routine day runs 05:00 to 05:00, so an item in Tuesday's Night section
 * at 00:30 happens on Wednesday's calendar date. Anything that turns a routine
 * occurrence into an instant — a notification, most obviously — has to add the
 * day back, or it fires almost twenty-four hours early, and for an item due
 * today it lands in the past and is dropped without a word.
 */
export function fallsOnNextCalendarDay(time: CivilTime): boolean {
  return minutesSinceMidnight(time) < DAY_START;
}

export function bucketOf(time: CivilTime): TimeBucket {
  const minutes = minutesFromDayStart(time);
  // Compared in day-relative terms so the night span is a single range rather
  // than "after 21:00 or before 05:00", which is the form that invites an
  // off-by-one at exactly one of its two ends.
  if (minutes < minutesFromDayStart(STARTS.afternoon)) return 'morning';
  if (minutes < minutesFromDayStart(STARTS.evening)) return 'afternoon';
  if (minutes < minutesFromDayStart(STARTS.night)) return 'evening';
  return 'night';
}

export function bucketStart(bucket: TimeBucket): CivilTime {
  return STARTS[bucket];
}

/** Inclusive start, exclusive end — `night` ends at the next day's 05:00. */
export function bucketRange(bucket: TimeBucket): { from: CivilTime; to: CivilTime } {
  const index = BUCKETS.indexOf(bucket);
  const next = BUCKETS[(index + 1) % BUCKETS.length] as TimeBucket;
  return { from: STARTS[bucket], to: STARTS[next] };
}

export function describeBucket(bucket: TimeBucket): string {
  return LABELS[bucket];
}

/** Narrows a value read from the database, which stores the bucket as text. */
export function isTimeBucket(value: unknown): value is TimeBucket {
  return typeof value === 'string' && (BUCKETS as readonly string[]).includes(value);
}
