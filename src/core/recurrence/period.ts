/**
 * Period keys and occurrence identity.
 *
 * A period key names the calendar bucket an occurrence belongs to. Combined
 * with a slot index it produces a stable, collision-free occurrence key.
 *
 * This is the direct structural fix for the previous implementation's worst
 * bug: it generated N identical dates for "3× per week" and then deduplicated
 * by date, silently collapsing them into one. Here those three occurrences are
 * slots 0, 1 and 2 of period `2026-W31` — three different keys, with nothing
 * anywhere that could merge them.
 */

import { partsOf, startOfWeek, toEpochDay } from '../civil/date';
import type { CivilDate, Weekday } from '../civil/types';

/**
 * Version prefix on every occurrence key.
 *
 * Completions and exceptions are stored against these keys. If the key
 * algorithm ever changes, bump this and ship a data migration — never change
 * the format silently, or every historical completion orphans.
 */
export const OCCURRENCE_KEY_VERSION = 'v1';

/** `'2026-07-29'` — the period key for day-anchored rules. */
export function dayPeriodKey(date: CivilDate): string {
  return date;
}

/**
 * `'2026-W31'` — the period key for week-floating rules.
 *
 * The week number counts from the week containing the rule's own anchor, not
 * from an ISO calendar, because the household's `weekStartsOn` may not match
 * ISO's Monday. Deriving it from the week-start date keeps it consistent under
 * either setting.
 */
export function weekPeriodKey(date: CivilDate, weekStartsOn: Weekday): string {
  const weekStart = startOfWeek(date, weekStartsOn);
  const { year } = partsOf(weekStart);
  // Week ordinal within the year, based on the household's week boundaries.
  const firstDayOfYear = `${String(year).padStart(4, '0')}-01-01` as CivilDate;
  const firstWeekStart = startOfWeek(firstDayOfYear, weekStartsOn);
  const week = Math.floor((toEpochDay(weekStart) - toEpochDay(firstWeekStart)) / 7) + 1;
  return `${String(year).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}

/** `'2026-07'` — the period key for month-floating rules. */
export function monthPeriodKey(date: CivilDate): string {
  const { year, month } = partsOf(date);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * Builds an occurrence key.
 *
 * Deterministic and I/O-free, so the client can compute it and write a
 * completion optimistically before the server has ever heard of it.
 *
 * @param subject member id for `everyone` fan-out chores, otherwise null
 */
export function occurrenceKeyOf(
  choreId: string,
  periodKey: string,
  slot: number,
  subject: string | null,
): string {
  return `${OCCURRENCE_KEY_VERSION}:${choreId}:${periodKey}:${slot}:${subject ?? '-'}`;
}

/** Parsed form of an occurrence key. */
export interface ParsedOccurrenceKey {
  readonly version: string;
  readonly choreId: string;
  readonly periodKey: string;
  readonly slot: number;
  readonly subject: string | null;
}

/**
 * Parses an occurrence key, or returns null if it isn't one.
 *
 * Splits from the right so that a chore id containing a colon can't corrupt
 * the parse — ids are UUIDs today, but the key format shouldn't depend on that.
 */
export function parseOccurrenceKey(key: string): ParsedOccurrenceKey | null {
  const parts = key.split(':');
  if (parts.length < 5) return null;

  const version = parts[0];
  const subjectRaw = parts[parts.length - 1];
  const slotRaw = parts[parts.length - 2];
  const periodKey = parts[parts.length - 3];
  const choreId = parts.slice(1, parts.length - 3).join(':');

  if (version === undefined || subjectRaw === undefined || slotRaw === undefined) return null;
  if (periodKey === undefined || choreId === '') return null;

  const slot = Number(slotRaw);
  if (!Number.isInteger(slot) || slot < 0) return null;

  return {
    version,
    choreId,
    periodKey,
    slot,
    subject: subjectRaw === '-' ? null : subjectRaw,
  };
}
