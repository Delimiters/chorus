import fc from 'fast-check';

import { addDays, civilDate } from '../civil/date';
import type { CalendarConfig, CivilDate, CivilTime, DateWindow } from '../civil/types';
import type { Schedule } from '../recurrence/types';
import { bucketSections } from './agenda';
import {
  projectRoutineOccurrences,
  type RoutineCompletionInput,
  type RoutineItemInput,
} from './project';

const ME = 'me';
const THEM = 'them';
const TODAY = civilDate('2026-03-15');
const CAL: CalendarConfig = { weekStartsOn: 0 };
const WINDOW: DateWindow = { start: civilDate('2026-03-09'), end: civilDate('2026-03-22') };

const daily: Schedule = {
  rule: { kind: 'daily', everyNDays: 1 },
  startsOn: civilDate('2026-01-01'),
  endsOn: null,
  timesOfDay: [],
};

const item = (over: Partial<RoutineItemInput> = {}): RoutineItemInput => ({
  id: 'stretch',
  title: 'Stretch',
  ownerId: ME,
  schedule: daily,
  timeOfDay: '07:00' as CivilTime,
  bucket: 'morning',
  linkedChoreId: null,
  icon: null,
  remind: false,
  archived: false,
  ...over,
});

const project = (
  items: RoutineItemInput[],
  completions: RoutineCompletionInput[] = [],
  today: CivilDate = TODAY,
) => projectRoutineOccurrences({ items, completions, today }, CAL, WINDOW);

describe('projectRoutineOccurrences', () => {
  it('expands a daily item across the window', () => {
    const occurrences = project([item()]);
    expect(occurrences).toHaveLength(14);
    expect(occurrences[0]?.dueOn).toBe(WINDOW.start);
  });

  it('produces nothing for an archived item', () => {
    expect(project([item({ archived: true })])).toEqual([]);
  });

  it('carries the item through onto every occurrence', () => {
    // These belong to the item, not the occurrence, and every consumer that has
    // an occurrence would otherwise need the item too.
    const [first] = project([item({ icon: 'yoga', linkedChoreId: 'chore-1', remind: true })]);
    expect(first).toMatchObject({
      itemId: 'stretch',
      title: 'Stretch',
      ownerId: ME,
      bucket: 'morning',
      icon: 'yoga',
      linkedChoreId: 'chore-1',
      remind: true,
    });
  });

  describe('status is about the day it is on, not about now', () => {
    it('marks a past day missed', () => {
      const past = project([item()]).find((o) => o.dueOn === civilDate('2026-03-10'));
      expect(past?.status).toBe('missed');
    });

    it('marks today due', () => {
      const now = project([item()]).find((o) => o.dueOn === TODAY);
      expect(now?.status).toBe('due');
    });

    it('marks a future day upcoming, not missed', () => {
      const later = project([item()]).find((o) => o.dueOn === civilDate('2026-03-20'));
      expect(later?.status).toBe('upcoming');
    });

    it('marks a completed one completed whatever day it was', () => {
      const target = project([item()]).find((o) => o.dueOn === civilDate('2026-03-10'));
      const done = project(
        [item()],
        [
          {
            routineItemId: 'stretch',
            occurrenceKey: target?.occurrenceKey as string,
            completedOn: civilDate('2026-03-10'),
          },
        ],
      ).find((o) => o.dueOn === civilDate('2026-03-10'));
      expect(done?.status).toBe('completed');
      expect(done?.completedOn).toBe(civilDate('2026-03-10'));
    });

    it('never marks anything missed on a day that has not finished', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 7 }), (daysAhead) => {
          const day = addDays(TODAY, daysAhead);
          const occ = project([item()]).find((o) => o.dueOn === day);
          expect(occ?.status).not.toBe('missed');
        }),
      );
    });
  });

  describe('sort keys', () => {
    it('orders a late-night item after an evening one', () => {
      // The bug the day-relative key exists for: '00:30' < '21:00' as strings.
      const late = project([item({ id: 'a', timeOfDay: '00:30' as CivilTime, bucket: 'night' })]);
      const early = project([item({ id: 'b', timeOfDay: '21:00' as CivilTime, bucket: 'night' })]);
      expect((early[0]?.sortKey as number) < (late[0]?.sortKey as number)).toBe(true);
    });

    it('puts an untimed item after every timed one', () => {
      const untimed = project([item({ id: 'u', timeOfDay: null, bucket: 'morning' })]);
      const timed = project([item({ id: 't', timeOfDay: '11:59' as CivilTime })]);
      expect((untimed[0]?.sortKey as number) > (timed[0]?.sortKey as number)).toBe(true);
    });
  });

  it('keeps one person out of another person’s occurrences', () => {
    const occurrences = project([item({ id: 'mine' }), item({ id: 'theirs', ownerId: THEM })]);
    expect(new Set(occurrences.map((o) => o.ownerId))).toEqual(new Set([ME, THEM]));
  });
});

describe('bucketSections', () => {
  const on = TODAY;
  const sections = (items: RoutineItemInput[], showOthers = true, day: CivilDate = on) =>
    bucketSections(project(items), ME, { showOthers, on: day });

  it('splits a day into its buckets, in order', () => {
    const result = sections([
      item({ id: 'night', timeOfDay: '22:00' as CivilTime, bucket: 'night' }),
      item({ id: 'morning', timeOfDay: '07:00' as CivilTime, bucket: 'morning' }),
      item({ id: 'evening', timeOfDay: '18:00' as CivilTime, bucket: 'evening' }),
    ]);
    expect(result.sections.map((s) => s.bucket)).toEqual(['morning', 'evening', 'night']);
  });

  it('emits no section for a bucket with nothing in it', () => {
    const result = sections([item()]);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.title).toBe('Morning');
  });

  it('shows only the day asked for', () => {
    // The whole point of history: Wednesday shows Wednesday, not today.
    const yesterday = addDays(on, -1);
    const result = sections([item()], true, yesterday);
    expect(result.sections[0]?.mine.every((o) => o.dueOn === yesterday)).toBe(true);
  });

  it('counts only your own progress', () => {
    // Somebody else's routine is not your score.
    const result = sections([item({ id: 'mine' }), item({ id: 'theirs', ownerId: THEM })]);
    expect(result.totalCount).toBe(1);
  });

  it('separates yours from theirs', () => {
    const result = sections([item({ id: 'mine' }), item({ id: 'theirs', ownerId: THEM })]);
    const morning = result.sections[0];
    expect(morning?.mine.map((o) => o.itemId)).toEqual(['mine']);
    expect(morning?.theirs).toEqual([{ ownerId: THEM, items: expect.any(Array) }]);
  });

  it('hides theirs entirely when asked to', () => {
    const result = sections([item({ id: 'theirs', ownerId: THEM })], false);
    // Nothing of theirs, and therefore no section at all — not an empty one.
    expect(result.sections).toEqual([]);
  });

  it('orders within a bucket by time, then by title', () => {
    const result = sections([
      item({ id: 'c', title: 'Zed', timeOfDay: '09:00' as CivilTime }),
      item({ id: 'a', title: 'Alpha', timeOfDay: '09:00' as CivilTime }),
      item({ id: 'b', title: 'Beta', timeOfDay: '07:00' as CivilTime }),
    ]);
    expect(result.sections[0]?.mine.map((o) => o.title)).toEqual(['Beta', 'Alpha', 'Zed']);
  });

  it('does not depend on the order occurrences arrived in', () => {
    const forward = sections([
      item({ id: 'a', timeOfDay: '07:00' as CivilTime }),
      item({ id: 'b', timeOfDay: '08:00' as CivilTime }),
    ]);
    const backward = sections([
      item({ id: 'b', timeOfDay: '08:00' as CivilTime }),
      item({ id: 'a', timeOfDay: '07:00' as CivilTime }),
    ]);
    expect(backward).toEqual(forward);
  });
});
