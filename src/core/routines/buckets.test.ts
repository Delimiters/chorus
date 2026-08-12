import fc from 'fast-check';

import type { CivilTime } from '../civil/types';
import {
  BUCKETS,
  bucketOf,
  bucketRange,
  bucketStart,
  describeBucket,
  isTimeBucket,
  minutesFromDayStart,
  type TimeBucket,
} from './buckets';

const t = (value: string): CivilTime => value as CivilTime;

/** Every minute of the day, as a CivilTime. */
const everyMinute: CivilTime[] = [];
for (let h = 0; h < 24; h += 1) {
  for (let m = 0; m < 60; m += 1) {
    everyMinute.push(t(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`));
  }
}

const arbTime = fc.constantFrom(...everyMinute);

describe('bucketOf', () => {
  it('files the obvious times where a person would expect', () => {
    expect(bucketOf(t('07:00'))).toBe('morning');
    expect(bucketOf(t('13:30'))).toBe('afternoon');
    expect(bucketOf(t('18:00'))).toBe('evening');
    expect(bucketOf(t('22:30'))).toBe('night');
  });

  it('puts the small hours in night, not morning', () => {
    // The case the whole day-start offset exists for: 00:30 is the tail of
    // last night, not the head of this morning.
    expect(bucketOf(t('00:30'))).toBe('night');
    expect(bucketOf(t('03:00'))).toBe('night');
    expect(bucketOf(t('04:59'))).toBe('night');
  });

  describe('boundaries', () => {
    // Every edge, both sides. Off-by-one at a boundary is the defect this
    // module is most likely to have, and it would be invisible except to
    // somebody whose routine sits exactly at 17:00.
    it.each([
      ['04:59', 'night'],
      ['05:00', 'morning'],
      ['11:59', 'morning'],
      ['12:00', 'afternoon'],
      ['16:59', 'afternoon'],
      ['17:00', 'evening'],
      ['20:59', 'evening'],
      ['21:00', 'night'],
    ])('%s is %s', (time, bucket) => {
      expect(bucketOf(t(time))).toBe(bucket);
    });
  });

  it('agrees with bucketStart for all four', () => {
    for (const bucket of BUCKETS) {
      expect(bucketOf(bucketStart(bucket))).toBe(bucket);
    }
  });

  it('returns one of the four for every minute of the day', () => {
    fc.assert(
      fc.property(arbTime, (time) => {
        expect(BUCKETS).toContain(bucketOf(time));
      }),
    );
  });
});

describe('minutesFromDayStart', () => {
  it('makes 05:00 the start of the day', () => {
    expect(minutesFromDayStart(t('05:00'))).toBe(0);
    expect(minutesFromDayStart(t('05:01'))).toBe(1);
  });

  it('puts the small hours at the end, not the beginning', () => {
    // The bug this prevents: sorting raw strings puts 00:30 above 21:00, so a
    // Night section reads backwards.
    expect(minutesFromDayStart(t('21:00'))).toBeLessThan(minutesFromDayStart(t('00:30')));
    expect(minutesFromDayStart(t('23:59'))).toBeLessThan(minutesFromDayStart(t('00:00')));
    expect(minutesFromDayStart(t('04:59'))).toBe(24 * 60 - 1);
  });

  it('is a bijection onto 0..1439', () => {
    const seen = new Set(everyMinute.map(minutesFromDayStart));
    expect(seen.size).toBe(24 * 60);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(24 * 60 - 1);
  });

  it('orders buckets consistently: sorting by it never interleaves them', () => {
    // The property that makes it safe to sort a whole day's items by this one
    // number and then split them into sections.
    const sorted = [...everyMinute].sort((a, b) => minutesFromDayStart(a) - minutesFromDayStart(b));
    const order = sorted.map(bucketOf);
    const firstIndexOf = new Map<TimeBucket, number>();
    const lastIndexOf = new Map<TimeBucket, number>();
    order.forEach((bucket, i) => {
      if (!firstIndexOf.has(bucket)) firstIndexOf.set(bucket, i);
      lastIndexOf.set(bucket, i);
    });
    // Each bucket occupies one contiguous run, and the runs are in BUCKETS order.
    let previousEnd = -1;
    for (const bucket of BUCKETS) {
      expect(firstIndexOf.get(bucket)).toBe(previousEnd + 1);
      previousEnd = lastIndexOf.get(bucket) as number;
    }
    expect(previousEnd).toBe(everyMinute.length - 1);
  });
});

describe('bucketRange', () => {
  it('runs from its own start to the next one', () => {
    expect(bucketRange('morning')).toEqual({ from: '05:00', to: '12:00' });
    expect(bucketRange('evening')).toEqual({ from: '17:00', to: '21:00' });
  });

  it('wraps night around to the next morning', () => {
    expect(bucketRange('night')).toEqual({ from: '21:00', to: '05:00' });
  });

  it('leaves no gap between one bucket and the next', () => {
    for (let i = 0; i < BUCKETS.length; i += 1) {
      const bucket = BUCKETS[i] as TimeBucket;
      const next = BUCKETS[(i + 1) % BUCKETS.length] as TimeBucket;
      expect(bucketRange(bucket).to).toBe(bucketStart(next));
    }
  });
});

describe('describeBucket and isTimeBucket', () => {
  it('labels all four distinctly', () => {
    const labels = BUCKETS.map(describeBucket);
    expect(labels).toEqual(['Morning', 'Afternoon', 'Evening', 'Night']);
    expect(new Set(labels).size).toBe(BUCKETS.length);
  });

  it('accepts exactly the four buckets', () => {
    for (const bucket of BUCKETS) expect(isTimeBucket(bucket)).toBe(true);
    for (const value of [null, undefined, '', 'MORNING', 'midday', 0, {}]) {
      expect(isTimeBucket(value)).toBe(false);
    }
  });
});
