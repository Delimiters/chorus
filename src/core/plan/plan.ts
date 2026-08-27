/**
 * The day you have committed to, as opposed to the work that exists.
 *
 * Chorus has always been able to answer "what is due". It has never been able
 * to answer "what am I doing today", and those are different objects. Emily
 * said it plainly: *"you have 20 things due today that aren't possible to do in
 * 1 day so i just close the app"*. Fifty true statements and no decision is not
 * a to-do list, it is a report.
 *
 * A plan is a small, ordered, dated set of commitments. It is not a filter over
 * the backlog and not a saved view — it is a separate thing you make, which is
 * why it lives in its own table and its own module.
 *
 * ── Two rules that keep it a plan ─────────────────────────────────────────
 *
 * **It is per-day and never inherits.** The obvious move is to carry unfinished
 * items into tomorrow. Do not: a plan that inherits becomes a backlog again
 * within a fortnight, which is the exact failure being fixed, wearing a new
 * name. Anything not done simply stops being planned; it keeps its due date,
 * its lateness and its flag, and tomorrow's proposal ranks it first. The plan
 * is bounded *by construction* rather than by discipline, which is what makes
 * it survive a bad week — and a bad week is when it most needs to still be five
 * things.
 *
 * **It holds occurrences, not chores.** "Water the plants" recurs; the thing
 * you commit to is Thursday's watering. Keying by `occurrenceKey` means
 * planning today's says nothing about tomorrow's, and it is the same key
 * completions, exceptions and subtask ticks already use.
 *
 * Pure, `Date`-free, and knows nothing about the database.
 */

import { compareCivil } from '../civil/date';
import type { CivilDate } from '../civil/types';

/** One commitment: an occurrence, on a day, in an order. */
export interface PlanEntry {
  readonly occurrenceKey: string;
  readonly choreId: string;
  /** The day this was planned *for*, which is not necessarily when it was added. */
  readonly plannedFor: CivilDate;
  /**
   * Where it sits in the day.
   *
   * A float rather than an integer so a drag can land between two neighbours by
   * averaging them, without renumbering everything below — the same reason
   * routine items use one. Ties are broken by key so the order is total.
   */
  readonly position: number;
}

/** Anything that can be planned. The screen's rows carry much more. */
export interface Plannable {
  readonly occurrenceKey: string;
  readonly choreId: string;
  readonly status: string;
}

export interface PlannedItem<T extends Plannable> {
  readonly item: T;
  readonly position: number;
}

/**
 * Today's plan, in order, matched against the occurrences that actually exist.
 *
 * Entries whose occurrence has gone are dropped rather than rendered as
 * ghosts. That happens for real reasons: the chore was archived, its schedule
 * was edited, or the occurrence was rescheduled to another day and its key
 * changed. A planned row with nothing behind it cannot be ticked, so showing it
 * would be offering an action that does nothing.
 */
export function planFor<T extends Plannable>(
  entries: readonly PlanEntry[],
  on: CivilDate,
  available: readonly T[],
): readonly PlannedItem<T>[] {
  const byKey = new Map(available.map((item) => [item.occurrenceKey, item]));

  const planned: PlannedItem<T>[] = [];
  for (const entry of entries) {
    if (entry.plannedFor !== on) continue;
    const item = byKey.get(entry.occurrenceKey);
    if (item === undefined) continue;
    planned.push({ item, position: entry.position });
  }

  return planned.sort(
    (a, b) => a.position - b.position || a.item.occurrenceKey.localeCompare(b.item.occurrenceKey),
  );
}

/**
 * Where a new entry goes: after everything already planned.
 *
 * Added things land at the bottom rather than the top. Something you have just
 * chosen is not automatically more urgent than what you chose a minute ago, and
 * a list that reorders itself around every addition is one you cannot build up
 * deliberately.
 */
export function nextPosition(entries: readonly PlanEntry[], on: CivilDate): number {
  let highest = 0;
  for (const entry of entries) {
    if (entry.plannedFor !== on) continue;
    if (entry.position > highest) highest = entry.position;
  }
  return highest + 1;
}

/** How the day is going. */
export interface PlanProgress {
  readonly total: number;
  readonly done: number;
  /** True only when there is a plan *and* all of it is finished. */
  readonly finished: boolean;
}

/**
 * Counted, so the screen can say "2 of 5" and know when to celebrate.
 *
 * `finished` is false for an empty plan, deliberately. A backlog can never say
 * "you're done"; a plan can, and that is most of the reason it exists — but
 * having planned nothing is not an achievement, and congratulating someone for
 * it would make the moment worthless on the days it is earned.
 */
export function progressOf<T extends Plannable>(planned: readonly PlannedItem<T>[]): PlanProgress {
  let done = 0;
  for (const { item } of planned) {
    if (item.status === 'completed' || item.status === 'skipped') done += 1;
  }
  return { total: planned.length, done, finished: planned.length > 0 && done === planned.length };
}

/**
 * Yesterday's unfinished plan, for tomorrow's proposal to rank first.
 *
 * Read rather than carried. Nothing is written when a day ends — the entries
 * for a past day simply stop being today's, which is what "never inherits"
 * means in practice.
 */
export function unfinishedBefore<T extends Plannable>(
  entries: readonly PlanEntry[],
  on: CivilDate,
  available: readonly T[],
): readonly T[] {
  const byKey = new Map(available.map((item) => [item.occurrenceKey, item]));
  const out: T[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (compareCivil(entry.plannedFor, on) >= 0) continue;
    if (seen.has(entry.occurrenceKey)) continue;
    const item = byKey.get(entry.occurrenceKey);
    if (item === undefined) continue;
    if (item.status === 'completed' || item.status === 'skipped') continue;
    seen.add(entry.occurrenceKey);
    out.push(item);
  }
  return out;
}
