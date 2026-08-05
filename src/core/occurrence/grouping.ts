/**
 * Arranging agenda rows into sections.
 *
 * The rule, chosen over true nesting:
 *
 * > **Group by one axis, sort by the other.**
 *
 * Nesting priority inside category (or the reverse) produces up to
 * `categories × priorities` sections. For a household with five categories and
 * three priorities that is fifteen possible headers over maybe twenty chores —
 * a screen that is mostly headings, most of them holding one row. Grouping by
 * one axis and sorting by the other reads almost identically and always
 * produces at most as many sections as that axis has values.
 *
 * Empty sections are never emitted. A category nobody used today should not
 * take up a line saying so.
 *
 * Pure, and deliberately ignorant of the database: categories arrive as plain
 * values and chore metadata as a lookup. Grouping is presentation, so none of
 * this reaches the expander, the projector, or rotation.
 */

import { compareCivil } from '../civil/date';
import type { CivilDate } from '../civil/types';
import {
  comparePriority,
  DEFAULT_PRIORITY,
  describePriority,
  type Priority,
} from '../chore/priority';

/** Which axis becomes section headers. */
export type GroupBy = 'category' | 'priority' | 'none';

/** How rows are ordered inside each section. */
export type SortBy = 'priority' | 'due';

/** A category, as the grouping needs it. The database row carries more. */
export interface CategoryMeta {
  readonly id: string;
  readonly name: string;
  /**
   * An ink name, or null for the theme's neutral.
   *
   * A name rather than a hex because each ink carries a light *and* a dark
   * value; the renderer resolves it per theme. See src/design/inks.ts.
   */
  readonly ink: string | null;
  /** Ascending. Ties broken by name, so the order is always total. */
  readonly position: number;
}

/** The two axes, per chore. */
export interface ChoreMeta {
  readonly categoryId: string | null;
  readonly priority: Priority;
}

export interface Section<T> {
  /** A category id, a `Priority`, `OTHER_KEY`, or `ALL_KEY`. Stable across renders. */
  readonly key: string;
  readonly title: string;
  readonly ink: string | null;
  readonly items: readonly T[];
}

/**
 * The section holding chores with no category.
 *
 * "Other" is not a row in `chore_categories` — it is the absence of one. See
 * the migration for why. It always sorts last, because a bucket for "did not
 * choose" belongs at the bottom regardless of what it is called.
 */
export const OTHER_KEY = 'other';
export const OTHER_TITLE = 'Other';

/** The single section used when grouping is off. */
export const ALL_KEY = 'all';

/**
 * The minimum an item needs for grouping to place and order it.
 *
 * `dueOn` is nullable because this runs over two different things: agenda
 * occurrences, which always have a date, and the Chores tab's list of chore
 * *definitions*, which do not — a weekly chore is not due on any one day. An
 * undated item sorts after dated ones and then falls through to its title,
 * rather than being given a fabricated date to sort by.
 */
export interface Groupable {
  readonly choreId: string;
  readonly dueOn: CivilDate | null;
  readonly choreTitle: string;
}

/** Undated sorts last; otherwise chronological. */
function compareDue(a: CivilDate | null, b: CivilDate | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compareCivil(a, b);
}

/**
 * Splits items into sections and orders them.
 *
 * Sorting is total: every comparator falls through to the chore title, so two
 * chores that agree on both axes and are due the same day still have a stable,
 * meaningful order rather than whatever the input happened to be.
 */
export function groupItems<T extends Groupable>(
  items: readonly T[],
  meta: ReadonlyMap<string, ChoreMeta>,
  categories: readonly CategoryMeta[],
  options: { readonly groupBy: GroupBy; readonly sortBy: SortBy },
): readonly Section<T>[] {
  const metaFor = (item: T): ChoreMeta =>
    meta.get(item.choreId) ?? { categoryId: null, priority: DEFAULT_PRIORITY };

  const byPriority = (a: T, b: T): number => {
    const p = comparePriority(metaFor(a).priority, metaFor(b).priority);
    if (p !== 0) return p;
    const d = compareDue(a.dueOn, b.dueOn);
    return d !== 0 ? d : a.choreTitle.localeCompare(b.choreTitle);
  };

  const byDue = (a: T, b: T): number => {
    const d = compareDue(a.dueOn, b.dueOn);
    if (d !== 0) return d;
    const p = comparePriority(metaFor(a).priority, metaFor(b).priority);
    return p !== 0 ? p : a.choreTitle.localeCompare(b.choreTitle);
  };

  const ordered = [...items].sort(options.sortBy === 'priority' ? byPriority : byDue);

  if (options.groupBy === 'none') {
    return ordered.length === 0 ? [] : [{ key: ALL_KEY, title: '', ink: null, items: ordered }];
  }

  if (options.groupBy === 'priority') {
    // Built from the items rather than from PRIORITIES so that empty levels
    // never produce a header. Order comes from the comparator below.
    const buckets = new Map<Priority, T[]>();
    for (const item of ordered) {
      const key = metaFor(item).priority;
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [item]);
      else bucket.push(item);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => comparePriority(a, b))
      .map(([priority, group]) => ({
        key: priority,
        title: describePriority(priority),
        ink: null,
        items: group,
      }));
  }

  // Category. Position ascending, name as tiebreak so the order is total even
  // if two categories somehow share a position.
  const order = [...categories].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );

  const buckets = new Map<string, T[]>();
  for (const item of ordered) {
    const { categoryId } = metaFor(item);
    // A category id pointing at something that no longer exists is treated as
    // no category. The database's `on delete set null` makes this unlikely,
    // but a stale cache can produce it for one render.
    const key =
      categoryId !== null && order.some((c) => c.id === categoryId) ? categoryId : OTHER_KEY;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [item]);
    else bucket.push(item);
  }

  const sections: Section<T>[] = [];
  for (const category of order) {
    const group = buckets.get(category.id);
    if (group !== undefined && group.length > 0) {
      sections.push({
        key: category.id,
        title: category.name,
        ink: category.ink,
        items: group,
      });
    }
  }

  const other = buckets.get(OTHER_KEY);
  if (other !== undefined && other.length > 0) {
    sections.push({ key: OTHER_KEY, title: OTHER_TITLE, ink: null, items: other });
  }

  return sections;
}
