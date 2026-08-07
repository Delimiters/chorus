/**
 * Civil times: `'HH:MM'`, 24-hour, zero-padded.
 *
 * The same reasoning as `CivilDate`. A reminder at "7pm" is a fact about the
 * clock on the wall, not an instant — it does not shift when the household
 * crosses a timezone or the phone changes region, and turning it into a `Date`
 * to parse it would reintroduce exactly the class of bug the civil types exist
 * to prevent. So this is integer arithmetic on a string, with no `Date`
 * anywhere.
 *
 * Parsing is deliberately forgiving on input and strict on output. Somebody
 * typing a reminder time will write "7", "7:05", "7pm", "19:05" or "7:05 PM",
 * and all of those have one obvious meaning; what gets stored is always
 * `'HH:MM'`.
 */

import type { CivilTime } from './types';

/** `'19:05'` → true. Rejects `'24:00'`, `'7:60'`, `'7:5'`. */
export function isCivilTime(value: unknown): value is CivilTime {
  if (typeof value !== 'string') return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/**
 * Reads what somebody typed, or null if it cannot be understood.
 *
 * Accepts, case- and space-insensitively:
 *
 * - `7`, `19` — a bare hour
 * - `7:05`, `19:05`, `7.05` — hour and minute
 * - `7pm`, `7:05 pm`, `7:05PM` — 12-hour with a suffix
 *
 * Returns null rather than guessing when the input is ambiguous or out of
 * range, so the caller can say "that is not a time" instead of storing
 * something surprising. `13pm` is nonsense and is rejected rather than
 * silently read as `13:00`.
 */
export function parseCivilTime(input: string): CivilTime | null {
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, '');
  if (cleaned.length === 0) return null;

  const match = /^(\d{1,2})(?:[:.](\d{1,2}))?(am|pm)?$/.exec(cleaned);
  if (match === null) return null;

  const rawHours = Number(match[1]);
  // A bare hour means o'clock. `7:5` means five past, not fifty.
  const minutes = match[2] === undefined ? 0 : Number(match[2].padEnd(2, '0'));
  const suffix = match[3];

  if (minutes > 59) return null;

  let hours = rawHours;
  if (suffix !== undefined) {
    // With am/pm the hour must be one people actually say. 0pm and 13pm are
    // typing mistakes, and guessing at them is worse than refusing.
    if (rawHours < 1 || rawHours > 12) return null;
    if (suffix === 'pm') hours = rawHours === 12 ? 12 : rawHours + 12;
    else hours = rawHours === 12 ? 0 : rawHours;
  }

  if (hours > 23) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` as CivilTime;
}

/**
 * For display: `'19:05'` → `'7:05 pm'`.
 *
 * Twelve-hour because that is how the household says it, and the app is not
 * trying to look like a train timetable. Minutes are dropped on the hour —
 * "7 pm", not "7:00 pm".
 */
export function formatCivilTime(time: CivilTime): string {
  const [rawHours, rawMinutes] = time.split(':');
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);

  const suffix = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;

  return minutes === 0
    ? `${twelve} ${suffix}`
    : `${twelve}:${String(minutes).padStart(2, '0')} ${suffix}`;
}
