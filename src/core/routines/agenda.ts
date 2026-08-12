/**
 * Arranging a day's routine into the sections a screen shows.
 *
 * One day at a time, split by bucket, yours above everybody else's. Empty
 * buckets are never emitted — four headings over an empty screen say nothing.
 *
 * Derived from the projector's output and from nothing else. Deriving one view
 * from another is the mistake `useOccurrences` made and hid for two phases: the
 * agenda was collapsed from already-converted items, which stripped the
 * occurrences the collapse rule needed, so the whole mechanism was inert in the
 * running app while its unit tests passed. It type-checked because the second
 * type extended the first.
 */

import { compareCivil } from '../civil/date';
import type { CivilDate } from '../civil/types';
import { BUCKETS, describeBucket, type TimeBucket } from './buckets';
import type { RoutineOccurrence } from './project';

export interface PersonRoutine {
  readonly ownerId: string;
  readonly items: readonly RoutineOccurrence[];
}

export interface BucketSection {
  readonly bucket: TimeBucket;
  readonly title: string;
  /** The signed-in person's items. */
  readonly mine: readonly RoutineOccurrence[];
  /** Everybody else's, grouped by owner. Empty unless `showOthers`. */
  readonly theirs: readonly PersonRoutine[];
  /** Yours only — somebody else's progress is not your score. */
  readonly doneCount: number;
  readonly totalCount: number;
}

export interface DaySummary {
  readonly sections: readonly BucketSection[];
  readonly doneCount: number;
  readonly totalCount: number;
}

/**
 * Within a bucket: timed items in clock order, then untimed, then by title.
 *
 * Total, so the order never depends on which occurrence happened to arrive
 * first — two items at 07:00 must not swap places between renders.
 */
function byTimeThenTitle(a: RoutineOccurrence, b: RoutineOccurrence): number {
  return a.sortKey - b.sortKey || a.title.localeCompare(b.title);
}

export function bucketSections(
  occurrences: readonly RoutineOccurrence[],
  userId: string,
  options: { readonly showOthers: boolean; readonly on: CivilDate },
): DaySummary {
  // One day. The window handed to the projector is wider, because query keys
  // are quantised to whole weeks so paging within a week costs no refetch.
  const forDay = occurrences.filter((occ) => compareCivil(occ.dueOn, options.on) === 0);

  const sections: BucketSection[] = [];
  let doneCount = 0;
  let totalCount = 0;

  for (const bucket of BUCKETS) {
    const inBucket = forDay.filter((occ) => occ.bucket === bucket);
    const mine = inBucket.filter((occ) => occ.ownerId === userId).sort(byTimeThenTitle);

    const theirs: PersonRoutine[] = [];
    if (options.showOthers) {
      const owners = new Map<string, RoutineOccurrence[]>();
      for (const occ of inBucket) {
        if (occ.ownerId === userId) continue;
        const list = owners.get(occ.ownerId);
        if (list === undefined) owners.set(occ.ownerId, [occ]);
        else list.push(occ);
      }
      // Sorted by owner id so the order is stable across renders; the screen
      // shows names, which it resolves itself.
      for (const [ownerId, items] of [...owners.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        theirs.push({ ownerId, items: [...items].sort(byTimeThenTitle) });
      }
    }

    if (mine.length === 0 && theirs.length === 0) continue;

    const done = mine.filter((occ) => occ.status === 'completed').length;
    doneCount += done;
    totalCount += mine.length;

    sections.push({
      bucket,
      title: describeBucket(bucket),
      mine,
      theirs,
      doneCount: done,
      totalCount: mine.length,
    });
  }

  return { sections, doneCount, totalCount };
}
