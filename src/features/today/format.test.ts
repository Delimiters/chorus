/**
 * The prose layer.
 *
 * Cheap to test and easy to get subtly wrong — an off-by-one in `daysBetween`
 * shows up here as "Tomorrow" on the wrong day, which is the kind of bug nobody
 * reports and everybody notices.
 */

import type { CivilDate } from '@/core/civil/types';
import {
  datesBetween,
  formatDayCaption,
  formatDayLong,
  formatDayShort,
  formatFlexibleWindow,
  formatRelativeDay,
  monthName,
  weekdayShort,
} from './format';

const d = (s: string) => s as CivilDate;

describe('day names', () => {
  it('writes a long day', () => {
    // 2026-07-30 is a Thursday.
    expect(formatDayLong(d('2026-07-30'))).toBe('Thursday 30 July');
  });

  it('writes a short day', () => {
    expect(formatDayShort(d('2026-01-04'))).toBe('Sun 4 Jan');
  });

  it('names months from a one-based month number', () => {
    expect(monthName(d('2026-01-15'))).toBe('January');
    expect(monthName(d('2026-12-15'))).toBe('December');
    expect(weekdayShort(d('2026-07-30'))).toBe('Thu');
  });
});

describe('relative days', () => {
  const today = d('2026-07-30');

  it('prefers the words people actually use', () => {
    expect(formatRelativeDay(today, today)).toBe('Today');
    expect(formatRelativeDay(d('2026-07-31'), today)).toBe('Tomorrow');
    expect(formatRelativeDay(d('2026-07-29'), today)).toBe('Yesterday');
  });

  it('names the weekday within the coming week', () => {
    expect(formatRelativeDay(d('2026-08-02'), today)).toBe('Sunday');
  });

  it('falls back to a date once a weekday would be ambiguous', () => {
    // Seven days out, "Thursday" could mean this one or the next.
    expect(formatRelativeDay(d('2026-08-06'), today)).toBe('Thu 6 Aug');
  });

  it('gives past days an absolute date rather than a weekday', () => {
    expect(formatRelativeDay(d('2026-07-27'), today)).toBe('Mon 27 Jul');
  });
});

describe('the Upcoming day rail caption', () => {
  const today = d('2026-07-30');

  it('uses relative words where they carry information', () => {
    expect(formatDayCaption(today, today)).toBe('Today');
    expect(formatDayCaption(d('2026-07-31'), today)).toBe('Tomorrow');
    expect(formatDayCaption(d('2026-07-29'), today)).toBe('Yesterday');
  });

  it('shows the month otherwise, since the weekday is already printed above', () => {
    expect(formatDayCaption(d('2026-08-02'), today)).toBe('Aug');
    expect(formatDayCaption(d('2026-07-25'), today)).toBe('Jul');
  });
});

describe('flexible windows', () => {
  const today = d('2026-07-30');
  const from = d('2026-07-26');

  it('counts down to the close of the window', () => {
    expect(formatFlexibleWindow(from, d('2026-07-30'), today)).toBe('last day');
    expect(formatFlexibleWindow(from, d('2026-07-31'), today)).toBe('until tomorrow');
    expect(formatFlexibleWindow(from, d('2026-08-01'), today)).toBe('until Saturday');
  });

  it('says so when the window has already closed', () => {
    expect(formatFlexibleWindow(from, d('2026-07-29'), today)).toBe('window closed');
  });

  it('uses a date once the weekday would be ambiguous', () => {
    expect(formatFlexibleWindow(from, d('2026-08-08'), today)).toBe('until Sat 8 Aug');
  });
});

describe('datesBetween', () => {
  it('is inclusive at both ends', () => {
    expect(datesBetween(d('2026-07-30'), d('2026-08-02'))).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('returns the single day when the ends meet', () => {
    expect(datesBetween(d('2026-07-30'), d('2026-07-30'))).toEqual(['2026-07-30']);
  });

  it('returns nothing when the window is inverted', () => {
    expect(datesBetween(d('2026-07-30'), d('2026-07-29'))).toEqual([]);
  });
});
