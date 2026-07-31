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
    if (compareCivil(positionOf(occ), today) > 0) {
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
    const sorted = [...group].sort(
      (a, b) => compareCivil(positionOf(a), positionOf(b)) || a.slot - b.slot,
    );
    const survivor = sorted[sorted.length - 1] as ProjectedOccurrence;
    const survivorAt = positionOf(survivor);

    // Floating rules put several slots on the same date; those are concurrent
    // work rather than one superseding another, so they all survive.
    const latest = sorted.filter((o) => positionOf(o) === survivorAt);
    const earlier = sorted.filter((o) => positionOf(o) !== survivorAt);

    // Only unfinished earlier occurrences count as "missed". A skipped one was a
    // decision, not a failure.
    const missedBefore = earlier.filter((o) => o.status === 'overdue' || o.status === 'due').length;

    for (const occ of latest) {
      // A displaced occurrence did its job by existing — it told us the older
      // ones are superseded. Its date is outside the window, so it is not ours
      // to render.
      if (occ.displaced) continue;
      kept.push(toAgendaItem(occ, today, missedBefore));
    }

    for (const occ of earlier) {
      if (occ.displaced) continue;
      // Completed TODAY: ticking something off should not make it vanish.
      const doneToday = occ.status === 'completed' && occ.completedOn === today;
      // Deliberately moved to today or later: somebody said "do it then", and
      // the app should not overrule them. Moved to a day that has itself already
      // passed is just another miss, and collapses like one.
      const movedHere = occ.rescheduled && compareCivil(occ.dueOn, survivorAt) >= 0;
      if (doneToday || movedHere) kept.push(toAgendaItem(occ, today, 0));
    }
  }

  // `untouched` needs the same filter as the groups above. An occurrence whose
  // position is after today but whose effective date fell before the window
  // start lands here, and would otherwise render at a date the caller never
  // asked about.
  return [
    ...kept,
    ...untouched.filter((occ) => !occ.displaced).map((occ) => toAgendaItem(occ, today, 0)),
  ].sort(
    (a, b) =>
      compareCivil(a.dueOn, b.dueOn) || a.choreTitle.localeCompare(b.choreTitle) || a.slot - b.slot,
  );
}

/**
 * Where an occurrence sits in the sequence, as opposed to where it now falls.
 *
 * For a rescheduled occurrence these differ, and supersession cares about the
 * former. Push today's dishes to Friday and yesterday's must stay superseded:
 * what supersedes an older occurrence is that a newer one *was generated*, not
 * where it subsequently ended up. Using the effective date instead let
 * yesterday's become "the latest one at or before today" and reappear — the same
 * resurrection bug as counting only outstanding occurrences, wearing a hat.
 */
function positionOf(occ: ProjectedOccurrence): CivilDate {
  return occ.originalDueOn ?? occ.dueOn;
}

/**
 * Occurrences as agenda items, with nothing collapsed away.
 *
 * For the calendar, which wants to show what the schedule actually said on each
 * past day. Collapsing is a Today-screen decision — a past occurrence there is
 * an obligation, and superseded ones are noise; on a calendar it is a record,
 * and hiding it erases the rotation hand-over the grid exists to make visible.
 *
 * `missedBefore` is zero throughout: nothing here supersedes anything.
 */
export function toAgendaItems(
  projected: readonly ProjectedOccurrence[],
  today: CivilDate,
): readonly AgendaItem[] {
  return (
    projected
      // Displaced occurrences exist only so the collapse rule can see them; their
      // dates are outside the window the caller asked for.
      .filter((occ) => !occ.displaced)
      .map((occ) => toAgendaItem(occ, today, 0))
      .sort(
        (a, b) =>
          compareCivil(a.dueOn, b.dueOn) ||
          a.choreTitle.localeCompare(b.choreTitle) ||
          a.slot - b.slot,
      )
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
}

// No `overdue` field, deliberately. Floating periods are contiguous, so a missed
// week is always replaced by the current one — "you didn't water the plants last
// week" becomes "water the plants this week", which is the intent. There is
// nothing for the flag to mean.

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
  /**
   * Skipped, and still the current occurrence of their chore.
   *
   * Shown rather than hidden, because skipping is undoable and undo has to be
   * reachable. Hiding them was a dead end found by driving the app: skip
   * something and it vanishes from Today, while Upcoming only lists from today
   * forward — so a skipped past occurrence existed in the database with no
   * screen anywhere able to show it, and "Un-skip it" could never be reached.
   */
  readonly skipped: readonly AgendaItem[];
  readonly outstandingCount: number;
  readonly doneCount: number;
}

export function buildTodayView(
  items: readonly AgendaItem[],
  today: CivilDate,
  userId: string,
): TodayView {
  /**
   * Group **before** filtering by status, not after.
   *
   * Filtering first was a bug: a group's `done` count is computed from the slots
   * it is given, so dropping the completed ones first made every floating row
   * read "0 of N", and a fully-finished chore lost its group entirely and landed
   * in Done as N identical rows — exactly the noise grouping exists to prevent.
   */
  const { floating, dated } = groupFloating(items);

  // A floating group is "mine" if its next slot is; ownership is per-occurrence.
  const isMine = (item: AgendaItem): boolean =>
    item.assignee.kind === 'anyone' ||
    (item.assignee.kind === 'member' && item.assignee.memberId === userId);

  const isOutstanding = (i: AgendaItem): boolean => i.status === 'due' || i.status === 'overdue';
  const outstandingDated = dated.filter(isOutstanding);
  const done = dated.filter((i) => i.status === 'completed' && i.completedOn === today);
  // At or before today only: a skip made in advance is not today's business.
  const skipped = dated.filter((i) => i.status === 'skipped' && compareCivil(i.dueOn, today) <= 0);

  // A finished floating group stays in its own band rather than moving to Done —
  // one struck-through row with full pips, not three rows saying the same thing.
  const floatingDoneToday = floating.reduce(
    (n, g) => n + g.slots.filter((s) => s.status === 'completed' && s.completedOn === today).length,
    0,
  );

  return {
    floating,
    mine: outstandingDated.filter(isMine),
    theirs: outstandingDated.filter((i) => !isMine(i)),
    done,
    skipped,
    outstandingCount: outstandingDated.length + floating.filter((g) => g.nextSlot !== null).length,
    doneCount: done.length + floatingDoneToday,
  };
}
