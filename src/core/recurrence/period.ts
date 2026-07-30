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

import { partsOf, startOfWeek } from '../civil/date';
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
 * `'W:2026-08-02'` — the period key for week-floating rules, naming the week by
 * its start date.
 *
 * An earlier version used a week ordinal (`'2026-W31'`), which had two problems.
 * The ordinal was computed from the household's `weekStartsOn` but did not encode
 * it, so changing that preference produced the *same key for a different week* —
 * a completion silently reattached to the wrong week, which is worse than
 * orphaning because nothing is visibly wrong. It also mislabelled year
 * boundaries: the first week of 2027 came out as `2026-W53`.
 *
 * A start date is unambiguous. If `weekStartsOn` ever changes, the key changes
 * too, so a stale completion visibly detaches instead of quietly moving.
 */
export function weekPeriodKey(date: CivilDate, weekStartsOn: Weekday): string {
  return `W:${startOfWeek(date, weekStartsOn)}`;
}

/** `'M:2026-07'` — the period key for month-floating rules. */
export function monthPeriodKey(date: CivilDate): string {
  const { year, month } = partsOf(date);
  return `M:${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
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
