import fc from 'fast-check';

import { formatCivilTime, isCivilTime, parseCivilTime } from './time';
import type { CivilTime } from './types';

const t = (value: string): CivilTime => value as CivilTime;

describe('isCivilTime', () => {
  it('accepts a zero-padded 24-hour time', () => {
    for (const value of ['00:00', '09:05', '13:30', '23:59']) {
      expect(isCivilTime(value)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    // '7:05' is rejected deliberately: the *stored* form is always padded, so
    // accepting the short form here would let two spellings of one time into
    // the database and make string comparison wrong.
    for (const value of ['7:05', '24:00', '23:60', '', 'noon', '1930', null, 19, {}]) {
      expect(isCivilTime(value)).toBe(false);
    }
  });
});

describe('parseCivilTime', () => {
  it('reads a bare hour as o’clock', () => {
    expect(parseCivilTime('7')).toBe('07:00');
    expect(parseCivilTime('19')).toBe('19:00');
    expect(parseCivilTime('0')).toBe('00:00');
  });

  it('reads hours and minutes', () => {
    expect(parseCivilTime('7:05')).toBe('07:05');
    expect(parseCivilTime('19:45')).toBe('19:45');
    expect(parseCivilTime('7.05')).toBe('07:05');
  });

  it('reads a single-digit minute as tens, not units', () => {
    // "7:5" means five past seven to nobody. It means half past.
    expect(parseCivilTime('7:5')).toBe('07:50');
  });

  it('reads am and pm, in any casing or spacing', () => {
    expect(parseCivilTime('7pm')).toBe('19:00');
    expect(parseCivilTime('7 PM')).toBe('19:00');
    expect(parseCivilTime('7:05 pm')).toBe('19:05');
    expect(parseCivilTime('7am')).toBe('07:00');
  });

  it('handles the two hours everybody gets wrong', () => {
    expect(parseCivilTime('12am')).toBe('00:00');
    expect(parseCivilTime('12pm')).toBe('12:00');
    expect(parseCivilTime('12:30am')).toBe('00:30');
    expect(parseCivilTime('12:30pm')).toBe('12:30');
  });

  it('refuses nonsense rather than guessing at it', () => {
    // 13pm is a typo. Reading it as 13:00 would store a time the person did
    // not ask for and would never think to check.
    for (const value of ['13pm', '0pm', '25', '7:60', '', '   ', 'seven', '7:05:09', '-7']) {
      expect(parseCivilTime(value)).toBeNull();
    }
  });

  it('always returns something isCivilTime accepts', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const parsed = parseCivilTime(input);
        if (parsed !== null) expect(isCivilTime(parsed)).toBe(true);
      }),
    );
  });

  it('round-trips every valid time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (hours, minutes) => {
          const canonical = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          expect(parseCivilTime(canonical)).toBe(canonical);
        },
      ),
    );
  });
});

describe('formatCivilTime', () => {
  it('says the hour plainly when there are no minutes', () => {
    expect(formatCivilTime(t('19:00'))).toBe('7 pm');
    expect(formatCivilTime(t('07:00'))).toBe('7 am');
  });

  it('includes minutes when there are some', () => {
    expect(formatCivilTime(t('19:05'))).toBe('7:05 pm');
    expect(formatCivilTime(t('09:30'))).toBe('9:30 am');
  });

  it('says 12 rather than 0 at both ends of the day', () => {
    expect(formatCivilTime(t('00:00'))).toBe('12 am');
    expect(formatCivilTime(t('12:00'))).toBe('12 pm');
    expect(formatCivilTime(t('00:30'))).toBe('12:30 am');
  });

  it('survives a round trip through parsing, for every minute of the day', () => {
    // The pair has to be consistent: a time shown to somebody and typed back
    // in must be the same time. 1440 cases is cheap and exhaustive.
    for (let hours = 0; hours < 24; hours += 1) {
      for (let minutes = 0; minutes < 60; minutes += 1) {
        const canonical = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        expect(parseCivilTime(formatCivilTime(t(canonical)))).toBe(canonical);
      }
    }
  });
});
