/**
 * Turning projected occurrences into what a screen actually shows.
 *
 * Two transformations live here, both pure, and both product decisions rather
 * than scheduling ones — which is why they are separate from the projector.
 *
 * @see docs/DESIGN_SYSTEM.md
 */

import { compareCivil, daysBetween } from '../civil/date';
import type { CivilDate } from '../civil/types';
import type { ProjectedOccurrence } from './types';

/**
 * An occurrence, plus what the agenda needs to know that the engine doesn't.
 */
export interface AgendaItem extends ProjectedOccurrence {
  /**
   * How many earlier occurrences of this chore were missed and then superseded
   * by this one.
   *
   * Renders as a quiet "missed last time" on the row. Honest without turning
   * the screen into a list of reproaches.
   */
  readonly missedBefore: number;
  /** Days overdue, for display. Zero unless the status is `overdue`. */
  readonly daysOverdue: number;
}

/**
 * Collapses superseded misses.
 *
 * The rule, chosen over a fixed day-count horizon:
 *
 * > Show only the **most recent** occurrence of a recurring chore that is due or
 * > past. A one-time chore never expires.
 *
 * A one-time chore has exactly one occurrence, so "most recent" is always it and
 * it never disappears — no special case needed.
 *
 * Why this beats a horizon: it scales itself to the chore's own cadence. A daily
 * chore's miss lives a day; a monthly chore's lives a month. And there is at
 * most one overdue row per chore, so a neglected daily chore cannot put fourteen
 * rows on Today.
 *
 * Completed and skipped occurrences pass through untouched — they are history,
 * not outstanding work, and Today shows them in their own section.
 *
 * Fan-out (`everyone`) chores collapse per person, since each subject's
 * occurrences are independently completable.
 */
export function collapseSupersededMisses(
  projected: readonly ProjectedOccurrence[],
  today: CivilDate,
): readonly AgendaItem[] {
  /**
   * Everything at or before today, grouped per chore per subject.
   *
   * Note this includes COMPLETED occurrences, which an earlier version did not —
   * and that was a real bug: with only outstanding ones considered, completing
   * today's dishes made yesterday's become "the latest outstanding" and pop back
   * onto the list. What supersedes an older occurrence is the existence of a
   * newer one, not whether the newer one happens to be done.
   */
  const past = new Map<string, ProjectedOccurrence[]>();
  const untouched: ProjectedOccurrence[] = [];

  for (const occ of projected) {
    if (compareCivil(occ.dueOn, today) > 0) {
      untouched.push(occ);
      continue;
    }
    const key = `${occ.choreId}::${occ.subject ?? '-'}`;
    const bucket = past.get(key);
    if (bucket) bucket.push(occ);
    else past.set(key, [occ]);
  }

  const kept: AgendaItem[] = [];

  for (const group of past.values()) {
    const sorted = [...group].sort((a, b) => compareCivil(a.dueOn, b.dueOn) || a.slot - b.slot);
    const survivor = sorted[sorted.length - 1] as ProjectedOccurrence;

    // Floating rules put several slots on the same date; those are concurrent
    // work rather than one superseding another, so they all survive.
    const latest = sorted.filter((o) => o.dueOn === survivor.dueOn);
    const earlier = sorted.filter((o) => o.dueOn !== survivor.dueOn);

    // Only unfinished earlier occurrences count as "missed".
    const missedBefore = earlier.filter((o) => o.status === 'overdue' || o.status === 'due').length;

    for (const occ of latest) {
      kept.push(toAgendaItem(occ, today, missedBefore));
    }

    // An earlier occurrence completed TODAY still belongs in the Done section —
    // ticking something off should not make it vanish. Anything else from the
    // past is history and lives in the chore's detail, not on the agenda.
    for (const occ of earlier) {
      if (occ.status === 'completed' && occ.completedOn === today) {
        kept.push(toAgendaItem(occ, today, 0));
      }
    }
  }

  return [...kept, ...untouched.map((occ) => toAgendaItem(occ, today, 0))].sort(
    (a, b) =>
      compareCivil(a.dueOn, b.dueOn) || a.choreTitle.localeCompare(b.choreTitle) || a.slot - b.slot,
  );
}

function toAgendaItem(
  occ: ProjectedOccurrence,
  today: CivilDate,
  missedBefore: number,
): AgendaItem {
  return {
    ...occ,
    missedBefore,
    daysOverdue: occ.status === 'overdue' ? Math.max(0, daysBetween(occ.flexibleUntil, today)) : 0,
  };
}

// ── Floating chores ─────────────────────────────────────────────────────────

/**
 * A floating chore's slots, collapsed into one row.
 *
 * "3× a week, any day" produces three occurrences that share a due date. Showing
 * three identical rows would be noise; showing one row with progress is what the
 * approved design does.
 *
 * The individual occurrences are kept on `slots` because each is still
 * separately completable — ticking the row completes the next incomplete one.
 */
export interface FloatingGroup {
  readonly choreId: string;
  readonly choreTitle: string;
  readonly subject: string | null;
  /** The period this group covers. */
  readonly periodKey: string;
  readonly flexibleFrom: CivilDate;
  readonly flexibleUntil: CivilDate;
  readonly total: number;
  readonly done: number;
  /** Every slot, ordered. Ticking the row acts on the first incomplete one. */
  readonly slots: readonly AgendaItem[];
  /** The next slot to complete, or null when the group is finished. */
  readonly nextSlot: AgendaItem | null;
  /** True once the period has passed with slots outstanding. */
  readonly overdue: boolean;
}

/** True when an occurrence's completion window spans more than its due date. */
export function isFloatingItem(occ: ProjectedOccurrence): boolean {
  return occ.flexibleFrom !== occ.flexibleUntil;
}

/**
 * Splits an agenda into floating groups and ordinary dated items.
 *
 * Floating chores are rendered in a "sometime this week" band above the dated
 * rail, because they genuinely are not on a day and putting them on one would
 * make the dated list lie.
 */
export function groupFloating(items: readonly AgendaItem[]): {
  readonly floating: readonly FloatingGroup[];
  readonly dated: readonly AgendaItem[];
} {
  const groups = new Map<string, AgendaItem[]>();
  const dated: AgendaItem[] = [];

  for (const item of items) {
    if (!isFloatingItem(item)) {
      dated.push(item);
      continue;
    }
    const key = `${item.choreId}::${item.periodKey}::${item.subject ?? '-'}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const floating: FloatingGroup[] = [];
  for (const slots of groups.values()) {
    const ordered = [...slots].sort((a, b) => a.slot - b.slot);
    const first = ordered[0] as AgendaItem;
    const done = ordered.filter((s) => s.status === 'completed').length;
    const outstanding = ordered.filter((s) => s.status !== 'completed' && s.status !== 'skipped');

    floating.push({
      choreId: first.choreId,
      choreTitle: first.choreTitle,
      subject: first.subject,
      periodKey: first.periodKey,
      flexibleFrom: first.flexibleFrom,
      flexibleUntil: first.flexibleUntil,
      total: ordered.length,
      done,
      slots: ordered,
      nextSlot: outstanding[0] ?? null,
      overdue: outstanding.some((s) => s.status === 'overdue'),
    });
  }

  floating.sort((a, b) => a.choreTitle.localeCompare(b.choreTitle));
  return { floating, dated };
}

// ── Today ───────────────────────────────────────────────────────────────────

/**
 * Today, arranged as the screen shows it.
 *
 * Yours first, then everyone else's, then what has already been done — the
 * decision being that your own obligations get the top of the screen while the
 * rest stays visible, because seeing it is the point of sharing a list.
 */
export interface TodayView {
  readonly floating: readonly FloatingGroup[];
  /** Outstanding and yours — assigned to you, or unassigned so anyone can do it. */
  readonly mine: readonly AgendaItem[];
  /** Outstanding and somebody else's. */
  readonly theirs: readonly AgendaItem[];
  /** Completed today, or completed earlier and still on today's list. */
  readonly done: readonly AgendaItem[];
  readonly outstandingCount: number;
  readonly doneCount: number;
}

export function buildTodayView(
  items: readonly AgendaItem[],
  today: CivilDate,
  userId: string,
): TodayView {
  const outstanding = items.filter((i) => i.status === 'due' || i.status === 'overdue');
  const { floating, dated } = groupFloating(outstanding);

  // A floating group is "mine" if its next slot is; ownership is per-occurrence.
  const isMine = (item: AgendaItem): boolean =>
    item.assignee.kind === 'anyone' ||
    (item.assignee.kind === 'member' && item.assignee.memberId === userId);

  const done = items.filter((i) => i.status === 'completed' && i.completedOn === today);

  return {
    floating,
    mine: dated.filter(isMine),
    theirs: dated.filter((i) => !isMine(i)),
    done,
    outstandingCount: dated.length + floating.filter((g) => g.nextSlot !== null).length,
    doneCount: done.length,
  };
}
