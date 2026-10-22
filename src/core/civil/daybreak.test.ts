import { civilDate } from './date';
import {
  DAY_START_DEFAULT,
  DAY_START_MAX,
  DAY_START_MIN,
  dayOfWallClock,
  describeDayStart,
  safeDayStart,
  wallDateFor,
} from './daybreak';
import type { CivilDate, CivilTime } from './types';

const d = (s: string): CivilDate => civilDate(s);
const t = (s: string): CivilTime => s as CivilTime;

const MON = d('2026-10-05');
const TUE = d('2026-10-06');

describe('which day a wall-clock moment belongs to', () => {
  it('puts the small hours on the night before', () => {
    // Jake: "if it's 3am or earlier on Tuesday it should [count] as Monday".
    expect(dayOfWallClock(TUE, t('00:40'), 3)).toBe(MON);
    expect(dayOfWallClock(TUE, t('02:59'), 3)).toBe(MON);
  });

  it('starts the new day on the hour itself', () => {
    // The half-open window `[D 03:00, D+1 03:00)` — the only version where every
    // instant belongs to exactly one day.
    expect(dayOfWallClock(TUE, t('03:00'), 3)).toBe(TUE);
  });

  it('leaves the rest of the day alone', () => {
    expect(dayOfWallClock(TUE, t('03:01'), 3)).toBe(TUE);
    expect(dayOfWallClock(TUE, t('13:00'), 3)).toBe(TUE);
    expect(dayOfWallClock(TUE, t('23:59'), 3)).toBe(TUE);
  });

  it('is the ordinary calendar day at midnight', () => {
    // The escape hatch: a household that wants dates to mean dates.
    for (const time of ['00:00', '02:59', '12:00', '23:59']) {
      expect(dayOfWallClock(TUE, t(time), 0)).toBe(TUE);
    }
  });

  it('crosses a month boundary', () => {
    expect(dayOfWallClock(d('2026-11-01'), t('01:00'), 3)).toBe(d('2026-10-31'));
  });

  it('crosses a year boundary', () => {
    expect(dayOfWallClock(d('2027-01-01'), t('01:00'), 3)).toBe(d('2026-12-31'));
  });
});

describe('when a time-of-day actually happens', () => {
  it('moves a before-the-break reminder to the next morning', () => {
    /*
     * The inverse, and the one that was silently broken: a chore on Monday with
     * a 01:00 reminder fires on Tuesday *by the calendar*, because 01:00 Tuesday
     * is Monday night. Scheduled against Monday it was 23 hours early — and
     * therefore already past when the plan was made, so it never fired.
     */
    expect(wallDateFor(MON, t('01:00'), 3)).toBe(TUE);
    expect(wallDateFor(MON, t('02:59'), 3)).toBe(TUE);
  });

  it('leaves a reminder at or after the break where it is', () => {
    expect(wallDateFor(MON, t('03:00'), 3)).toBe(MON);
    expect(wallDateFor(MON, t('09:00'), 3)).toBe(MON);
    expect(wallDateFor(MON, t('23:30'), 3)).toBe(MON);
  });

  it('moves nothing at midnight', () => {
    expect(wallDateFor(MON, t('00:00'), 0)).toBe(MON);
  });

  it('round-trips with dayOfWallClock', () => {
    // The two have to agree, or a reminder fires on a day the app does not think
    // the chore belongs to.
    for (const hour of [0, 3, 6, 12]) {
      for (const time of ['00:00', '01:30', '02:59', '03:00', '11:59', '12:00', '23:59']) {
        const wall = wallDateFor(MON, t(time), hour);
        expect(dayOfWallClock(wall, t(time), hour)).toBe(MON);
      }
    }
  });
});

describe('an hour out of storage', () => {
  it('keeps anything in range', () => {
    for (let hour = DAY_START_MIN; hour <= DAY_START_MAX; hour += 1) {
      expect(safeDayStart(hour)).toBe(hour);
    }
  });

  it('falls back rather than shifting every date in the app', () => {
    // `undefined` arrives on every render before the household query lands.
    expect(safeDayStart(undefined)).toBe(DAY_START_DEFAULT);
    expect(safeDayStart(null)).toBe(DAY_START_DEFAULT);
    expect(safeDayStart(-1)).toBe(DAY_START_DEFAULT);
    expect(safeDayStart(13)).toBe(DAY_START_DEFAULT);
    expect(safeDayStart(2.5)).toBe(DAY_START_DEFAULT);
    expect(safeDayStart(Number.NaN)).toBe(DAY_START_DEFAULT);
  });

  it('is applied by the callers, not just available to them', () => {
    // An out-of-range hour must not shift a date even if it reaches these.
    expect(dayOfWallClock(TUE, t('01:00'), 99)).toBe(MON);
    expect(wallDateFor(MON, t('01:00'), 99)).toBe(TUE);
  });
});

describe('saying it in words', () => {
  it('names the two ends rather than counting them', () => {
    expect(describeDayStart(0)).toBe('midnight');
    expect(describeDayStart(12)).toBe('noon');
  });

  it('is an hour otherwise', () => {
    expect(describeDayStart(3)).toBe('3 AM');
    expect(describeDayStart(1)).toBe('1 AM');
    expect(describeDayStart(11)).toBe('11 AM');
  });
});
