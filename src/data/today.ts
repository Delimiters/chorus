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
import type { CivilDate } from '@/core/civil/types';

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
export function todayIn(timeZone: string, now: Date): CivilDate {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return civilDate(formatted);
}

/**
 * Milliseconds until the next midnight in `timeZone`.
 *
 * Computed by asking for the local wall-clock time rather than by assuming a
 * fixed offset, so a DST transition on the boundary night does not skew it. The
 * result is clamped to at least a second so a rounding error can't spin a timer.
 */
export function msUntilNextMidnight(timeZone: string, now: Date): number {
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
  const remaining = 24 * 3600 * 1000 - elapsed;
  return Math.max(1000, remaining);
}

/**
 * The current civil date in the household's timezone, kept fresh.
 *
 * Re-derives on foreground and at local midnight. Returns a `CivilDate` suitable
 * for passing straight into the engine.
 */
export function useToday(timeZone: string): CivilDate {
  const [now, setNow] = useState(() => new Date());
  const today = useMemo(() => todayIn(timeZone, now), [timeZone, now]);

  useEffect(() => {
    const refresh = (): void => setNow(new Date());

    // A backgrounded app's timers are unreliable, so foregrounding also refreshes.
    const onAppState = (state: AppStateStatus): void => {
      if (state === 'active') refresh();
    };
    const subscription = AppState.addEventListener('change', onAppState);

    // One timer per day rather than a poll. Re-armed by this effect re-running
    // when `today` changes.
    const timer = setTimeout(refresh, msUntilNextMidnight(timeZone, new Date()));

    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
  }, [timeZone, today]);

  return today;
}
