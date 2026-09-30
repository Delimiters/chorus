import type { AgendaItem } from '../occurrence/agenda';
import type { CivilDate } from '../civil/types';

import { weekChart, weekDays, weekTotals, type CellState } from './week';

/** Whoever is looking at the chart. Their own share is the one a tap acts on. */
const ME = 'me';
const THEM = 'them';

const MONDAY = '2026-09-28' as CivilDate;
const TUESDAY = '2026-09-29' as CivilDate;
const WEDNESDAY = '2026-09-30' as CivilDate;
const THURSDAY = '2026-10-01' as CivilDate;
const SUNDAY = '2026-10-04' as CivilDate;
const TODAY = WEDNESDAY;

/**
 * An occurrence with only the fields the chart reads.
 *
 * Deliberately built by hand rather than run through the projector: the chart
 * is a fold over whatever the projector produced, and a fixture that went
 * through the real expander would make it hard to state the case being tested.
 */
function occ(over: {
  choreId?: string;
  choreTitle?: string;
  dueOn: CivilDate;
  status?: AgendaItem['status'];
  subject?: string | null;
  displaced?: boolean;
}): AgendaItem {
  const choreId = over.choreId ?? 'c1';
  const subject = over.subject ?? null;
  return {
    choreId,
    choreTitle: over.choreTitle ?? 'Dishes',
    occurrenceKey: `v1:${choreId}:${over.dueOn}:0:${subject ?? '-'}`,
    dueOn: over.dueOn,
    status: over.status ?? 'due',
    subject,
    timesOfDay: [],
    assignee: { kind: 'anyone' },
    completedOn: over.status === 'completed' ? over.dueOn : null,
    completedBy: over.status === 'completed' ? 'me' : null,
    daysLate: 0,
    rescheduled: false,
    originalDueOn: null,
    displaced: over.displaced ?? false,
    missedBefore: 0,
    daysOverdue: 0,
    occurrenceIndex: 0,
    periodKey: over.dueOn,
    slot: 0,
    // A fixed date, so the flexible window is the day itself. The chart reads
    // `dueOn` and nothing else about timing — but these are spelled out rather
    // than cast away, so a change to `AgendaItem` shows up here as a type error
    // instead of as a silently wrong fixture.
    showFrom: over.dueOn,
    flexibleFrom: over.dueOn,
    flexibleUntil: over.dueOn,
  };
}

const states = (
  rows: readonly { cells: readonly { state: CellState }[] }[],
  row = 0,
): CellState[] => (rows[row]?.cells ?? []).map((cell) => cell.state);

describe('weekDays', () => {
  it('is seven days from the start', () => {
    expect(weekDays(MONDAY)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });
});

describe('what each box says', () => {
  it('reads the past, today and the future differently', () => {
    const rows = weekChart(
      [
        occ({ dueOn: TUESDAY }),
        occ({ dueOn: WEDNESDAY }),
        occ({ dueOn: THURSDAY }),
        occ({ dueOn: SUNDAY, status: 'completed' }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(states(rows)).toEqual(['none', 'missed', 'today', 'ahead', 'none', 'none', 'done']);
  });

  it('marks a skipped day as skipped rather than missed', () => {
    const rows = weekChart([occ({ dueOn: TUESDAY, status: 'skipped' })], {
      weekStart: MONDAY,
      today: TODAY,
      userId: ME,
    });

    expect(states(rows)[1]).toBe('skipped');
  });

  /*
   * The non-vacuous case for the fan-out rule. One person done and one not must
   * not read as done — with a single occurrence per cell, `every` and `some`
   * agree, and this is the only fixture that separates them.
   */
  it('is not done until everybody on a shared day has done their share', () => {
    const rows = weekChart(
      [
        occ({ dueOn: TUESDAY, subject: ME, status: 'completed' }),
        occ({ dueOn: TUESDAY, subject: THEM, status: 'due' }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(states(rows)[1]).toBe('missed');
    expect(rows[0]?.cells[1]?.items).toHaveLength(2);
  });

  it('is done when everybody on a shared day has', () => {
    const rows = weekChart(
      [
        occ({ dueOn: TUESDAY, subject: ME, status: 'completed' }),
        occ({ dueOn: TUESDAY, subject: THEM, status: 'completed' }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(states(rows)[1]).toBe('done');
  });
});

describe('what can be tapped', () => {
  it('offers a tick on a missed day and on today, and an undo on a done one', () => {
    const rows = weekChart(
      [
        occ({ dueOn: TUESDAY }),
        occ({ dueOn: WEDNESDAY }),
        occ({ dueOn: THURSDAY }),
        occ({ dueOn: MONDAY, status: 'completed' }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect((rows[0]?.cells ?? []).map((cell) => cell.tap)).toEqual([
      'undo',
      'complete',
      'complete',
      null,
      null,
      null,
      null,
    ]);
  });

  /*
   * The defect that made a fan-out chore untickable for one of the two people.
   *
   * `items[0]` is not "yours" — the projector's last sort key is the subject's
   * user id, so it is the same person for every fan-out chore forever. For the
   * housemate whose id sorts second, every shared box tapped the other
   * person's share: a duplicate `occurrence_key`, swallowed as idempotent, and
   * a box that never changed.
   *
   * `them` sorts after `me`, so `items[0]` here is `me`'s completed share.
   * Looking as `them`, the tap must offer a tick on their own outstanding one.
   */
  it('offers you a tick on a shared day your housemate has already done', () => {
    const items = [
      occ({ dueOn: TUESDAY, subject: ME, status: 'completed' }),
      occ({ dueOn: TUESDAY, subject: THEM, status: 'due' }),
    ];

    const asThem = weekChart(items, { weekStart: MONDAY, today: TODAY, userId: THEM });
    expect(asThem[0]?.cells[1]?.tap).toBe('complete');
    expect(asThem[0]?.cells[1]?.target?.subject).toBe(THEM);

    // And the person who has already done theirs is offered the undo, not a
    // second tick of work they have finished.
    const asMe = weekChart(items, { weekStart: MONDAY, today: TODAY, userId: ME });
    expect(asMe[0]?.cells[1]?.tap).toBe('undo');
    expect(asMe[0]?.cells[1]?.target?.subject).toBe(ME);
  });

  it('offers nothing when a shared day holds no share of yours', () => {
    const rows = weekChart([occ({ dueOn: TUESDAY, subject: THEM })], {
      weekStart: MONDAY,
      today: TODAY,
      userId: ME,
    });

    expect(rows[0]?.cells[1]?.tap).toBeNull();
    expect(rows[0]?.cells[1]?.target).toBeNull();
  });

  it('treats an unshared chore as everybody’s, whoever is looking', () => {
    const rows = weekChart([occ({ dueOn: TUESDAY })], {
      weekStart: MONDAY,
      today: TODAY,
      userId: 'somebody-else-entirely',
    });

    expect(rows[0]?.cells[1]?.tap).toBe('complete');
  });

  it('offers nothing on a skipped day', () => {
    const rows = weekChart([occ({ dueOn: TUESDAY, status: 'skipped' })], {
      weekStart: MONDAY,
      today: TODAY,
      userId: ME,
    });

    expect(rows[0]?.cells[1]?.tap).toBeNull();
  });
});

describe('which rows appear', () => {
  it('leaves out a chore that was not due at all, rather than showing seven blanks', () => {
    const rows = weekChart([occ({ choreId: 'c1', dueOn: TUESDAY })], {
      weekStart: MONDAY,
      today: TODAY,
      userId: ME,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.choreId).toBe('c1');
  });

  it('ignores an occurrence outside the week rather than folding it into an edge', () => {
    const rows = weekChart(
      [occ({ dueOn: '2026-09-27' as CivilDate }), occ({ dueOn: '2026-10-05' as CivilDate })],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(rows).toEqual([]);
  });

  it('ignores a displaced occurrence, whose real date is elsewhere', () => {
    const rows = weekChart([occ({ dueOn: TUESDAY, displaced: true })], {
      weekStart: MONDAY,
      today: TODAY,
      userId: ME,
    });

    expect(rows).toEqual([]);
  });

  it('orders rows by title', () => {
    const rows = weekChart(
      [
        occ({ choreId: 'c2', choreTitle: 'Windows', dueOn: TUESDAY }),
        occ({ choreId: 'c1', choreTitle: 'Bins', dueOn: TUESDAY }),
        occ({ choreId: 'c3', choreTitle: 'Hoover', dueOn: TUESDAY }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(rows.map((row) => row.choreTitle)).toEqual(['Bins', 'Hoover', 'Windows']);
  });

  /*
   * Two chores really can share a name, and the input order is a Map's
   * insertion order — which follows the query's row order. Without the second
   * sort key the two rows could swap between renders.
   */
  it('breaks a tie on two chores with the same name, so the order is stable', () => {
    const build = (ids: readonly string[]) =>
      weekChart(
        ids.map((id) => occ({ choreId: id, choreTitle: 'Bins', dueOn: TUESDAY })),
        { weekStart: MONDAY, today: TODAY, userId: ME },
      ).map((row) => row.choreId);

    expect(build(['b', 'a'])).toEqual(['a', 'b']);
    expect(build(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('keeps every occurrence of one chore on its own row', () => {
    const rows = weekChart(
      [
        occ({ dueOn: MONDAY, status: 'completed' }),
        occ({ dueOn: TUESDAY }),
        occ({ dueOn: WEDNESDAY }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(rows).toHaveLength(1);
    expect(states(rows)).toEqual(['done', 'missed', 'today', 'none', 'none', 'none', 'none']);
  });
});

describe('the counts', () => {
  it('counts done out of due, with skipped in neither', () => {
    const rows = weekChart(
      [
        occ({ dueOn: MONDAY, status: 'completed' }),
        occ({ dueOn: TUESDAY, status: 'skipped' }),
        occ({ dueOn: WEDNESDAY }),
        occ({ dueOn: THURSDAY }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(rows[0]?.done).toBe(1);
    expect(rows[0]?.due).toBe(3);
  });

  it('adds up across rows for the header', () => {
    const rows = weekChart(
      [
        occ({ choreId: 'c1', choreTitle: 'Bins', dueOn: MONDAY, status: 'completed' }),
        occ({ choreId: 'c2', choreTitle: 'Dishes', dueOn: TUESDAY, status: 'completed' }),
        occ({ choreId: 'c2', choreTitle: 'Dishes', dueOn: WEDNESDAY }),
      ],
      { weekStart: MONDAY, today: TODAY, userId: ME },
    );

    expect(weekTotals(rows)).toEqual({ done: 2, due: 3 });
  });

  it('is zero and zero for an empty week', () => {
    expect(weekTotals(weekChart([], { weekStart: MONDAY, today: TODAY, userId: ME }))).toEqual({
      done: 0,
      due: 0,
    });
  });
});
