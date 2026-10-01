import { isValidTimeZone, msUntilNextMidnight, timeIn, todayIn } from './today';

/** A fixed instant: 2026-07-30T03:30:00Z. */
const AT = (iso: string) => new Date(iso);

describe('todayIn', () => {
  it('converts an instant to the civil date in that zone', () => {
    // 03:30 UTC is still the 29th in Denver (UTC-6) and already the 30th in Tokyo.
    const instant = AT('2026-07-30T03:30:00Z');
    expect(todayIn('UTC', instant)).toBe('2026-07-30');
    expect(todayIn('America/Denver', instant)).toBe('2026-07-29');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-07-30');
  });

  it('handles the extreme zones the CI matrix uses', () => {
    const instant = AT('2026-07-30T12:00:00Z');
    expect(todayIn('Pacific/Kiritimati', instant)).toBe('2026-07-31'); // UTC+14
    expect(todayIn('Pacific/Niue', instant)).toBe('2026-07-30'); // UTC-11
  });

  it('falls back to UTC for an invalid zone rather than throwing', () => {
    // households.time_zone is free text, and Intl throws on an unknown zone —
    // which would crash every render of Today instead of degrading.
    const instant = AT('2026-07-30T03:30:00Z');
    expect(todayIn('Not/AZone', instant)).toBe('2026-07-30');
    expect(todayIn('', instant)).toBe('2026-07-30');
  });

  it('returns a validated CivilDate', () => {
    // Would throw if the formatted string were not a real calendar date.
    expect(() => todayIn('America/Denver', AT('2026-02-28T23:59:59Z'))).not.toThrow();
  });

  it('crosses midnight correctly in a negative-offset zone', () => {
    expect(todayIn('America/New_York', AT('2026-07-30T03:59:00Z'))).toBe('2026-07-29');
    expect(todayIn('America/New_York', AT('2026-07-30T04:01:00Z'))).toBe('2026-07-30');
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

describe('msUntilNextMidnight', () => {
  it('is a whole day just after midnight and small just before', () => {
    const justAfter = msUntilNextMidnight('UTC', AT('2026-07-30T00:00:30Z'));
    const justBefore = msUntilNextMidnight('UTC', AT('2026-07-30T23:59:30Z'));
    expect(justAfter).toBeGreaterThan(23 * 3600 * 1000);
    expect(justBefore).toBeLessThan(60 * 1000);
  });

  it('accounts for the zone offset', () => {
    // 03:30 UTC is 21:30 the previous day in Denver, so ~2.5h to local midnight.
    const ms = msUntilNextMidnight('America/Denver', AT('2026-07-30T03:30:00Z'));
    expect(ms).toBeGreaterThan(2 * 3600 * 1000);
    expect(ms).toBeLessThan(3 * 3600 * 1000);
  });

  it('never returns zero or negative, so a timer cannot spin', () => {
    for (const iso of [
      '2026-07-30T00:00:00Z',
      '2026-07-30T23:59:59Z',
      '2026-03-08T09:00:00Z', // US DST spring-forward day
      '2026-11-01T08:00:00Z', // US DST fall-back day
    ]) {
      for (const zone of ['UTC', 'America/Denver', 'Pacific/Kiritimati', 'Pacific/Niue']) {
        expect(msUntilNextMidnight(zone, AT(iso))).toBeGreaterThanOrEqual(1000);
      }
    }
  });

  it('stays within a day even across a DST transition', () => {
    const ms = msUntilNextMidnight('America/New_York', AT('2026-03-08T05:30:00Z'));
    expect(ms).toBeLessThanOrEqual(24 * 3600 * 1000);
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
