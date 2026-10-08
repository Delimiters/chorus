import { act, renderHook } from '@testing-library/react-native';

import {
  isValidTimeZone,
  msUntilNextDaybreak,
  timeIn,
  todayIn,
  useNowCivil,
  useToday,
} from './today';

/*
 * Midnight everywhere in the existing tests, deliberately.
 *
 * Every assertion below predates the household day break, so holding it at 0
 * makes them the "did the break change what today means" check: at midnight the
 * new code path has to be a no-op, and any date that moves is a regression. The
 * break's own behaviour is tested on its own terms at the bottom.
 */
const MIDNIGHT = 0;

/** A fixed instant: 2026-07-30T03:30:00Z. */
const AT = (iso: string) => new Date(iso);

describe('todayIn', () => {
  it('converts an instant to the civil date in that zone', () => {
    // 03:30 UTC is still the 29th in Denver (UTC-6) and already the 30th in Tokyo.
    const instant = AT('2026-07-30T03:30:00Z');
    expect(todayIn('UTC', instant, MIDNIGHT)).toBe('2026-07-30');
    expect(todayIn('America/Denver', instant, MIDNIGHT)).toBe('2026-07-29');
    expect(todayIn('Asia/Tokyo', instant, MIDNIGHT)).toBe('2026-07-30');
  });

  it('handles the extreme zones the CI matrix uses', () => {
    const instant = AT('2026-07-30T12:00:00Z');
    expect(todayIn('Pacific/Kiritimati', instant, MIDNIGHT)).toBe('2026-07-31'); // UTC+14
    expect(todayIn('Pacific/Niue', instant, MIDNIGHT)).toBe('2026-07-30'); // UTC-11
  });

  it('falls back to UTC for an invalid zone rather than throwing', () => {
    // households.time_zone is free text, and Intl throws on an unknown zone —
    // which would crash every render of Today instead of degrading.
    const instant = AT('2026-07-30T03:30:00Z');
    expect(todayIn('Not/AZone', instant, MIDNIGHT)).toBe('2026-07-30');
    expect(todayIn('', instant, MIDNIGHT)).toBe('2026-07-30');
  });

  it('returns a validated CivilDate', () => {
    // Would throw if the formatted string were not a real calendar date.
    expect(() => todayIn('America/Denver', AT('2026-02-28T23:59:59Z'), MIDNIGHT)).not.toThrow();
  });

  it('crosses midnight correctly in a negative-offset zone', () => {
    expect(todayIn('America/New_York', AT('2026-07-30T03:59:00Z'), MIDNIGHT)).toBe('2026-07-29');
    expect(todayIn('America/New_York', AT('2026-07-30T04:01:00Z'), MIDNIGHT)).toBe('2026-07-30');
  });
});

describe('isValidTimeZone', () => {
  it.each(['UTC', 'America/Denver', 'Asia/Tokyo', 'Pacific/Kiritimati'])('accepts %s', (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each(['', '   ', 'Not/AZone', 'Denver'])('rejects %s', (zone) => {
    expect(isValidTimeZone(zone)).toBe(false);
  });
});

describe('msUntilNextDaybreak', () => {
  it('is a whole day just after midnight and small just before', () => {
    const justAfter = msUntilNextDaybreak('UTC', AT('2026-07-30T00:00:30Z'), MIDNIGHT);
    const justBefore = msUntilNextDaybreak('UTC', AT('2026-07-30T23:59:30Z'), MIDNIGHT);
    expect(justAfter).toBeGreaterThan(23 * 3600 * 1000);
    expect(justBefore).toBeLessThan(60 * 1000);
  });

  it('accounts for the zone offset', () => {
    // 03:30 UTC is 21:30 the previous day in Denver, so ~2.5h to local midnight.
    const ms = msUntilNextDaybreak('America/Denver', AT('2026-07-30T03:30:00Z'), MIDNIGHT);
    expect(ms).toBeGreaterThan(2 * 3600 * 1000);
    expect(ms).toBeLessThan(3 * 3600 * 1000);
  });
});

/*
 * `timeIn` is the clock the routine badge reads, and it shipped with no test:
 * the only consumer mocks `useNowTime` away, so neither the `% 24` branch nor
 * the format itself was ever executed by the suite.
 */
describe('timeIn', () => {
  const at = (iso: string) => new Date(iso);

  it('formats as HH:MM, which is the CivilTime shape', () => {
    expect(timeIn('UTC', at('2026-10-01T09:05:00Z'))).toBe('09:05');
  });

  /*
   * The documented quirk: `en-GB` renders midnight as `24` in *some* runtimes,
   * and `24:00` is not a time the engine's parser accepts.
   *
   * Honest about what this proves. Node's ICU here already renders `00`, so
   * deleting the `% 24` guard leaves this green — it pins the result, not the
   * branch. The guard is for Hermes on the phone, which this suite cannot
   * reach, and it stays for that reason rather than because a test demands it.
   */
  it('renders midnight as 00:00, not 24:00', () => {
    expect(timeIn('UTC', at('2026-10-01T00:00:00Z'))).toBe('00:00');
  });

  it('pads a single-digit hour', () => {
    expect(timeIn('UTC', at('2026-10-01T07:00:00Z'))).toBe('07:00');
  });

  it('reads the household’s zone, not the machine’s', () => {
    const instant = at('2026-10-01T12:00:00Z');
    expect(timeIn('America/New_York', instant)).toBe('08:00');
    expect(timeIn('Asia/Tokyo', instant)).toBe('21:00');
  });

  /*
   * Half- and three-quarter-hour offsets, because an implementation that
   * assumed whole hours would pass every test above.
   */
  it('handles zones that are not a whole number of hours out', () => {
    const instant = at('2026-10-01T12:00:00Z');
    expect(timeIn('Asia/Kolkata', instant)).toBe('17:30');
    expect(timeIn('Asia/Kathmandu', instant)).toBe('17:45');
  });

  it('falls back to UTC for a zone that does not exist', () => {
    const instant = at('2026-10-01T12:00:00Z');
    expect(timeIn('Mars/Olympus_Mons', instant)).toBe(timeIn('UTC', instant));
  });

  /*
   * A meta-test over the whole day in several zones. The format is what every
   * caller relies on, and one bad hour is enough to make the badge read zero
   * for an hour a day — which nobody would report as a bug.
   */
  it('produces a valid time at every hour, in every zone tried', () => {
    const zones = [
      'UTC',
      'Europe/London',
      'America/New_York',
      'Asia/Kolkata',
      'Pacific/Chatham',
      'Australia/Lord_Howe',
      'Pacific/Kiritimati',
    ];
    for (const zone of zones) {
      for (let hour = 0; hour < 24; hour += 1) {
        const stamp = `2026-10-01T${String(hour).padStart(2, '0')}:30:00Z`;
        expect(timeIn(zone, at(stamp))).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      }
    }
  });
});

describe('the household day break, where the clock meets it', () => {
  /*
   * Jake: *"Can we make it so the day ends at like 3am? ... just so if I'm doing
   * something late at night it doesn't count as the next day"*, and then, to be
   * sure: *"time before 3am means the PREVIOUS wall clock date"*.
   *
   * `todayIn` is the only place in the app where a real clock meets a timezone,
   * so it is the only place the break can be applied — and these pin it against
   * a real `Intl` conversion rather than against the pure helper, which is
   * tested separately. A zone is chosen for each case so the *local* wall clock
   * is the interesting part.
   */
  it('counts the small hours as the night before', () => {
    // 07:00 UTC is 01:00 in Denver (UTC-6) — so still the previous day.
    expect(todayIn('America/Denver', AT('2026-07-30T07:00:00Z'), 3)).toBe('2026-07-29');
  });

  it('turns the day over at the break, not at midnight', () => {
    // 08:59 UTC is 02:59 in Denver; 09:01 is 03:01.
    expect(todayIn('America/Denver', AT('2026-07-30T08:59:00Z'), 3)).toBe('2026-07-29');
    expect(todayIn('America/Denver', AT('2026-07-30T09:01:00Z'), 3)).toBe('2026-07-30');
  });

  it('leaves the rest of the day exactly where midnight would', () => {
    // The break must not shift anything outside its own window.
    for (const iso of ['2026-07-30T18:00:00Z', '2026-07-31T05:59:00Z']) {
      expect(todayIn('America/Denver', AT(iso), 3)).toBe(
        todayIn('America/Denver', AT(iso), MIDNIGHT),
      );
    }
  });

  it('is the ordinary calendar day at midnight', () => {
    // The escape hatch, and the behaviour every other test in this file assumes.
    expect(todayIn('America/Denver', AT('2026-07-30T07:00:00Z'), MIDNIGHT)).toBe('2026-07-30');
  });

  it('degrades to the default rather than shifting every date', () => {
    // An out-of-range hour from storage must not be able to move the date to
    // somewhere no setting could have produced.
    expect(todayIn('UTC', AT('2026-07-30T01:00:00Z'), 99)).toBe('2026-07-29');
    expect(todayIn('UTC', AT('2026-07-30T04:00:00Z'), 99)).toBe('2026-07-30');
  });

  it('crosses a month boundary with the break', () => {
    expect(todayIn('UTC', AT('2026-08-01T01:00:00Z'), 3)).toBe('2026-07-31');
  });
});

describe('when the agenda should turn over', () => {
  it('waits for the break rather than for midnight', () => {
    /*
     * A midnight timer under a 3 AM day refreshes three hours early, recomputes
     * the same date it already had, and then has no timer left — so a phone left
     * open overnight sits on the old day until something else re-renders. That
     * is precisely the bug `useToday`'s timer exists to prevent.
     */
    const at0030 = msUntilNextDaybreak('UTC', AT('2026-07-30T00:30:00Z'), 3);
    expect(at0030).toBeGreaterThan(2 * 3600 * 1000 - 1000);
    expect(at0030).toBeLessThan(2.6 * 3600 * 1000);
  });

  it('waits almost a whole day just after the break', () => {
    const at0301 = msUntilNextDaybreak('UTC', AT('2026-07-30T03:01:00Z'), 3);
    expect(at0301).toBeGreaterThan(23 * 3600 * 1000);
    expect(at0301).toBeLessThanOrEqual(24 * 3600 * 1000);
  });
});

describe('the overnight timer, when it fires without the date moving', () => {
  /*
   * `msUntilNextDaybreak` is a *wall-clock* delta and `setTimeout` counts real
   * milliseconds, so on a DST fall-back night the timer fires an hour before the
   * break — on a wall clock that has not reached it. `today` recomputes to the
   * same value it already had.
   *
   * Keyed on `today`, the effect did not re-run, so nothing armed the next
   * timer and the agenda stalled on yesterday until the app was backgrounded.
   * This is the regression test for arming unconditionally; it does not need a
   * real DST transition to express it, only a tick that leaves the date alone.
   */
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('arms another timer', () => {
    /*
     * The real fall-back night, because nothing else produces this: at 01:00
     * MDT the break is two wall-clock hours away, but two *real* hours later it
     * is 02:00 MST — the clock went back, the break has not arrived, and the
     * date is unchanged.
     */
    jest.setSystemTime(new Date('2027-11-07T07:00:00Z')); // 01:00 MDT
    const { result } = renderHook(() => useToday('America/Denver', 3));
    expect(result.current).toBe('2027-11-06');
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    // Still the 6th — the timer fired early, as it does on this one night.
    expect(result.current).toBe('2027-11-06');
    // And the next one is armed anyway, which is the whole fix. Keyed on
    // `today` this was zero, and the agenda stalled until the app was
    // backgrounded.
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  it('still turns the day over when the break is reached', () => {
    // The re-arm must not cost the thing the timer is for.
    jest.setSystemTime(new Date('2026-07-30T02:59:00Z'));
    const { result } = renderHook(() => useToday('UTC', 3));
    expect(result.current).toBe('2026-07-29');

    act(() => {
      jest.setSystemTime(new Date('2026-07-30T03:01:00Z'));
      jest.runOnlyPendingTimers();
    });

    expect(result.current).toBe('2026-07-30');
  });
});

describe('reading the day and the time from one instant', () => {
  /*
   * `useToday` and `useNowTime` are on deliberately different cadences, and the
   * routines badge compared them: the day turned over exactly at the break while
   * the minute poll could still report 02:59 — the largest "minutes into the
   * day" value there is — so for up to a minute every item of the brand-new day
   * counted as already owed.
   */
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('cannot report a time from one day and a date from the next', () => {
    jest.setSystemTime(new Date('2026-07-30T02:59:30Z'));
    const { result } = renderHook(() => useNowCivil('UTC', 3));

    // Before the break: the previous day, and a time near the end of it.
    expect(result.current.day).toBe('2026-07-29');
    expect(result.current.time).toBe('02:59');

    act(() => {
      jest.setSystemTime(new Date('2026-07-30T03:00:30Z'));
      jest.advanceTimersByTime(60_000);
    });

    /*
     * After it: both move together, which is the only property that matters.
     * Compared against the same instant rather than a literal, because
     * advancing the fake timers moves the clock as well as firing the poll.
     */
    const instant = new Date();
    expect(result.current.day).toBe(todayIn('UTC', instant, 3));
    expect(result.current.time).toBe(timeIn('UTC', instant));
    expect(result.current.day).toBe('2026-07-30');
  });

  it('agrees with useToday for the same instant', () => {
    // Same answer, different cadence — not a second opinion about the date.
    jest.setSystemTime(new Date('2026-07-30T01:00:00Z'));
    const both = renderHook(() => useNowCivil('UTC', 3));
    const date = renderHook(() => useToday('UTC', 3));

    expect(both.result.current.day).toBe(date.result.current);
  });
});
