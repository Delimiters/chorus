/**
 * The key a Someday chore's completion is filed under.
 *
 * Someday chores expand to nothing — that is deliberate, and it is what stops a
 * one-time chore claiming to be due forever. But "produces no occurrence" and
 * "cannot be recorded as done" are different claims, and conflating them left
 * the Someday list with a promise it could not keep: the picker said you could
 * tick a chore off a list that had no checkbox on it.
 */

import { civilDate } from '../civil/date';
import type { CalendarConfig } from '../civil/types';
import { expandOccurrences } from './expand';
import { SOMEDAY_PERIOD_KEY, parseOccurrenceKey, somedayKeyOf } from './period';

const CAL: CalendarConfig = { weekStartsOn: 0 };

describe('the someday key', () => {
  it('is stable, so ticking twice is the same row', () => {
    // The unique constraint on (chore_id, occurrence_key) is what makes a
    // double tap idempotent, and it only helps if the key does not move.
    expect(somedayKeyOf('chore-1')).toBe(somedayKeyOf('chore-1'));
  });

  it('differs per chore', () => {
    expect(somedayKeyOf('chore-1')).not.toBe(somedayKeyOf('chore-2'));
  });

  it('carries no date, because a Someday chore has none', () => {
    const parsed = parseOccurrenceKey(somedayKeyOf('chore-1'));
    expect(parsed?.periodKey).toBe(SOMEDAY_PERIOD_KEY);
    expect(parsed?.periodKey).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('cannot collide with a real occurrence, because nothing expands to it', () => {
    // The guarantee that keeps this safe: the agenda never produces this key,
    // so a completion filed under it can never mark a dated occurrence done.
    const occurrences = expandOccurrences(
      'chore-1',
      {
        rule: { kind: 'daily', everyNDays: 1 },
        startsOn: civilDate('2026-01-01'),
        endsOn: null,
        timeOfDay: null,
      },
      CAL,
      { start: civilDate('2026-01-01'), end: civilDate('2026-06-01') },
    );
    expect(occurrences.some((o) => o.occurrenceKey === somedayKeyOf('chore-1'))).toBe(false);
  });

  it('is not produced by an unscheduled rule either — the rule still expands to nothing', () => {
    const occurrences = expandOccurrences(
      'chore-1',
      {
        rule: { kind: 'unscheduled' },
        startsOn: civilDate('2026-01-01'),
        endsOn: null,
        timeOfDay: null,
      },
      CAL,
      { start: civilDate('2026-01-01'), end: civilDate('2026-06-01') },
    );
    expect(occurrences).toEqual([]);
  });
});
