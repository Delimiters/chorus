/**
 * The recurrence rule union.
 *
 * Purpose-built rather than RFC 5545 / the `rrule` package. See
 * docs/decisions/ADR-0002 for the reasoning; in short, RRULE cannot express
 * "3× per week on any days" at all, and its `BYMONTHDAY=31` silently skips
 * short months with no way to opt into clamping — which is precisely the
 * behaviour that broke the previous implementation.
 *
 * Adding a variant is mechanical: add a member here, then add a case to
 * `expand`, `describe`, and `schema`. Each switch ends in `assertNever`, so the
 * compiler enumerates the work for you.
 */

import type { CivilDate, CivilTime, NthWeek, Weekday } from '../civil/types';

/**
 * What to do when a monthly rule targets a day the month doesn't have —
 * "the 31st" in February.
 *
 * `'clamp'` moves it to the last day of the month (Feb 28/29). Every month gets
 * exactly one occurrence, which is what a household almost always means.
 * `'skip'` omits that month entirely, matching iCalendar semantics.
 */
export type MonthOverflow = 'clamp' | 'skip';

export type RecurrenceRule =
  /** "Someday." Never scheduled, never expands, never appears on an agenda. */
  | { readonly kind: 'unscheduled' }
  /**
   * A one-time chore.
   *
   * `granularity` drives phrasing ("due Tuesday" vs "due this week") and how
   * long it stays actionable before reading as overdue. It does not affect when
   * the single occurrence lands, which is always `dueOn`.
   */
  | {
      readonly kind: 'once';
      readonly dueOn: CivilDate;
      readonly granularity: 'day' | 'week' | 'month';
    }
  /** "Daily" is `everyNDays: 1`; "every 3 days" is `everyNDays: 3`. */
  | { readonly kind: 'daily'; readonly everyNDays: number }
  /**
   * "Every Tuesday and Friday", "every other Monday".
   * `weekdays` must be non-empty, sorted ascending, and free of duplicates.
   */
  | { readonly kind: 'weekly'; readonly everyNWeeks: number; readonly weekdays: readonly Weekday[] }
  /** "3× per week, any days" — floating within the week. */
  | {
      readonly kind: 'weeklyFloating';
      readonly everyNWeeks: number;
      readonly timesPerPeriod: number;
    }
  /** "The 15th", "every other month on the 31st". */
  | {
      readonly kind: 'monthlyByDay';
      readonly everyNMonths: number;
      readonly dayOfMonth: number;
      readonly overflow: MonthOverflow;
    }
  /** "The 2nd Saturday", "the last Friday of every 3rd month". */
  | {
      readonly kind: 'monthlyByWeekday';
      readonly everyNMonths: number;
      readonly nth: NthWeek;
      readonly weekday: Weekday;
    }
  /** "Twice a month, any days" — floating within the month. */
  | {
      readonly kind: 'monthlyFloating';
      readonly everyNMonths: number;
      readonly timesPerPeriod: number;
    };

export type RecurrenceKind = RecurrenceRule['kind'];

/** Rules whose occurrences float within a period rather than landing on a date. */
export type FloatingKind = 'weeklyFloating' | 'monthlyFloating';

/**
 * A rule plus the anchor and bounds that position it in time.
 *
 * `startsOn` is load-bearing: it defines the phase of every "every N" rule and
 * the origin of `occurrenceIndex`, which is what drives rotation. Changing it
 * shifts the whole sequence.
 */
export interface Schedule {
  readonly rule: RecurrenceRule;
  readonly startsOn: CivilDate;
  /** Inclusive last date the rule may produce an occurrence, or null for forever. */
  readonly endsOn: CivilDate | null;
  /** Local reminder time; null means "use the household default". */
  readonly timeOfDay: CivilTime | null;
}

/**
 * A single scheduled instance of a chore.
 *
 * Occurrences are computed, never stored. Only completions and exceptions —
 * which reference an occurrence by `occurrenceKey` — are persisted.
 */
export interface Occurrence {
  readonly choreId: string;
  /**
   * Stable, deterministic, computable with no I/O:
   * `v1:{choreId}:{periodKey}:{slot}:{subject}`.
   *
   * Being client-computable is what makes optimistic completion safe, and the
   * `slot` component is what stops "3× per week" collapsing into one.
   */
  readonly occurrenceKey: string;
  /** 0-based position in the rule's infinite sequence, measured from `startsOn`. */
  readonly occurrenceIndex: number;
  /** The anchor date. Sole determinant of whether this falls in a window. */
  readonly dueOn: CivilDate;
  /** Canonical period: `'2026-07-28'`, `'2026-W31'`, or `'2026-07'`. */
  readonly periodKey: string;
  /** 0-based index within the period. Always 0 for non-floating rules. */
  readonly slot: number;
  /** Member id for `everyone` fan-out; null otherwise. */
  readonly subject: string | null;
  /** Earliest date this may be completed. Equals `dueOn` for anchored rules. */
  readonly flexibleFrom: CivilDate;
  /** Latest date this may be completed. Equals `dueOn` for anchored rules. */
  readonly flexibleUntil: CivilDate;
}

/** Guard: does this rule ever produce occurrences? */
export function isSchedulable(rule: RecurrenceRule): boolean {
  return rule.kind !== 'unscheduled';
}

/** Guard: do this rule's occurrences float within their period? */
export function isFloating(
  rule: RecurrenceRule,
): rule is Extract<RecurrenceRule, { kind: FloatingKind }> {
  return rule.kind === 'weeklyFloating' || rule.kind === 'monthlyFloating';
}
