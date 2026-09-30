/**
 * The week, as a grid: one row per chore, one column per day.
 *
 * Jake: *"a chore chart that just has the list of chores and when they were due
 * that week and whether they got done or not, maybe also allow you to check off
 * chores from an earlier day in there in case you did it and just forgot to
 * check it off and don't want to reset the cycle onto the wrong day."*
 *
 * The second half of that is the load-bearing part, and it is handled outside
 * this module: ticking a cell records `completedOn` as **the cell's own day**
 * rather than today, because `anchorToCompletion` restarts an `every N days`
 * interval from the completion date. What this module does is make each cell
 * carry the occurrence and the date it belongs to, so the caller has both
 * without re-deriving either.
 *
 * Every other screen answers "what should I do now". This one answers "what did
 * this week look like", which is why it is a grid rather than a list and why it
 * does **not** collapse superseded misses: a daily chore missed on Monday and
 * done on Tuesday is two different cells, and merging them is precisely the
 * information the chart exists to show.
 *
 * Pure: `today` and the week's first day both arrive as parameters.
 */

import { addDays, compareCivil } from '../civil/date';
import type { CivilDate } from '../civil/types';
import type { AgendaItem } from '../occurrence/agenda';

/** How a single day's box reads. */
export type CellState =
  /** The chore was not due that day. */
  | 'none'
  /** Due, and done. */
  | 'done'
  /** Due, and deliberately skipped. */
  | 'skipped'
  /** Due today, still outstanding. */
  | 'today'
  /** Past, and never done. */
  | 'missed'
  /** Still to come. */
  | 'ahead';

export interface ChartCell {
  readonly date: CivilDate;
  readonly state: CellState;
  /**
   * The occurrences due that day — plural because an `everyone` chore fans out
   * to one per person, and both are independently completable.
   *
   * Empty exactly when `state` is `'none'`.
   */
  readonly items: readonly AgendaItem[];
  /**
   * Your own occurrence on that day, or null when none of them is yours.
   *
   * This is what a tap acts on, and it exists because `items[0]` was wrong in a
   * way that was invisible until somebody worked out the ordering. An
   * `everyone` chore fans out to one occurrence per person, and the projector's
   * last sort key is the subject's **user id** — so `items[0]` is the same
   * person for every fan-out chore in the household, forever. For the housemate
   * whose id sorts second, every shared box tapped somebody else's share: the
   * write hit a duplicate `occurrence_key`, was swallowed as idempotent, and
   * the box never changed. A silent no-op, every time.
   */
  readonly target: AgendaItem | null;
  /**
   * What a tap does: record a completion, undo one, or nothing.
   *
   * Derived here rather than at the row, because "tappable" is three
   * conditions — the day is not in the future, the chore was due, and **the
   * occurrence in question is yours** — and a screen that recomputed them would
   * be a second copy of this rule. The first version documented the third
   * condition in this comment and did not implement it, which is the exact
   * shape AGENTS.md warns about.
   */
  readonly tap: 'complete' | 'undo' | null;
}

export interface ChartRow {
  readonly choreId: string;
  readonly choreTitle: string;
  readonly cells: readonly ChartCell[];
  /** Done out of due, for the week. Skipped counts as neither. */
  readonly done: number;
  readonly due: number;
}

/** Seven days from `weekStart`. */
export function weekDays(weekStart: CivilDate): readonly CivilDate[] {
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(weekStart, offset));
}

function stateOf(items: readonly AgendaItem[], date: CivilDate, today: CivilDate): CellState {
  if (items.length === 0) return 'none';

  /*
   * A fan-out cell is only "done" when everybody has done their share. The
   * alternative — done if anybody has — would show a green box on a day one
   * person still owes work, which is the opposite of what a chart is for.
   */
  if (items.every((item) => item.status === 'completed')) return 'done';
  if (items.every((item) => item.status === 'skipped')) return 'skipped';

  const order = compareCivil(date, today);
  if (order > 0) return 'ahead';
  if (order === 0) return 'today';
  return 'missed';
}

/**
 * Which of a day's occurrences is yours to tick.
 *
 * A chore with no fan-out has one occurrence and no subject, and it is
 * everybody's. A fan-out chore has one per person, and only your own is yours —
 * ticking your housemate's share from a grid, with no indication whose box it
 * was, is the wrong default and in practice did not even work.
 */
function ownItem(items: readonly AgendaItem[], userId: string | null): AgendaItem | null {
  return items.find((item) => item.subject === null || item.subject === userId) ?? null;
}

/**
 * What a tap does, decided from **your own** occurrence rather than the cell.
 *
 * So a day where your housemate has done their share and you have not still
 * offers you a tick, and a day where you have done yours and they have not
 * offers you an undo — even though the cell as a whole reads as outstanding.
 */
function tapOf(own: AgendaItem | null, date: CivilDate, today: CivilDate): ChartCell['tap'] {
  if (own === null) return null;
  // A completion in the future did not happen.
  if (compareCivil(date, today) > 0) return null;

  switch (own.status) {
    case 'completed':
      return 'undo';
    /*
     * A skipped occurrence is a decision somebody made, and un-skipping is a
     * different action from completing — it lives on the occurrence sheet,
     * where there is room to explain it.
     */
    case 'skipped':
      return null;
    case 'due':
    case 'overdue':
    case 'upcoming':
      return 'complete';
  }
}

/**
 * Build the grid.
 *
 * `items` is the **uncollapsed** projection — `useOccurrences(...).items`, not
 * `.agenda`. Passing the collapsed agenda would drop every superseded miss,
 * which is most of what a past week contains.
 *
 * Occurrences outside the seven days are ignored rather than clamped, so a
 * caller can hand over a wider window without the edges folding into Monday.
 * A `displaced` occurrence is dropped: its real date is elsewhere.
 *
 * Rows are chores with at least one occurrence in the week, ordered by title.
 * A chore that was not due at all does not get an empty row — seven blank
 * boxes are noise, and the full list of chores is one tap away on House.
 */
export function weekChart(
  items: readonly AgendaItem[],
  options: {
    readonly weekStart: CivilDate;
    readonly today: CivilDate;
    /** Who is looking. Decides which share of a fan-out chore a tap acts on. */
    readonly userId: string | null;
  },
): readonly ChartRow[] {
  const { weekStart, today, userId } = options;
  const days = weekDays(weekStart);
  const weekEnd = days[6] as CivilDate;

  const byChore = new Map<string, { title: string; items: AgendaItem[] }>();

  for (const item of items) {
    if (item.displaced) continue;
    if (compareCivil(item.dueOn, weekStart) < 0 || compareCivil(item.dueOn, weekEnd) > 0) continue;

    const existing = byChore.get(item.choreId);
    if (existing === undefined) {
      byChore.set(item.choreId, { title: item.choreTitle, items: [item] });
    } else {
      existing.items.push(item);
    }
  }

  const rows: ChartRow[] = [];

  for (const [choreId, { title, items: mine }] of byChore) {
    const cells = days.map<ChartCell>((date) => {
      const onDay = mine.filter((item) => item.dueOn === date);
      const state = stateOf(onDay, date, today);
      const target = ownItem(onDay, userId);
      return { date, state, items: onDay, target, tap: tapOf(target, date, today) };
    });

    rows.push({
      choreId,
      choreTitle: title,
      cells,
      done: cells.filter((cell) => cell.state === 'done').length,
      due: cells.filter((cell) => cell.state !== 'none' && cell.state !== 'skipped').length,
    });
  }

  /*
   * By title, and by id to break a tie. Two chores can share a name — the
   * household is not stopped from having two "Bins" — and `Array.sort` is
   * stable per spec but the *input* order is a Map's insertion order, which
   * depends on the query's row order. Sorting on a second key makes the screen
   * redraw the same way every time.
   */
  return rows.sort(
    (a, b) =>
      a.choreTitle.localeCompare(b.choreTitle) ||
      (a.choreId < b.choreId ? -1 : a.choreId > b.choreId ? 1 : 0),
  );
}

/** Done out of due across the whole week, for the header. */
export function weekTotals(rows: readonly ChartRow[]): {
  readonly done: number;
  readonly due: number;
} {
  return {
    done: rows.reduce((sum, row) => sum + row.done, 0),
    due: rows.reduce((sum, row) => sum + row.due, 0),
  };
}
