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

  it('fires a bucket reminder set before dawn on the following morning', () => {
    /*
     * Bucket reminder times are configurable, so Night's can be set to 02:00 —
     * and 02:00 belongs to the routine day that began the previous morning.
     * Scheduled against the day itself it was almost twenty-four hours early,
     * and for today's bucket that instant is already past, so the transport
     * dropped it and the reminder never arrived. The per-item path has had this
     * guard since it shipped; the grouped path never got it.
     */
    const reminders = plan([routine({ timeOfDay: null, bucket: 'night' })], {
      ...DEFAULT_POLICY,
      bucketTimes: { ...DEFAULT_POLICY.bucketTimes, night: '02:00' as CivilTime },
    });

    expect(reminders[0]?.atTime).toBe('02:00');
    expect(reminders[0]?.onDate).toBe(addDays(TODAY, 1));
  });

  it('leaves a bucket reminder after dawn on its own day', () => {
    // Non-vacuity for the pair above.
    const reminders = plan([routine({ timeOfDay: null, bucket: 'night' })], {
      ...DEFAULT_POLICY,
      bucketTimes: { ...DEFAULT_POLICY.bucketTimes, night: '20:00' as CivilTime },
    });

    expect(reminders[0]?.onDate).toBe(TODAY);
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
      dayStartsAtHour: 0,
    });
    const choresOnly = planReminders({
      occurrences: chores,
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
      dayStartsAtHour: 0,
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
      dayStartsAtHour: 0,
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
            dayStartsAtHour: 0,
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
      dayStartsAtHour: 0,
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
      dayStartsAtHour: 0,
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
      dayStartsAtHour: 0,
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
      dayStartsAtHour: 0,
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
        dayStartsAtHour: 0,
      }),
    ).toEqual([]);
  });
});

describe('the two planners, merged under a day break', () => {
  /*
   * `planAllReminders` sorts both streams on `onDate`, and that field means
   * "wall-clock date" for both — chores via `wallDateFor` since the household
   * break shipped, routines via `fallsOnNextCalendarDay` since routines did.
   * Every existing test here pins the break at 0, so nothing exercised the
   * composition; a review pointed that out.
   */
  it('orders a 01:00 chore and a 04:00 routine by when they actually fire', () => {
    const merged = planAllReminders({
      chores: [chore({ occurrenceKey: 'c1', dueOn: TODAY, timesOfDay: ['01:00'] as CivilTime[] })],
      routines: [
        routine({
          itemId: 'r1',
          occurrenceKey: 'r1',
          dueOn: TODAY,
          timeOfDay: '04:00' as CivilTime,
        }),
      ],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
      dayStartsAtHour: 3,
    });

    const byId = new Map(merged.map((r) => [r.id.replace('routine:', '').split('@')[0], r]));
    /*
     * Both move, and for different reasons — which is the thing worth pinning.
     * The chore is before the *household* break at 3, so it fires tomorrow
     * morning. The routine is before the *routine day's* own 05:00 origin, so it
     * fires tomorrow morning too, by a rule that predates the household break
     * and does not consult it.
     */
    expect(byId.get('c1')?.onDate).toBe(addDays(TODAY, 1));
    expect(byId.get('r1')?.onDate).toBe(addDays(TODAY, 1));

    // And the merged order is chronological across the two sources, which is
    // what the quota then slices.
    const order = merged
      .filter((r) => r.id.startsWith('c1') || r.id.startsWith('routine:r1'))
      .map((r) => `${r.onDate}T${r.atTime}`);
    expect([...order].sort()).toEqual(order);
  });

  it('leaves both where they were when the day starts at midnight', () => {
    const merged = planAllReminders({
      chores: [chore({ occurrenceKey: 'c1', dueOn: TODAY, timesOfDay: ['01:00'] as CivilTime[] })],
      routines: [
        routine({
          itemId: 'r1',
          occurrenceKey: 'r1',
          dueOn: TODAY,
          timeOfDay: '04:00' as CivilTime,
        }),
      ],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
      dayStartsAtHour: 0,
    });

    const byId = new Map(merged.map((r) => [r.id.replace('routine:', '').split('@')[0], r]));
    // The chore stays put: at midnight nothing is before the break.
    expect(byId.get('c1')?.onDate).toBe(TODAY);
    // The routine still moves — 04:00 is before its own 05:00 origin, which is
    // a separate boundary and not the household's. The two are independent, and
    // this is what that looks like.
    expect(byId.get('r1')?.onDate).toBe(addDays(TODAY, 1));
  });
});
