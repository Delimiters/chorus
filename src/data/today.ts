/**
 * "Today", in the household's timezone.
 *
 * This is the single place in the app where a real clock meets a timezone. The
 * engine never reads a clock — it takes `today` as a parameter — which is what
 * makes it deterministic and testable under any timezone. That property only
 * holds if this stays the only source.
 *
 * Two things beyond the obvious conversion:
 *
 * 1. **It has to be re-evaluated.** Computing `today` once at mount freezes it
 *    for the app's lifetime, so a phone left on the Today screen overnight keeps
 *    showing yesterday's agenda — with everything due today still filed under
 *    "upcoming". `useToday` re-derives when the app is foregrounded and on a
 *    timer set to the next local midnight.
 *
 * 2. **The timezone is untrusted.** `households.time_zone` is a free-text column,
 *    and `Intl.DateTimeFormat` throws on an unrecognised zone — which would
 *    crash on every render rather than degrade. So it is validated, with a
 *    fallback.
 */

import { useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { civilDate } from '@/core/civil/date';
import { dayOfWallClock, safeDayStart } from '@/core/civil/daybreak';
import type { CivilDate, CivilTime } from '@/core/civil/types';

/** True if the runtime recognises this IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The civil date it currently is in `timeZone`.
 *
 * `en-CA` is used because it formats as `YYYY-MM-DD`, which is exactly the
 * `CivilDate` shape — no manual assembly, no month/day ordering to get wrong.
 *
 * @param now the instant to convert; injected so this is testable
 */
export function todayIn(timeZone: string, now: Date, dayStartsAtHour: number): CivilDate {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  /*
   * The household's day break, applied here and nowhere else.
   *
   * `dayStartsAtHour` is required rather than defaulted on purpose: this
   * function's answer *is* "today" for the whole app, and a default would let a
   * call site keep midnight silently. The same number lived in five places the
   * last time a cap moved, and the ones that went stale were the optional ones.
   */
  return dayOfWallClock(civilDate(formatted), timeIn(zone, now), dayStartsAtHour);
}

/**
 * The wall-clock time it currently is in `timeZone`, as a `CivilTime`.
 *
 * Same trick as `todayIn`, and the same reason: `en-GB` with `hour12: false`
 * formats as `HH:MM`, which is exactly the `CivilTime` shape, so there is no
 * manual assembly and no am/pm to get wrong.
 *
 * `% 24` on the hour because some runtimes render midnight as `24:00` under
 * `en-GB`, which would be rejected by the engine's own time parser.
 *
 * @param now the instant to convert; injected so this is testable
 */
export function timeIn(timeZone: string, now: Date): CivilTime {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = String(Number(get('hour')) % 24).padStart(2, '0');
  return `${hour}:${get('minute')}` as CivilTime;
}

/**
 * The current civil time in the household's timezone, to the minute.
 *
 * Separate from `useToday` because it ticks on a completely different cadence:
 * the date changes once a day and can be driven by a single timer, while the
 * time changes constantly and has to be polled.
 *
 * Polled at a minute, and **only call this from a leaf**. Anything that
 * re-renders on this tick re-renders once a minute for as long as the screen is
 * open; the one caller is the small component that draws the routine badge, and
 * putting it in `PlanScreen` instead would redraw the whole of Today sixty
 * times an hour for a number that changes four times a day.
 */
export function useNowTime(timeZone: string): CivilTime {
  const [now, setNow] = useState(() => new Date());
  const time = useMemo(() => timeIn(timeZone, now), [timeZone, now]);

  useEffect(() => {
    const refresh = (): void => setNow(new Date());

    // A backgrounded app's timers are unreliable, so foregrounding refreshes
    // too — the same reasoning `useToday` gives for the date.
    const onAppState = (state: AppStateStatus): void => {
      if (state === 'active') refresh();
    };
    const subscription = AppState.addEventListener('change', onAppState);
    const timer = setInterval(refresh, 60_000);

    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);

  return time;
}

/**
 * Milliseconds until the next day break in `timeZone`.
 *
 * Computed from local wall-clock parts rather than from a fixed offset, so the
 * zone's *offset* cannot skew it.
 *
 * It is a **wall-clock** delta, and `setTimeout` counts real milliseconds, so on
 * a DST transition night the two differ by an hour: the comment here used to
 * claim a transition "does not skew it", which was false. Reading local parts
 * removes the offset error, not the transition error. Spring forward and the
 * timer fires an hour after the break; fall back and it fires an hour before —
 * landing on a wall clock that has not reached the break yet.
 *
 * That is survivable only because the caller re-arms unconditionally; see
 * `useToday`. Correcting the duration itself would mean searching for the
 * instant whose local time is the break, which is a different and much larger
 * piece of machinery for a once-a-year hour.
 */
export function msUntilNextDaybreak(timeZone: string, now: Date, dayStartsAtHour: number): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');

  // `en-GB` renders midnight as 24 rather than 00 in some runtimes.
  const hour = get('hour') % 24;
  const elapsed = (hour * 3600 + get('minute') * 60 + get('second')) * 1000;
  /*
   * Until the *break*, not until midnight.
   *
   * With a 3 AM day the agenda has to turn over at 3 AM. A midnight timer would
   * refresh three hours early and compute the same date it already had — so a
   * phone left open overnight sat on the old day until something else happened
   * to re-render, which is the bug `useToday`'s timer exists to prevent.
   */
  const breakMs = safeDayStart(dayStartsAtHour) * 3600 * 1000;
  const dayMs = 24 * 3600 * 1000;
  const remaining = elapsed < breakMs ? breakMs - elapsed : dayMs + breakMs - elapsed;
  /*
   * A belt, and deliberately not a tested one.
   *
   * `remaining` is provably at least a second for every input the types allow,
   * so the clamp cannot fire — a review proved it by deleting it and watching
   * the whole suite stay green. Three tests used to point at this line and
   * assert arithmetic that cannot be violated; they were removed rather than
   * left reading like evidence. The clamp stays because the formatter is an
   * external dependency and a timer of zero spins a phone.
   */
  return Math.max(1000, remaining);
}

/**
 * The current civil date in the household's timezone, kept fresh.
 *
 * Re-derives on foreground and at the household's day break. Returns a
 * `CivilDate` suitable for passing straight into the engine.
 */
export function useToday(timeZone: string, dayStartsAtHour: number): CivilDate {
  const [now, setNow] = useState(() => new Date());
  const today = useMemo(
    () => todayIn(timeZone, now, dayStartsAtHour),
    [timeZone, now, dayStartsAtHour],
  );

  useEffect(() => {
    const refresh = (): void => setNow(new Date());

    // A backgrounded app's timers are unreliable, so foregrounding also refreshes.
    const onAppState = (state: AppStateStatus): void => {
      if (state === 'active') refresh();
    };
    const subscription = AppState.addEventListener('change', onAppState);

    /*
     * One timer per day rather than a poll, re-armed on **every** refresh.
     *
     * The dependency is `now`, not `today`, and that is the whole point: a
     * timer that fires without the date having changed must still arm the next
     * one. Keyed on `today` it did not, because `refresh()` would set a new
     * `now`, `today` would recompute to the same value, and the effect would not
     * re-run — leaving nothing scheduled.
     *
     * Unreachable in ordinary time, and reachable twice a year: this is a
     * wall-clock duration handed to a real-time timer, so on a fall-back night
     * it fires an hour before the break, on a wall clock that has not got there
     * yet. On 7 November a phone left on Today would have sat on the 6th until
     * somebody backgrounded the app. Re-arming always costs one extra timer on
     * two nights a year and removes the stall entirely.
     */
    const timer = setTimeout(refresh, msUntilNextDaybreak(timeZone, now, dayStartsAtHour));

    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
  }, [timeZone, now, dayStartsAtHour]);

  return today;
}
