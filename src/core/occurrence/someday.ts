/**
 * Undated chores, as rows something can actually be done to.
 *
 * A Someday chore (`rule.kind === 'unscheduled'`) expands to nothing — that is
 * the whole point of it, and `expand.ts` returns `[]` for one. The consequence
 * nobody had followed through: with no occurrence there is no row, with no row
 * there is no sheet, and with no sheet there is no way to flag it, read its
 * notes, or see it anywhere except the Chores library.
 *
 * Emily, having moved her chores to no-date: *"so if you take off the due
 * date, you can't flag it — and it doesn't show up on upcoming."* Both true,
 * and the second was contradicted by the Upcoming tab's own docblock, which
 * claimed the list was "late, due within thirty days, **or undated**". It never
 * was.
 *
 * So the rows are synthesised here rather than in a screen. Two screens already
 * build their own version of this — the plan picker uses a throwaway
 * `someday:{id}` key it never writes — and a third copy would be a third
 * definition of what an undated chore looks like.
 *
 * ── The key is the real one ───────────────────────────────────────────────
 *
 * `somedayKeyOf` is what `useToggleSomeday` writes when you tick one off on the
 * Chores tab. Using it here rather than a synthetic string is what makes the
 * two screens agree: tick it in one place and it is ticked in the other,
 * because it is the same row in `chore_completions`.
 *
 * ── What it is not ────────────────────────────────────────────────────────
 *
 * These are not scheduled work and must never be treated as such. They carry
 * `dueOn = on` because the column is not nullable and "due whenever you get to
 * it" is the honest reading, **not** because they are due today. Nothing here
 * goes through `autoPlannable`, so flagging an undated chore marks it without
 * putting it on the plan — it is not due or late, and it never will be.
 */

import type { CivilDate } from '../civil/types';
import { somedayKeyOf, SOMEDAY_PERIOD_KEY } from '../recurrence/period';
import type { AgendaItem } from './agenda';

/** The little a Someday row needs to know about its chore. */
export interface SomedayChore {
  readonly id: string;
  readonly title: string;
  readonly scheduleKind: string;
}

/** When an undated chore was finished, if it was. */
export interface SomedayCompletion {
  readonly choreId: string;
  readonly completedOn: CivilDate;
  readonly completedBy: string | null;
}

/**
 * One row per undated chore, completed ones included.
 *
 * Completed rows are kept rather than filtered: the caller decides whether to
 * show them, and dropping them here would make "I just ticked that" look like
 * the row vanished — the disappearing-row complaint this app has had twice.
 */
export function somedayAgenda(
  chores: readonly SomedayChore[],
  completions: readonly SomedayCompletion[],
  on: CivilDate,
): readonly AgendaItem[] {
  const done = new Map<string, SomedayCompletion>();
  for (const completion of completions) {
    const held = done.get(completion.choreId);
    // The latest one wins. A Someday chore has a single occurrence key, so
    // there should only ever be one — but a duplicate must not decide the row
    // by arrival order.
    if (held === undefined || completion.completedOn > held.completedOn) {
      done.set(completion.choreId, completion);
    }
  }

  return chores
    .filter((chore) => chore.scheduleKind === 'unscheduled')
    .map((chore): AgendaItem => {
      const completion = done.get(chore.id) ?? null;
      return {
        choreId: chore.id,
        choreTitle: chore.title,
        occurrenceKey: somedayKeyOf(chore.id),
        occurrenceIndex: 0,
        dueOn: completion?.completedOn ?? on,
        periodKey: SOMEDAY_PERIOD_KEY,
        slot: 0,
        subject: null,
        timesOfDay: [],
        status: completion === null ? 'due' : 'completed',
        // Never a turn. A chore with no date has no rotation to be part of,
        // and claiming one would put a name on work nobody was assigned.
        assignee: { kind: 'anyone' },
        completedOn: completion?.completedOn ?? null,
        completedBy: completion?.completedBy ?? null,
        daysLate: 0,
        /*
         * A one-day window ending where it starts, which is what every other
         * non-floating occurrence carries. An undated chore is not "flexible"
         * in the sense the plan means — flexible work is due *sometime this
         * week* — so widening this would put it under the "this week" heading
         * as though it had a deadline.
         */
        flexibleFrom: completion?.completedOn ?? on,
        flexibleUntil: completion?.completedOn ?? on,
        showFrom: null,
        rescheduled: false,
        originalDueOn: null,
        displaced: false,
        missedBefore: 0,
        // Zero, always. An undated chore cannot be late for a date it does not
        // have, and showing "59 days overdue" on one would be a reproach for
        // missing a deadline nobody set.
        daysOverdue: 0,
      };
    });
}
