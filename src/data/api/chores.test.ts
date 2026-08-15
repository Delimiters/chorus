/**
 * The row a chore is written as.
 *
 * This exists because of a gap the Phase 6 retrospective found: the integration
 * suite drives raw queries — the app's Supabase client cannot load in a Node
 * test environment — so `createChore` and `updateChore` were never called by
 * anything, and a wrong column name in either would have passed every test
 * while failing in the app. Worse, the file header of that suite claimed it
 * exercised them.
 *
 * `choreRow` is the piece both writers share, extracted so it can be tested
 * without a database. What it cannot prove is that these column names exist;
 * the integration suite does that, by inserting with the same names.
 */

import { civilDate } from '@/core/civil/date';
import type { Schedule } from '@/core/recurrence/types';
import type { Assignment } from '@/core/rotation/types';
import { choreRow, type ChoreDraft } from './chores';

const DAILY: Schedule = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: civilDate('2026-01-04'),
  endsOn: null,
  timesOfDay: [],
};

const ANYONE: Assignment = { kind: 'anyone' };

const draft = (over: Partial<ChoreDraft> = {}): ChoreDraft => ({
  title: 'Dishes',
  privateTo: null,
  notes: null,
  schedule: DAILY,
  assignment: ANYONE,
  categoryId: null,
  priority: 'normal',
  icon: null,
  ...over,
});

describe('building the row', () => {
  it('writes exactly the columns a chore is made of', () => {
    // Named explicitly rather than snapshotted: a snapshot would happily record
    // a typo, and the point of this test is the names.
    expect(Object.keys(choreRow(draft())).sort()).toEqual([
      'assignment',
      'category_id',
      'icon',
      'notes',
      'priority',
      'private_to',
      'schedule',
      'title',
    ]);
  });

  it('writes a shared chore as null rather than omitting the key', () => {
    // Same reasoning as the icon below: omitting it would leave a chore that
    // had been made private stuck that way, with no route back to shared.
    expect(choreRow(draft({ privateTo: null }))).toHaveProperty('private_to', null);
  });

  it('writes a null icon as null rather than dropping the key', () => {
    // Omitting it would leave an edited chore wearing whatever icon it had,
    // with no way to take one off.
    expect(choreRow(draft({ icon: null }))).toHaveProperty('icon', null);
  });

  it('normalises a priority it does not recognise', () => {
    // The column has a CHECK, so an unrecognised value would surface as a
    // 23514 from Postgres rather than anything a person could act on. This is
    // the one function both writers share, so normalising here covers both.
    const row = choreRow(draft({ priority: 'urgent' as never }));
    expect(row.priority).toBe('normal');
  });

  it('passes a null category through as null rather than dropping it', () => {
    // Null is the "Other" group, not a missing value. Omitting the key would
    // leave an edited chore in whatever category it was already in.
    expect(choreRow(draft({ categoryId: null }))).toHaveProperty('category_id', null);
  });

  it('carries the schedule and assignment through unchanged', () => {
    const row = choreRow(draft());
    expect(row.schedule).toEqual(DAILY);
    expect(row.assignment).toEqual(ANYONE);
  });

  it('trims the title', () => {
    expect(choreRow(draft({ title: '  Dishes  ' })).title).toBe('Dishes');
  });

  it('stores empty notes as null, so "has notes" is one check and not two', () => {
    expect(choreRow(draft({ notes: '' })).notes).toBeNull();
    expect(choreRow(draft({ notes: '   ' })).notes).toBeNull();
    expect(choreRow(draft({ notes: null })).notes).toBeNull();
  });

  it('trims notes it does keep', () => {
    expect(choreRow(draft({ notes: '  green bin  ' })).notes).toBe('green bin');
  });
});

describe('refusing to write something unreadable', () => {
  /**
   * `schedule` is jsonb, so the database accepts any shape at all. A malformed
   * rule would save and then read back as "could not be understood" — a chore
   * nobody can fix from inside the app. Failing here names the problem at the
   * point of the mistake.
   */
  it('rejects a title that is only whitespace', () => {
    expect(() => choreRow(draft({ title: '   ' }))).toThrow(/needs a name/);
  });

  it('rejects a title past the database limit', () => {
    // 120 is the CHECK constraint; failing before the round trip gives a
    // sentence rather than a Postgres error code.
    expect(() => choreRow(draft({ title: 'x'.repeat(121) }))).toThrow(/too long/);
    expect(() => choreRow(draft({ title: 'x'.repeat(120) }))).not.toThrow();
  });

  it('rejects a schedule the engine cannot read', () => {
    const broken = { ...DAILY, rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [] } };
    expect(() => choreRow(draft({ schedule: broken as unknown as Schedule }))).toThrow(
      /schedule is not one the app can store/,
    );
  });

  it('rejects an assignment the engine cannot read', () => {
    const broken = { kind: 'rotate', cadence: { unit: 'week', every: 1 }, segments: [] };
    expect(() => choreRow(draft({ assignment: broken as unknown as Assignment }))).toThrow(
      /assignment is not one the app can store/,
    );
  });

  it('normalises a one-time schedule the same way the engine does', () => {
    // The row and the generated `starts_on` column must agree, or indexed date
    // filters miss rows. See the migration and docs/RECURRENCE.md.
    const once: Schedule = {
      rule: { kind: 'once', dueOn: civilDate('2026-02-14'), granularity: 'day' },
      startsOn: civilDate('2026-01-01'),
      endsOn: null,
      timesOfDay: [],
    };
    const row = choreRow(draft({ schedule: once }));
    expect(row.schedule).toMatchObject({ startsOn: '2026-02-14' });
  });
});
