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
 * field. `contract.test.ts` fails if the two stop agreeing.
 */

import { flaggedFirst } from '../chore/flag';
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
  /**
   * ISO 8601, UTC. **Not displayed** — it is here for a human reading the file
   * while debugging.
   *
   * A `string` on both sides, and `targets/plan/Snapshot.swift` explains why at
   * length: it was a Swift `Date` with `.iso8601` decoding, which rejects the
   * three fractional digits `toISOString()` always emits. Every snapshot failed
   * to decode and the widget showed "Open Chorus" forever.
   */
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
 * The one chore the persistent card is about — and whether to have one at all.
 *
 * **Only a chore that asked.** The first version raised a card whenever
 * anything was outstanding, which put a permanent box on the lock screen for
 * an ordinary day. Jake: *"it shouldn't just always have a focus box it should
 * be something you check for certain chores"*. `insistChoreIds` is the set
 * whose `nagUntilDone` is on — the same switch, and the same set, that the
 * reminder ladder uses. One checkbox, one meaning: insist on this until it is
 * done.
 *
 * **Flagged ones first.** A flag is the "this matters now" signal, raised by
 * hand today, against a switch that is a standing property of the chore — so
 * when both apply, the flag decides. Jake: *"the persistent notification
 * should prioritize flagged chores"*. Anybody's flag counts, which is the rule
 * everywhere else in the app: flagged means flagged, not flagged-by-me.
 *
 * It reuses `flaggedFirst` rather than sorting here, because that function is
 * a **stable partition** and this list is already in the user's own plan order.
 * A second ordering with its own idea of precedence is how two views of one
 * list end up disagreeing — and re-sorting would throw away the order they
 * built deliberately. Within the flagged group, and within the unflagged one,
 * plan order survives.
 *
 * Derived from `planned` rather than from a `WidgetSnapshot`, deliberately.
 * Both views come from the projector's output and neither from the other: that
 * is the `useOccurrences.ts:152` archetype, where one derived view was computed
 * from another and the rule it implemented went inert while type-checking
 * perfectly. It also keeps `choreId` out of the snapshot, which the widget has
 * no use for — an unused field in that contract is what `writtenAt` already
 * cost once.
 *
 * The counts still describe the **whole** plan: "2 of 5 done · 3 left" is the
 * useful context, and a card counting only insistent chores would disagree
 * with the app on the same screen.
 */
export function activityState(
  planned: readonly PlannedItem<AgendaItem>[],
  inkByMember: InkByMember,
  insistChoreIds: ReadonlySet<string>,
  flaggedChoreIds: ReadonlySet<string>,
): ActivityState | null {
  const outstanding = planned
    .filter(({ item }) => !isFinished(item.status) && insistChoreIds.has(item.choreId))
    .map(({ item }) => item);

  const next = flaggedFirst(outstanding, flaggedChoreIds)[0];
  if (next === undefined) return null;

  const done = planned.filter(({ item }) => isFinished(item.status)).length;
  const assignee = next.assignee;
  const ink = assignee.kind === 'member' ? (inkByMember[assignee.memberId] ?? null) : null;

  return {
    title: next.choreTitle,
    occurrenceKey: next.occurrenceKey,
    remaining: planned.length - done,
    total: planned.length,
    ink: ink?.light ?? null,
    inkDark: ink?.dark ?? null,
  };
}
