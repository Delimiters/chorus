import { describe, expect, it } from '@jest/globals';

import type { CivilDate } from '@/core/civil/types';
import type { AgendaItem } from '@/core/occurrence/agenda';
import type { OccurrenceStatus } from '@/core/occurrence/types';
import type { PlannedItem } from '@/core/plan/plan';

import { activityState, widgetSnapshot, type WidgetSnapshot } from './snapshot';

const d = (s: string) => s as CivilDate;
const DAY = d('2026-10-22');
const WRITTEN = '2026-10-22T18:00:00.000Z';

const ALICE = 'alice-id';
const BOB = 'bob-id';
const INKS = {
  [ALICE]: { light: '#1E3A9E', dark: '#7C93FF' },
  [BOB]: { light: '#C2185B', dark: '#FF8FC2' },
};

/** A planned row, with only the fields this projection reads. */
const row = (
  key: string,
  title: string,
  opts: { status?: OccurrenceStatus; member?: string | null; position?: number } = {},
): PlannedItem<AgendaItem> => {
  const { status = 'due', member = null, position = 1 } = opts;
  return {
    position,
    item: {
      choreId: key.split(':')[0] ?? key,
      occurrenceKey: key,
      choreTitle: title,
      status,
      assignee:
        member === null ? { kind: 'anyone' } : { kind: 'member', memberId: member, turn: 0 },
      // Nothing below is read by the projection; present so the fixture is a
      // real AgendaItem rather than a cast, which is what would let a field
      // rename pass silently.
      occurrenceIndex: 0,
      dueOn: DAY,
      periodKey: '2026-10-22',
      slot: 0,
      subject: member,
      flexibleFrom: DAY,
      flexibleUntil: DAY,
      showFrom: null,
      timesOfDay: [],
      completedOn: null,
      completedBy: null,
      daysLate: 0,
      rescheduled: false,
      originalDueOn: null,
      displaced: false,
      missedBefore: 0,
      daysOverdue: 0,
    },
  };
};

describe('the widget snapshot', () => {
  it("keeps the plan's own order rather than sorting by anything of its own", () => {
    /*
     * Titles deliberately contradict the alphabet and the keys contradict
     * both. If this projection sorted by anything at all, the expected order
     * is the one thing it could not produce.
     */
    const snapshot = widgetSnapshot(
      [row('c:1', 'Zebra'), row('a:1', 'Apple'), row('b:1', 'Mango')],
      DAY,
      INKS,
      WRITTEN,
    );

    expect(snapshot.rows.map((r) => r.title)).toEqual(['Zebra', 'Apple', 'Mango']);
  });

  it('addresses each row by its occurrence key, not its chore id', () => {
    const snapshot = widgetSnapshot(
      [row('dishes:2026-10-22:0:-', 'Dishes'), row('litter:2026-10-22:0:-', 'Litter')],
      DAY,
      INKS,
      WRITTEN,
    );

    expect(snapshot.rows.map((r) => r.id)).toEqual([
      'dishes:2026-10-22:0:-',
      'litter:2026-10-22:0:-',
    ]);
  });

  it('counts completed and skipped as done, and nothing else', () => {
    const snapshot = widgetSnapshot(
      [
        row('a:1', 'Done', { status: 'completed' }),
        row('b:1', 'Skipped', { status: 'skipped' }),
        row('c:1', 'Due', { status: 'due' }),
        row('d:1', 'Overdue', { status: 'overdue' }),
        row('e:1', 'Upcoming', { status: 'upcoming' }),
      ],
      DAY,
      INKS,
      WRITTEN,
    );

    expect(snapshot.rows.map((r) => r.done)).toEqual([true, true, false, false, false]);
    expect(snapshot.doneCount).toBe(2);
    expect(snapshot.totalCount).toBe(5);
  });

  it('gives each member their own ink', () => {
    /*
     * Two different members with two different hexes. One shared accent would
     * make this pass against `inkByMember[rows[0].memberId]` — the
     * fixture-shares-one-value shape from WHERE-THINGS-STAND.md.
     */
    const snapshot = widgetSnapshot(
      [row('a:1', 'Mine', { member: ALICE }), row('b:1', 'Theirs', { member: BOB })],
      DAY,
      INKS,
      WRITTEN,
    );

    expect(snapshot.rows.map((r) => r.ink)).toEqual(['#1E3A9E', '#C2185B']);
    expect(snapshot.rows.map((r) => r.inkDark)).toEqual(['#7C93FF', '#FF8FC2']);
  });

  it('leaves shared work and departed members without an ink', () => {
    const snapshot = widgetSnapshot(
      [row('a:1', 'Anyone'), row('b:1', 'Ghost', { member: 'deleted-account' })],
      DAY,
      INKS,
      WRITTEN,
    );

    expect(snapshot.rows.map((r) => r.ink)).toEqual([null, null]);
    expect(snapshot.rows.map((r) => r.inkDark)).toEqual([null, null]);
  });

  it('carries the day and the write time through untouched', () => {
    const snapshot = widgetSnapshot([], DAY, INKS, WRITTEN);
    expect(snapshot).toMatchObject({ day: DAY, writtenAt: WRITTEN, totalCount: 0, doneCount: 0 });
  });
});

describe('what the Live Activity says', () => {
  const planOf = (...rows: readonly PlannedItem<AgendaItem>[]): WidgetSnapshot =>
    widgetSnapshot(rows, DAY, INKS, WRITTEN);

  it('is about the first unfinished row, not the first row', () => {
    const state = activityState(
      planOf(
        row('a:1', 'Already done', { status: 'completed', member: ALICE }),
        row('b:1', 'Next up', { member: BOB }),
        row('c:1', 'After that'),
      ),
    );

    expect(state).toEqual({
      title: 'Next up',
      occurrenceKey: 'b:1',
      remaining: 2,
      total: 3,
      ink: '#C2185B',
      inkDark: '#FF8FC2',
    });
  });

  it('counts what is left, not what there is', () => {
    const state = activityState(
      planOf(
        row('a:1', 'One', { status: 'completed' }),
        row('b:1', 'Two', { status: 'skipped' }),
        row('c:1', 'Three'),
        row('d:1', 'Four'),
      ),
    );

    expect(state?.remaining).toBe(2);
    expect(state?.total).toBe(4);
  });

  it('is nothing at all once the plan is finished', () => {
    expect(
      activityState(
        planOf(
          row('a:1', 'One', { status: 'completed' }),
          row('b:1', 'Two', { status: 'skipped' }),
        ),
      ),
    ).toBeNull();
  });

  it('is nothing at all when there is no plan', () => {
    expect(activityState(planOf())).toBeNull();
  });
});
