/**
 * What the app leaves on disk for the widget and the Live Activity to read.
 *
 * A widget runs in its own process and cannot execute this code, so it cannot
 * ask the engine what is due. It reads a flat projection written into the
 * shared App Group container — the answer the app already computed, written
 * down.
 *
 * Deliberately a projection and not a database: no schedules, no rules, no
 * rotation, no dates to compare. Anything clever on the other side of that file
 * would be a second scheduler living in Swift, and the two would drift — which
 * is the failure `docs/POSTMORTEM-SWIFT.md` exists to describe.
 *
 * Pure, `Date`-free, and shaped to match `targets/plan/Snapshot.swift` field for
 * field. `snapshot.contract.test.ts` fails if the two stop agreeing.
 */

import type { CivilDate } from '../civil/types';
import type { PlannedItem } from '../plan/plan';
import type { AgendaItem } from '../occurrence/agenda';

/** One row, as the widget draws it. */
export interface WidgetRow {
  /**
   * The occurrence key.
   *
   * What a tick is addressed to, and unique per day. Not the chore id: the same
   * chore tomorrow is a different thing to tick, and sending a chore id would
   * reintroduce exactly the identity-key mistake that caused four bugs in
   * October — see `docs/WHERE-THINGS-STAND.md`.
   */
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  /**
   * Hex for whoever it belongs to, on the paper ground; null for shared work.
   */
  readonly ink: string | null;
  /**
   * The same person's ink on the night ground.
   *
   * Both, because a widget renders in the *viewer's* theme and nothing here
   * knows which that is. `src/design/inks.ts` is explicit that the dark variant
   * is hand-lifted rather than algorithmically shifted — "the blue that reads
   * confidently on paper goes muddy against a near-black ground" — so sending
   * one hex and letting Swift darken it would undo the only reason the palette
   * is curated.
   */
  readonly inkDark: string | null;
}

export interface WidgetSnapshot {
  /** The household day this describes. */
  readonly day: CivilDate;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly rows: readonly WidgetRow[];
  /** ISO 8601, UTC. Shown by the widget when it is old enough to matter. */
  readonly writtenAt: string;
}

/** Each member's ink, both grounds. Anything missing reads as shared work. */
export type InkByMember = Readonly<Record<string, { light: string; dark: string }>>;

const isFinished = (status: string): boolean => status === 'completed' || status === 'skipped';

/**
 * The plan, flattened.
 *
 * Takes what `planFor` already ordered rather than re-deriving it, so the
 * widget's order is the screen's order by construction. Deriving a second
 * ordering here is the `useOccurrences.ts:152` shape: two views of one list,
 * one of them computed from the wrong thing and type-checking fine.
 */
export function widgetSnapshot(
  planned: readonly PlannedItem<AgendaItem>[],
  day: CivilDate,
  inkByMember: InkByMember,
  writtenAt: string,
): WidgetSnapshot {
  const rows = planned.map(({ item }): WidgetRow => {
    const assignee = item.assignee;
    const ink = assignee.kind === 'member' ? (inkByMember[assignee.memberId] ?? null) : null;
    return {
      id: item.occurrenceKey,
      title: item.choreTitle,
      done: isFinished(item.status),
      ink: ink?.light ?? null,
      inkDark: ink?.dark ?? null,
    };
  });

  return {
    day,
    doneCount: rows.filter((row) => row.done).length,
    totalCount: rows.length,
    rows,
    writtenAt,
  };
}

/** What the Live Activity's card says, or null when there should not be one. */
export interface ActivityState {
  readonly title: string;
  readonly occurrenceKey: string;
  readonly remaining: number;
  readonly total: number;
  readonly ink: string | null;
  readonly inkDark: string | null;
}

/**
 * The one chore the persistent card is about.
 *
 * The first unfinished row in the plan's own order, which is the next thing you
 * said you would do — not the most overdue, and not an arbitrary pick. The plan
 * is an ordering the user built deliberately; second-guessing it on the lock
 * screen would make the order they chose meaningless.
 *
 * Null when there is nothing left, and the caller ends the activity. A card
 * reading "0 left" is a card whose own existence contradicts it.
 */
export function activityState(snapshot: WidgetSnapshot): ActivityState | null {
  const next = snapshot.rows.find((row) => !row.done);
  if (next === undefined) return null;

  return {
    title: next.title,
    occurrenceKey: next.id,
    remaining: snapshot.totalCount - snapshot.doneCount,
    total: snapshot.totalCount,
    ink: next.ink,
    inkDark: next.inkDark,
  };
}
