import { isValidTimeZone, msUntilNextMidnight, todayIn } from './today';

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
