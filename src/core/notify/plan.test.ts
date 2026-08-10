/**
 * The reminder planner.
 *
 * ADR-0005 names three properties this has to hold, so they are properties here
 * rather than examples: a completed occurrence never yields a reminder, the
 * output never exceeds the cap, and the cap keeps the *nearest* ones. The third
 * is the one worth having — getting the sort backwards would silently drop
 * tomorrow's reminder in favour of one three weeks out, and nothing on any
 * screen would show it.
 */

import fc from 'fast-check';

import { addDays, civilDate, compareCivil } from '../civil/date';
import type { CivilDate, CivilTime } from '../civil/types';
import type { ProjectedOccurrence } from '../occurrence/types';
import {
  DEFAULT_POLICY,
  MAX_PENDING,
  keepAliveFor,
  planReminders,
  type ReminderPolicy,
} from './plan';

const TODAY = civilDate('2026-07-30');
const ME = 'me';
const THEM = 'them';

const occ = (over: Partial<ProjectedOccurrence> = {}): ProjectedOccurrence =>
  ({
    choreId: 'dishes',
    choreTitle: 'Dishes',
    occurrenceKey: `v1:dishes:${over.dueOn ?? TODAY}:0:-`,
    dueOn: TODAY,
    flexibleFrom: over.dueOn ?? TODAY,
    flexibleUntil: over.dueOn ?? TODAY,
    periodKey: '2026-07-30',
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

const plan = (occurrences: ProjectedOccurrence[], policy: Partial<ReminderPolicy> = {}) =>
  planReminders({
    occurrences,
    today: TODAY,
    userId: ME,
    policy: { ...DEFAULT_POLICY, ...policy },
  });

describe('what earns a reminder', () => {
  it('plans a chore that is mine and still to do', () => {
    const [reminder] = plan([occ()]);
    expect(reminder?.title).toBe('Dishes');
    expect(reminder?.onDate).toBe(TODAY);
    expect(reminder?.atTime).toBe('09:00');
  });

  it('uses the chore’s own time when it has one', () => {
    const [reminder] = plan([occ({ timesOfDay: ['18:30' as CivilTime] })]);
    expect(reminder?.atTime).toBe('18:30');
  });

  it('never reminds about something already done', () => {
    expect(plan([occ({ status: 'completed', completedOn: TODAY, completedBy: ME })])).toEqual([]);
  });

  it('never reminds about something skipped', () => {
    expect(plan([occ({ status: 'skipped' })])).toEqual([]);
  });

  it('never reminds about the past', () => {
    // It is already on Today. A notification about last Tuesday helps nobody.
    expect(plan([occ({ dueOn: addDays(TODAY, -1), status: 'overdue' })])).toEqual([]);
  });

  it('never reminds about somebody else’s chore', () => {
    // A local notification can only fire on the device that scheduled it, so
    // this would put a reminder on the wrong phone if it fired at all.
    expect(plan([occ({ assignee: { kind: 'member', memberId: THEM, turn: 0 } })])).toEqual([]);
  });

  it('leaves unassigned chores alone by default', () => {
    // Two phones buzzing about the same job is how people learn to ignore an app.
    expect(plan([occ({ assignee: { kind: 'anyone' } })])).toEqual([]);
  });

  it('includes them when asked to', () => {
    expect(plan([occ({ assignee: { kind: 'anyone' } })], { includeUnassigned: true })).toHaveLength(
      1,
    );
  });

  it('says nothing when there is nobody to tell', () => {
    expect(plan([occ({ assignee: { kind: 'unassignable', reason: 'empty-roster' } })])).toEqual([]);
  });

  it('ignores an occurrence displaced out of the window', () => {
    expect(plan([occ({ displaced: true, rescheduled: true })])).toEqual([]);
  });

  it('plans nothing at all when reminders are off', () => {
    expect(plan([occ()], { enabled: false })).toEqual([]);
  });

  it('stops at the horizon', () => {
    const inside = occ({ dueOn: addDays(TODAY, 30) });
    const outside = occ({ dueOn: addDays(TODAY, 31) });
    expect(plan([inside, outside], { horizonDays: 30 })).toHaveLength(1);
  });
});

describe('what the notification says', () => {
  /**
   * The body is written for the moment it is *read*, not the moment it is
   * planned. A reminder fires on its own due date, so that date is always
   * "today" by the time anybody sees it — however far out it was when planned.
   *
   * The first version compared against plan-time `today`, so anything two or
   * more days ahead was labelled "Due tomorrow" and arrived saying so on the
   * morning it was genuinely due. The tests covered offsets 0 and 1 only, which
   * is precisely where that cannot show.
   */
  it.each([0, 1, 2, 5, 29])('says "Due today" for a chore %i days out', (offset) => {
    const due = addDays(TODAY, offset);
    const [reminder] = plan([occ({ dueOn: due, flexibleFrom: due, flexibleUntil: due })]);
    expect(reminder?.body).toBe('Due today');
  });

  it('says "sometime this period" for a floating chore, because a day would lie', () => {
    const floating = occ({
      dueOn: TODAY,
      flexibleFrom: TODAY,
      flexibleUntil: addDays(TODAY, 4),
    });
    expect(plan([floating])[0]?.body).toBe('Due sometime this period');
  });
});

describe('the identifier', () => {
  it('is the occurrence key, so replanning updates rather than duplicates', () => {
    const [first] = plan([occ()]);
    const [second] = plan([occ()]);
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toContain('dishes');
  });
});

// ── Properties ──────────────────────────────────────────────────────────────

/** Occurrences spread across the horizon, all mine and all outstanding. */
const arbOccurrences = (count: number): fc.Arbitrary<ProjectedOccurrence[]> =>
  fc.array(fc.integer({ min: 0, max: 60 }), { minLength: count, maxLength: count }).map((offsets) =>
    offsets.map((offset, i) =>
      occ({
        choreId: `chore-${i}`,
        occurrenceKey: `v1:chore-${i}:${addDays(TODAY, offset)}:0:-`,
        dueOn: addDays(TODAY, offset),
        flexibleFrom: addDays(TODAY, offset),
        flexibleUntil: addDays(TODAY, offset),
      }),
    ),
  );

describe('P — the cap', () => {
  it('never plans more than the device will hold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }).chain(arbOccurrences), (occurrences) => {
        expect(plan(occurrences, { horizonDays: 90 }).length).toBeLessThanOrEqual(MAX_PENDING);
      }),
      { numRuns: 200 },
    );
  });

  it('keeps the NEAREST ones when it has to choose', () => {
    // The property that matters. A truncation that dropped the soonest
    // reminders would be invisible: the queue would still be full, the settings
    // screen would still say reminders are on, and tomorrow's would never fire.
    fc.assert(
      fc.property(arbOccurrences(120), (occurrences) => {
        const planned = plan(occurrences, { horizonDays: 90 });
        if (planned.length < MAX_PENDING) return; // nothing was dropped

        const kept = new Set(planned.map((r) => r.id));
        const dropped = occurrences.filter((o) => !kept.has(o.occurrenceKey));
        const latestKept = planned[planned.length - 1]?.onDate as CivilDate;

        // Nothing dropped may fall before the last one kept.
        for (const d of dropped) {
          expect(compareCivil(d.dueOn, latestKept)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('is not vacuous — the generator really does exceed the cap', () => {
    // The guard the Phase 4 retrospective taught: a property over inputs that
    // never reach the interesting case proves nothing.
    //
    // The first version of this counted with a helper that could only ever
    // return true for this generator, so it could not fail — a meta-test that
    // needed a meta-test. This measures and reports, like the expander's
    // generator-coverage check does.
    let runs = 0;
    let truncated = 0;
    fc.assert(
      fc.property(arbOccurrences(120), (occurrences) => {
        runs += 1;
        if (plan(occurrences, { horizonDays: 90 }).length < occurrences.length) truncated += 1;
      }),
      { numRuns: 50 },
    );
    console.log(`cap coverage: ${((truncated / runs) * 100).toFixed(1)}% truncated`);
    expect(truncated).toBeGreaterThan(runs * 0.9);
  });

  it('is ordered by when it fires', () => {
    fc.assert(
      fc.property(arbOccurrences(40), (occurrences) => {
        const planned = plan(occurrences, { horizonDays: 90 });
        for (let i = 1; i < planned.length; i += 1) {
          const prev = planned[i - 1] as { onDate: CivilDate };
          const next = planned[i] as { onDate: CivilDate };
          expect(compareCivil(prev.onDate, next.onDate)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('floating chores', () => {
  /** "3x a week" — three occurrences sharing a due date and a period. */
  const floatingSlots = (count: number, from = TODAY, until = addDays(TODAY, 6)) =>
    Array.from({ length: count }, (_, slot) =>
      occ({
        choreId: 'gym',
        choreTitle: 'Gym',
        occurrenceKey: `v1:gym:W:${from}:${slot}:-`,
        periodKey: `W:${from}`,
        slot,
        dueOn: from,
        flexibleFrom: from,
        flexibleUntil: until,
      }),
    );

  it('plans ONE reminder for a group, not one per slot', () => {
    // Three identical notifications in the same second is the fastest way to
    // teach somebody to turn reminders off.
    const planned = plan(floatingSlots(3));
    expect(planned).toHaveLength(1);
    expect(planned[0]?.title).toBe('Gym');
  });

  it('still plans separately for different periods', () => {
    const thisWeek = floatingSlots(3);
    const nextWeek = floatingSlots(3, addDays(TODAY, 7), addDays(TODAY, 13));
    expect(plan([...thisWeek, ...nextWeek])).toHaveLength(2);
  });

  it('still plans separately per person for a fan-out chore', () => {
    const mine = floatingSlots(2).map((o) => ({
      ...o,
      subject: ME,
      occurrenceKey: `${o.occurrenceKey}:me`,
    }));
    const theirs = floatingSlots(2).map((o) => ({
      ...o,
      subject: ME,
      occurrenceKey: `${o.occurrenceKey}:x`,
      periodKey: 'W:other',
    }));
    expect(plan([...mine, ...theirs] as never)).toHaveLength(2);
  });

  it('reminds during the period, not only on the day it opens', () => {
    // A floating occurrence's `dueOn` is the period START, so comparing that
    // against today dropped the whole current week from Tuesday onward — the
    // chore got no reminder at all in the week it was due.
    const startedYesterday = floatingSlots(3, addDays(TODAY, -1), addDays(TODAY, 5));
    expect(plan(startedYesterday)).toHaveLength(1);
  });

  it('still drops a period that has closed', () => {
    const lastWeek = floatingSlots(3, addDays(TODAY, -9), addDays(TODAY, -3));
    expect(plan(lastWeek)).toEqual([]);
  });
});

describe('the keep-alive', () => {
  /**
   * The one failure mode local notifications have that nothing else covers:
   * the app schedules its own reminders, so if nobody opens the app, nothing
   * tops the queue up. A week away is fine — the horizon is thirty days. A
   * month away is not: the queue drains and reminders stop, silently.
   *
   * ADR-0005 specified this and the first implementation omitted it, while a
   * comment in this very file referred to "the keep-alive below".
   */
  it('lands a day before the queue would run dry', () => {
    const reminders = plan([
      occ({ dueOn: addDays(TODAY, 1) }),
      occ({ choreId: 'b', occurrenceKey: 'b', dueOn: addDays(TODAY, 20) }),
    ]);
    const keepAlive = keepAliveFor(reminders, DEFAULT_POLICY);
    expect(keepAlive?.onDate).toBe(addDays(TODAY, 19));
  });

  it('asks for the one thing that fixes it', () => {
    const keepAlive = keepAliveFor(plan([occ()]), DEFAULT_POLICY);
    expect(keepAlive?.body).toMatch(/open the app/i);
  });

  it('has a stable identifier that no occurrence can collide with', () => {
    const keepAlive = keepAliveFor(plan([occ()]), DEFAULT_POLICY);
    expect(keepAlive?.id).toBe('keepalive:v1');
    expect(plan([occ()]).some((r) => r.id === keepAlive?.id)).toBe(false);
  });

  it('is absent when there is nothing to keep alive', () => {
    expect(keepAliveFor([], DEFAULT_POLICY)).toBeNull();
  });

  it('is absent when reminders are off', () => {
    expect(keepAliveFor(plan([occ()]), { ...DEFAULT_POLICY, enabled: false })).toBeNull();
  });
});

describe('P — nothing already dealt with', () => {
  it('a completed or skipped occurrence never yields a reminder, whatever else is true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('completed' as const, 'skipped' as const),
        fc.integer({ min: 0, max: 60 }),
        fc.boolean(),
        (status, offset, includeUnassigned) => {
          const result = plan(
            [
              occ({
                status,
                dueOn: addDays(TODAY, offset),
                flexibleFrom: addDays(TODAY, offset),
                flexibleUntil: addDays(TODAY, offset),
                ...(status === 'completed' ? { completedOn: TODAY, completedBy: ME } : {}),
              }),
            ],
            { includeUnassigned },
          );
          expect(result).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("someone else's chores", () => {
  // The cross-device gap this softens: a local notification can tell you what
  // is *scheduled* for anyone, because your phone computes the whole
  // household's schedule itself. What it cannot do is tell you what somebody
  // just did — that needs a server, and remote push.
  const mine = occ({ choreId: 'dishes', choreTitle: 'Dishes' });
  const theirs = occ({
    choreId: 'bins',
    choreTitle: 'Bins',
    assignee: { kind: 'member', memberId: THEM, turn: 0 },
  });

  it('is silent about them by default', () => {
    expect(plan([mine, theirs]).map((r) => r.choreId)).toEqual(['dishes']);
  });

  it('includes them when asked, without dropping your own', () => {
    // Both, not instead: widening this filter could easily have replaced the
    // ownership check rather than adding to it, and the fixture would not
    // notice if it only ever contained one of the two.
    expect(
      plan([mine, theirs], { includeOthers: true })
        .map((r) => r.choreId)
        .sort(),
    ).toEqual(['bins', 'dishes']);
  });

  it('still says nothing about a rotation with nobody on it', () => {
    // `unassignable` is not "somebody else", it is nobody. Widening the
    // ownership check must not sweep it in — there is no one to tell.
    const orphan = occ({
      choreId: 'orphan',
      assignee: { kind: 'unassignable', reason: 'empty-roster' },
    });
    expect(plan([orphan], { includeOthers: true })).toEqual([]);
  });

  it('leaves the unassigned setting independent of it', () => {
    const anyones = occ({ choreId: 'anyones', assignee: { kind: 'anyone' } });
    expect(plan([anyones], { includeOthers: true })).toEqual([]);
    expect(plan([anyones], { includeUnassigned: true })).toHaveLength(1);
  });
});

describe('a chore with more than one reminder time', () => {
  it('emits one reminder per time', () => {
    const plan = planReminders({
      occurrences: [occ({ timesOfDay: ['09:00', '19:00'] as CivilTime[] })],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    expect(plan.map((r) => r.atTime)).toEqual(['09:00', '19:00']);
  });

  it('gives them distinct ids, or the second would replace the first', () => {
    // The transport schedules by identifier. Two reminders sharing the
    // occurrence key would be one notification, and the chore would quietly
    // get half of what it asked for.
    const plan = planReminders({
      occurrences: [occ({ timesOfDay: ['09:00', '19:00'] as CivilTime[] })],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    expect(new Set(plan.map((r) => r.id)).size).toBe(2);
  });

  it('keeps the bare occurrence key when there is only one time', () => {
    // So an existing pending notification is matched and updated rather than
    // cancelled and re-created under a new id on every replan.
    const [single] = planReminders({
      occurrences: [occ({ timesOfDay: ['09:00'] as CivilTime[] })],
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    expect(single?.id).not.toContain('@');
  });

  it('falls back to the device default when the chore names no time', () => {
    const plan = planReminders({
      occurrences: [occ({ timesOfDay: [] })],
      today: TODAY,
      userId: ME,
      policy: { ...DEFAULT_POLICY, defaultTime: '08:15' as CivilTime },
    });
    expect(plan.map((r) => r.atTime)).toEqual(['08:15']);
  });

  it('counts every time against the cap, not every chore', () => {
    // Two times per chore halves how many chores fit. Getting this wrong would
    // silently drop the far end of the queue rather than the near one.
    const many = Array.from({ length: 40 }, (_, i) =>
      occ({
        choreId: `c${i}`,
        dueOn: addDays(TODAY, i + 1),
        occurrenceKey: `v1:c${i}:x:0:-`,
        timesOfDay: ['09:00', '19:00'] as CivilTime[],
      }),
    );
    const plan = planReminders({
      occurrences: many,
      today: TODAY,
      userId: ME,
      policy: DEFAULT_POLICY,
    });
    expect(plan.length).toBeLessThanOrEqual(MAX_PENDING);
    // And what survives is the nearest, not an arbitrary slice.
    expect(plan[0]?.onDate).toBe(addDays(TODAY, 1));
  });
});
