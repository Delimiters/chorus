import { describe, expect, it } from '@jest/globals';

import type { CivilDate } from '@/core/civil/types';
import type { AgendaItem } from '@/core/occurrence/agenda';
import type { OccurrenceStatus } from '@/core/occurrence/types';
import type { PlannedItem } from '@/core/plan/plan';

import { activityState, widgetSnapshot } from './snapshot';

const d = (s: string) => s as CivilDate;
const DAY = d('2026-10-22');
const WRITTEN = '2026-10-22T18:00:00.000Z';

const ALICE = 'alice-id';
const BOB = 'bob-id';
const NO_FLAGS: ReadonlySet<string> = new Set();

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
  const NAGS = new Set(['nag']);
  const NONE = NO_FLAGS;

  it('is about the first unfinished chore that asked to insist', () => {
    const state = activityState(
      [
        row('nag:0', 'Already done', { status: 'completed', member: ALICE }),
        row('quiet:1', 'Not insistent', { member: BOB }),
        row('nag:1', 'Next up', { member: BOB }),
        row('nag:2', 'After that'),
      ],
      INKS,
      NAGS,
      NONE,
    );

    /*
     * Deliberately not the first unfinished row — that is `quiet:1`, which did
     * not ask. A test whose only unfinished row was also the insistent one
     * would pass with the `insistChoreIds` check deleted.
     */
    expect(state).toEqual({
      title: 'Next up',
      occurrenceKey: 'nag:1',
      remaining: 3,
      total: 4,
      ink: '#C2185B',
      inkDark: '#FF8FC2',
    });
  });

  /*
   * These use one chore per row — `a:1`, `b:1`, `c:1` — because `row()` derives
   * `choreId` from the key's prefix. The first version of these tests used
   * `nag:1/nag:2/nag:3`, so every row shared the chore id `nag`, flagging one
   * flagged all three, and the assertions passed while proving nothing about
   * priority. Exactly the fixture-shares-one-value shape this file's own
   * comments warn about.
   */
  const THREE = new Set(['a', 'b', 'c']);

  it('prefers a flagged chore over the one that is merely next', () => {
    /*
     * A flag is raised by hand, today; the switch is a standing property of
     * the chore. When both apply the flag decides. Jake: "the persistent
     * notification should prioritize flagged chores".
     *
     * The flagged chore is deliberately *last* in plan order, so plan order
     * alone could not produce this answer.
     */
    const plan = [
      row('a:1', 'Next in the plan'),
      row('b:1', 'After that'),
      row('c:1', 'Flagged', { member: BOB }),
    ];

    expect(activityState(plan, INKS, THREE, new Set(['c']))?.title).toBe('Flagged');
    // And with nothing flagged, it is plan order again.
    expect(activityState(plan, INKS, THREE, NO_FLAGS)?.title).toBe('Next in the plan');
  });

  it('keeps plan order within the flagged ones', () => {
    /*
     * A stable partition, not a sort.
     *
     * The flagged pair is in plan order `c` then `b`, which *contradicts*
     * their chore-id order. A version of this test with them the other way
     * round stayed green when the partition was replaced by a sort on chore
     * id, because plan order and id order agreed — proving the partition held
     * the flagged ones at the front, and nothing about their order within it.
     */
    const plan = [
      row('a:1', 'Unflagged but first'),
      row('c:1', 'Flagged earlier in the plan'),
      row('b:1', 'Flagged later in the plan'),
    ];

    const state = activityState(plan, INKS, THREE, new Set(['b', 'c']));
    expect(state?.title).toBe('Flagged earlier in the plan');
  });

  it('ignores a flag on a chore that did not ask to insist', () => {
    /*
     * Flagging does not by itself put a card on the lock screen — the switch
     * still decides whether there is one at all. Prioritising is an ordering
     * among candidates, not a second way in.
     */
    const plan = [row('a:1', 'Flagged but quiet'), row('b:1', 'Insistent')];

    const state = activityState(plan, INKS, new Set(['b']), new Set(['a']));
    expect(state?.title).toBe('Insistent');
  });

  it('skips a flagged chore that is already done', () => {
    const plan = [
      row('a:1', 'Flagged and done', { status: 'completed' }),
      row('b:1', 'Still outstanding'),
    ];

    const state = activityState(plan, INKS, THREE, new Set(['a']));
    expect(state?.title).toBe('Still outstanding');
  });

  it('is nothing at all when nothing outstanding asked to insist', () => {
    /*
     * The whole point of the switch. An ordinary day has outstanding chores and
     * should put no permanent box on the lock screen.
     */
    expect(
      activityState([row('quiet:1', 'Dishes'), row('quiet:2', 'Litter')], INKS, NAGS, NONE),
    ).toBeNull();
  });

  it('counts the whole plan, not just the chores that asked', () => {
    const state = activityState(
      [
        row('quiet:1', 'One', { status: 'completed' }),
        row('quiet:2', 'Two', { status: 'skipped' }),
        row('quiet:3', 'Three'),
        row('nag:1', 'Four'),
      ],
      INKS,
      NAGS,
      NONE,
    );

    // Two done of four, two left — the card agrees with the app's own count.
    expect(state?.remaining).toBe(2);
    expect(state?.total).toBe(4);
    expect(state?.title).toBe('Four');
  });

  it('is nothing at all once the insistent chore is done', () => {
    expect(
      activityState(
        [row('nag:1', 'One', { status: 'completed' }), row('quiet:1', 'Two')],
        INKS,
        NAGS,
        NONE,
      ),
    ).toBeNull();
  });

  it('is nothing at all when there is no plan', () => {
    expect(activityState([], INKS, NAGS, NONE)).toBeNull();
  });
});

describe('the two derived views', () => {
  /*
   * `widgetSnapshot` and `activityState` are two functions over the same
   * `planned` list, and each holds its own copy of the same three expressions:
   * what counts as finished, what order rows are in, and how a member's ink is
   * resolved. Nothing but this makes them agree, and a row the widget calls
   * done while the card calls it outstanding is the shape this project keeps
   * hitting — `useOccurrences.ts:152` is the archetype.
   */
  const plan = [
    row('nag:0', 'Done', { status: 'completed', member: ALICE }),
    row('quiet:1', 'Not insistent'),
    row('nag:1', 'Next up', { member: BOB }),
    row('nag:2', 'Later', { status: 'skipped' }),
  ];

  it('agree about how much is left', () => {
    const snap = widgetSnapshot(plan, DAY, INKS, WRITTEN);
    const state = activityState(plan, INKS, new Set(['nag']), NO_FLAGS);

    expect(state?.total).toBe(snap.totalCount);
    expect(state?.remaining).toBe(snap.totalCount - snap.doneCount);
  });

  it('agree about the row the card names, flagged or not', () => {
    /*
     * With a flag in play, so the agreement is checked on the path the card
     * actually takes rather than only on the unflagged one. `flaggedFirst` is
     * length-preserving, so the counts cannot move — but that is a property
     * worth pinning rather than assuming.
     */
    const snap = widgetSnapshot(plan, DAY, INKS, WRITTEN);
    const state = activityState(plan, INKS, new Set(['nag']), new Set(['nag']));
    const sameRow = snap.rows.find((r) => r.id === state?.occurrenceKey);

    expect(sameRow).toBeDefined();
    expect(sameRow?.done).toBe(false);
    expect(state?.title).toBe(sameRow?.title);
    expect(state?.ink).toBe(sameRow?.ink);
    expect(state?.inkDark).toBe(sameRow?.inkDark);
  });
});
