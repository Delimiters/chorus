/**
 * Civil time primitives.
 *
 * A "civil" date is a date on a calendar with no timezone and no instant
 * attached — the thing a human means by "the 3rd of March". Due dates are civil
 * dates; the moment someone actually completed a chore is an instant. Conflating
 * the two is how the previous attempt at this app produced Feb-31 bugs and
 * Sunday-hardcoded weeks. See docs/RECURRENCE.md.
 */

/**
 * A calendar date as `'YYYY-MM-DD'`, in the household's local civil time.
 *
 * Branded so a raw string can't be passed where a validated date is expected.
 * Construct with {@link civilDate} or the arithmetic helpers in `./date`.
 */
export type CivilDate = string & { readonly __brand: 'CivilDate' };

/** A wall-clock time as `'HH:MM'` (24-hour), in the household's local time. */
export type CivilTime = string & { readonly __brand: 'CivilTime' };

/** Day of the week. 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which occurrence of a weekday within a month. -1 means "last". */
export type NthWeek = 1 | 2 | 3 | 4 | -1;

/** An inclusive range of civil dates. */
export interface DateWindow {
  readonly start: CivilDate;
  readonly end: CivilDate;
}

/**
 * Household-level calendar preferences.
 *
 * `weekStartsOn` is a setting rather than a constant precisely because the
 * previous implementation hardcoded Sunday.
 */
export interface CalendarConfig {
  readonly weekStartsOn: Weekday;
}

// Deliberately NOT here: the household's IANA timezone. It was threaded through
// the entire Date-free engine and read by nothing, which is an invitation to the
// exact bug the lint rules exist to prevent — someone eventually reaches for it
// and calls Intl. The timezone lives at the edge, in src/data/today.ts, whose
// only job is converting an instant into the CivilDate the engine receives.
