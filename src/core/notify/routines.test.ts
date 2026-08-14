import fc from 'fast-check';

import { addDays, civilDate } from '../civil/date';
import type { CivilTime } from '../civil/types';
import type { ProjectedOccurrence } from '../occurrence/types';
import { bucketOf } from '../routines/buckets';
import type { RoutineOccurrence } from '../routines/project';
import { DEFAULT_POLICY, KEEP_ALIVE_ID, MAX_PENDING, planReminders } from './plan';
import {
  isRoutineReminder,
  planAllReminders,
  planRoutineReminders,
  ROUTINE_HORIZON_DAYS,
} from './routines';

const TODAY = civilDate('2026-03-15');
const ME = 'me';
const THEM = 'them';

const routine = (over: Partial<RoutineOccurrence> = {}): RoutineOccurrence =>
  ({
    choreId: 'stretch',
    itemId: 'stretch',
    occurrenceKey: `v1:stretch:${over.dueOn ?? TODAY}:0:-`,
    dueOn: TODAY,
    flexibleFrom: over.dueOn ?? TODAY,
    flexibleUntil: over.dueOn ?? TODAY,
    periodKey: '2026-03-15',
    slot: 0,
    subject: null,
    occurrenceIndex: 0,
    title: 'Stretch',
    ownerId: ME,
    bucket: 'morning',
    timeOfDay: '07:00' as CivilTime,
    linkedChoreId: null,
    icon: null,
    remind: true,
    status: 'due',
    completedOn: null,
    sortKey: 120,
    ...over,
  }) as RoutineOccurrence;

const chore = (over: Partial<ProjectedOccurrence> = {}): ProjectedOccurrence =>
  ({
    choreId: 'dishes',
    choreTitle: 'Dishes',
    occurrenceKey: `v1:dishes:${over.dueOn ?? TODAY}:0:-`,
    dueOn: TODAY,
    flexibleFrom: over.dueOn ?? TODAY,
    flexibleUntil: over.dueOn ?? TODAY,
    periodKey: '2026-03-15',
    slot: 0,
    subject: null,
    occurrenceIndex: 0,
    status: 'due',
    assignee: { kind: 'member', memberId: ME, turn: 0 },
    timesOfDay: [],
    completedOn: null,
    completedBy: null,
    daysLate: 0,
    rescheduled: false,
    originalDueOn: null,
    displaced: false,
    ...over,
  }) as ProjectedOccurrence;

const plan = (occurrences: RoutineOccurrence[], policy = DEFAULT_POLICY) =>
  planRoutineReminders({ occurrences, today: TODAY, userId: ME, policy });

describe('planRoutineReminders', () => {
  it('gives a timed item its own reminder, at its own time', () => {
    // Setting a time is a statement that the thing happens then; folding it
    // into a bucket notification would throw that away.
    const [reminder] = plan([routine()]);
    expect(reminder).toMatchObject({ title: 'Stretch', atTime: '07:00', onDate: TODAY });
  });

  it('gives one reminder to a whole bucket of untimed items', () => {
    // Four things in one morning do not deserve four buzzes at 05:00. They
    // deserve one saying there are four.
    const reminders = plan([
      routine({ itemId: 'a', occurrenceKey: 'a', timeOfDay: null }),
      routine({ itemId: 'b', occurrenceKey: 'b', timeOfDay: null }),
      routine({ itemId: 'c', occurrenceKey: 'c', timeOfDay: null }),
    ]);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      title: 'Morning routine',
      body: '3 things to do',
      // The policy's morning time, not the 05:00 boundary the day starts at.
      atTime: '07:00',
    });
  });

  it('counts one thing as one thing', () => {
    const [reminder] = plan([routine({ timeOfDay: null })]);
    expect(reminder?.body).toBe('1 thing to do');
  });

  it('keeps buckets and days apart', () => {
    const reminders = plan([
      routine({ itemId: 'a', occurrenceKey: 'a', timeOfDay: null, bucket: 'morning' }),
      routine({ itemId: 'b', occurrenceKey: 'b', timeOfDay: null, bucket: 'evening' }),
      routine({
        itemId: 'c',
        occurrenceKey: 'c',
        timeOfDay: null,
        bucket: 'morning',
        dueOn: addDays(TODAY, 1),
      }),
    ]);
    expect(reminders).toHaveLength(3);
    expect(new Set(reminders.map((r) => r.id)).size).toBe(3);
  });

  it('mixes timed and untimed in the same bucket without merging them', () => {
    const reminders = plan([
      routine({ itemId: 'timed', occurrenceKey: 'timed', timeOfDay: '09:15' as CivilTime }),
      routine({ itemId: 'untimed', occurrenceKey: 'untimed', timeOfDay: null }),
    ]);
    expect(reminders.map((r) => r.atTime).sort()).toEqual(['07:00', '09:15']);
  });

  it('fires a bucket at the time the policy says, not at the day boundary', () => {
    // The whole reason bucket reminder times are separate from bucket bounds:
    // the day starts at 05:00 so Night can be one span, and being told about
    // your morning routine then is an alarm clock.
    const reminders = plan([routine({ timeOfDay: null })], {
      ...DEFAULT_POLICY,
      bucketTimes: { ...DEFAULT_POLICY.bucketTimes, morning: '10:45' as CivilTime },
    });
    expect(reminders[0]?.atTime).toBe('10:45');
  });

  it('leaves the bucket boundaries alone when the reminder time moves', () => {
    // Non-vacuity for the pair above: an item at 06:00 is still Morning, even
    // with the morning reminder set to the middle of the day.
    expect(bucketOf('06:00' as CivilTime)).toBe('morning');
    expect(bucketOf('20:00' as CivilTime)).toBe('night');
  });

  describe('what it stays quiet about', () => {
    it('an item that has not asked to be reminded', () => {
      expect(plan([routine({ remind: false })])).toEqual([]);
    });

    it('one already done', () => {
      expect(plan([routine({ status: 'completed', completedOn: TODAY })])).toEqual([]);
    });

    it('the past — the item is already marked missed on its own day', () => {
      expect(plan([routine({ dueOn: addDays(TODAY, -1), status: 'missed' })])).toEqual([]);
    });

    it('beyond the horizon, which is days rather than weeks', () => {
      expect(plan([routine({ dueOn: addDays(TODAY, ROUTINE_HORIZON_DAYS + 1) })])).toEqual([]);
      expect(plan([routine({ dueOn: addDays(TODAY, ROUTINE_HORIZON_DAYS) })])).toHaveLength(1);
    });

    it('somebody else’s routine, which fires on their phone or not at all', () => {
      expect(plan([routine({ ownerId: THEM })])).toEqual([]);
    });

    it('everything, when routines are switched off', () => {
      expect(plan([routine()], { ...DEFAULT_POLICY, includeRoutines: false })).toEqual([]);
    });
  });

  it('uses ids that cannot collide with a chore’s', () => {
    // The transport schedules by identifier: a collision silently replaces.
    const reminders = plan([
      routine({ occurrenceKey: 'shared-key' }),
      routine({ itemId: 'b', occurrenceKey: 'b', timeOfDay: null }),
    ]);
    expect(reminders.every(isRoutineReminder)).toBe(true);
    expect(reminders.every((r) => r.id !== 'shared-key')).toBe(true);
  });
});

describe('planAllReminders', () => {
  it('leaves chore reminders exactly as they were when there are no routines', () => {
    // The "did I break the existing feature" test. Compared against the chore
    // planner itself rather than a snapshot, so it stays true as chores change.
    const chores = [
      chore({ occurrenceKey: 'a' }),
      chore({ occurrenceKey: 'b', dueOn: addDays(TODAY, 1) }),
      chore({ occurrenceKey: 'c', dueOn: addDays(TODAY, 2) }),
    ];
    const merged = planAllReminders({
      chores,
      routines: [],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    const choresOnly = planReminders({
      occurrences: chores,
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });

    expect(merged.filter((r) => r.id !== KEEP_ALIVE_ID)).toEqual(choresOnly);
  });

  it('includes both kinds when both exist', () => {
    const merged = planAllReminders({
      chores: [chore()],
      routines: [routine()],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    expect(merged.some(isRoutineReminder)).toBe(true);
    expect(merged.some((r) => !isRoutineReminder(r) && r.id !== KEEP_ALIVE_ID)).toBe(true);
  });

  it('never exceeds the cap, whatever it is given', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 90 }),
        fc.integer({ min: 0, max: 90 }),
        (choreCount, routineCount) => {
          const merged = planAllReminders({
            chores: Array.from({ length: choreCount }, (_, i) =>
              chore({ occurrenceKey: `c${i}`, dueOn: addDays(TODAY, i % 25) }),
            ),
            routines: Array.from({ length: routineCount }, (_, i) =>
              routine({
                itemId: `r${i}`,
                occurrenceKey: `r${i}`,
                dueOn: addDays(TODAY, i % (ROUTINE_HORIZON_DAYS + 1)),
              }),
            ),
            today: TODAY,
            userId: ME,
            policy: DEFAULT_POLICY,
          });
          expect(merged.length).toBeLessThanOrEqual(MAX_PENDING);
        },
      ),
    );
  });

  it('does not let a long routine silence the chores', () => {
    // The reason the quota exists. Eighty routine reminders would otherwise
    // take every slot, and nothing on screen would show it.
    const merged = planAllReminders({
      // Inside the 30-day chore horizon, or the test measures the horizon
      // rather than the quota — which is how the first version of it failed.
      chores: Array.from({ length: 40 }, (_, i) =>
        chore({ occurrenceKey: `c${i}`, dueOn: addDays(TODAY, (i % 25) + 1) }),
      ),
      routines: Array.from({ length: 80 }, (_, i) =>
        routine({ itemId: `r${i}`, occurrenceKey: `r${i}`, timeOfDay: '07:00' as CivilTime }),
      ),
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });

    const chores = merged.filter((r) => !isRoutineReminder(r) && r.id !== KEEP_ALIVE_ID);
    expect(chores.length).toBeGreaterThanOrEqual(39);
  });

  it('does not let a long chore list silence the routine', () => {
    // The routines are deliberately the *furthest out* thing here. With them
    // on today, nearest-first ordering saves them whatever the quota does, and
    // the assertion holds with the quota deleted — which it did, until the
    // retrospective ran the experiment.
    const merged = planAllReminders({
      chores: Array.from({ length: 200 }, (_, i) =>
        chore({ occurrenceKey: `c${i}`, dueOn: addDays(TODAY, (i % 2) + 1) }),
      ),
      routines: Array.from({ length: 10 }, (_, i) =>
        routine({
          itemId: `r${i}`,
          occurrenceKey: `r${i}`,
          dueOn: addDays(TODAY, ROUTINE_HORIZON_DAYS),
          timeOfDay: '07:00' as CivilTime,
        }),
      ),
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });

    expect(merged.filter(isRoutineReminder)).toHaveLength(10);
  });

  it('reminds about a pre-dawn item on the day it actually happens', () => {
    // 00:30 sits in *tonight's* Night section — the routine day starts at
    // 05:00 — so the instant is tomorrow's date. Scheduled against `dueOn` it
    // would fire a day early, and for an item due today it would land in the
    // past and be dropped without a word.
    const [reminder] = plan([routine({ timeOfDay: '00:30' as CivilTime })]);
    expect(reminder).toMatchObject({ onDate: addDays(TODAY, 1), atTime: '00:30' });
  });

  it('leaves an after-dawn item on its own day', () => {
    const [reminder] = plan([routine({ timeOfDay: '05:00' as CivilTime })]);
    expect(reminder?.onDate).toBe(TODAY);
  });

  it('keeps the nearest of everything, not the nearest of one kind', () => {
    const merged = planAllReminders({
      chores: [chore({ occurrenceKey: 'far', dueOn: addDays(TODAY, 20) })],
      routines: [routine({ timeOfDay: '07:00' as CivilTime })],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    const withoutKeepAlive = merged.filter((r) => r.id !== KEEP_ALIVE_ID);
    expect(withoutKeepAlive[0]?.onDate).toBe(TODAY);
  });

  it('appends one keep-alive, placed after the whole merged plan', () => {
    const merged = planAllReminders({
      chores: [chore({ dueOn: addDays(TODAY, 10) })],
      routines: [routine()],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    expect(merged.filter((r) => r.id === KEEP_ALIVE_ID)).toHaveLength(1);
  });

  it('plans nothing at all when reminders are off', () => {
    expect(
      planAllReminders({
        chores: [chore()],
        routines: [routine()],
        today: TODAY,
        userId: ME,
        policy: { ...DEFAULT_POLICY, enabled: false },
      }),
    ).toEqual([]);
  });
});
