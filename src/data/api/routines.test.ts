import type { Schedule } from '@/core/recurrence/types';
import type { CivilDate, CivilTime } from '@/core/civil/types';
import { routineRow, type RoutineDraft } from './routines';

const DAILY: Schedule = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: '2026-01-01' as CivilDate,
  endsOn: null,
  timesOfDay: [],
};

const draft = (over: Partial<RoutineDraft> = {}): RoutineDraft => ({
  title: 'Stretch',
  notes: null,
  schedule: DAILY,
  timeOfDay: '07:00' as CivilTime,
  bucketChoice: null,
  icon: null,
  remind: false,
  linkedChoreId: null,
  ...over,
});

describe('building the row', () => {
  it('writes exactly the columns a routine item is made of', () => {
    // Named explicitly rather than snapshotted: a snapshot would happily record
    // a typo, and the point of this test is the names.
    expect(Object.keys(routineRow(draft())).sort()).toEqual([
      'bucket_choice',
      'icon',
      'linked_chore_id',
      'notes',
      'remind',
      'schedule',
      'time_of_day',
      'title',
    ]);
  });

  it('trims the title and rejects an empty one', () => {
    expect(routineRow(draft({ title: '  Stretch  ' })).title).toBe('Stretch');
    expect(() => routineRow(draft({ title: '   ' }))).toThrow(/needs a name/);
  });

  it('turns empty notes into null, so "has notes" is one check', () => {
    expect(routineRow(draft({ notes: '   ' })).notes).toBeNull();
    expect(routineRow(draft({ notes: 'after coffee' })).notes).toBe('after coffee');
  });

  describe('a time or a bucket, never both and never neither', () => {
    // Mirrors the routine_bucket_source CHECK. Caught here so the message is
    // about the form rather than a 23514 arriving from Postgres.
    it('accepts a time alone', () => {
      const row = routineRow(draft({ timeOfDay: '07:00' as CivilTime, bucketChoice: null }));
      expect(row).toMatchObject({ time_of_day: '07:00', bucket_choice: null });
    });

    it('accepts a bucket alone', () => {
      const row = routineRow(draft({ timeOfDay: null, bucketChoice: 'evening' }));
      expect(row).toMatchObject({ time_of_day: null, bucket_choice: 'evening' });
    });

    it('rejects both', () => {
      expect(() =>
        routineRow(draft({ timeOfDay: '07:00' as CivilTime, bucketChoice: 'morning' })),
      ).toThrow(/not both/);
    });

    it('rejects neither', () => {
      expect(() => routineRow(draft({ timeOfDay: null, bucketChoice: null }))).toThrow(
        /not neither/,
      );
    });
  });

  it('refuses a schedule the engine would not accept', () => {
    // The form is the only writer, so anything it emits will be read back by
    // the parser. A shape it rejects becomes an item that says "could not be
    // understood" and cannot be fixed from inside the app.
    const broken = { ...DAILY, rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [] } };
    expect(() => routineRow(draft({ schedule: broken as unknown as Schedule }))).toThrow(
      /can store/,
    );
  });

  it('passes a null link through as null rather than dropping the key', () => {
    // Omitting it would leave an edited item linked to whatever chore it was
    // already linked to, with no way to unlink.
    expect(routineRow(draft({ linkedChoreId: null }))).toHaveProperty('linked_chore_id', null);
  });
});
