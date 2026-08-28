/**
 * Chores and tasks are different animals, and the app already knows which.
 *
 * **A chore repeats.** Litter, water bowls, dishes: high volume, low stakes.
 * Missing one is fine — it comes back tomorrow, and the schedule is the whole
 * point of it.
 *
 * **A task happens once.** Car inspection, cardiologist, timesheet: low volume,
 * high stakes. Missing one *is* the failure, and it stays undone until somebody
 * does it.
 *
 * Put them in one list and the volume buries the stakes. That is exactly
 * Emily's "plant garden bed is not the same priority as car registration" —
 * fifty recurring rows with the car registration somewhere inside them.
 *
 * ── Derived, never asked ─────────────────────────────────────────────────
 *
 * A chore is `once`/`unscheduled` or it repeats, so the distinction is already
 * in the data: roughly 65 of this household's 99 are one-time. Making it a type
 * somebody picks would add a decision to every single add, forever, to produce
 * something the app can work out for itself — and then the two could disagree.
 *
 * Set a repeat and it is a chore; leave the repeat off and it is a task. One
 * switch that already exists on the form, now carrying a second meaning, and
 * changing your mind later moves it by itself.
 *
 * ── Where this is used, and where it deliberately is not ─────────────────
 *
 * It feeds the **ranking**: at equal lateness a task outranks a chore, so the
 * registration surfaces above the litter box. Separate *tabs* were considered
 * and deferred — Jake's call — because the plan already answers "what am I
 * doing today", and browsing is a different question worth living with the
 * plan before answering. Keeping the distinction here means the tabs are a
 * screen away rather than a migration away.
 *
 * A `splitByKind` helper was written for those tabs and deleted before merge:
 * twelve lines and thirty of tests with no caller, which is how this codebase
 * lost an invite screen for four phases. It is three lines to write when a
 * screen actually needs it.
 */

import type { Schedule } from '../recurrence/types';

export type ChoreKind = 'chore' | 'task';

/**
 * Which kind a schedule describes.
 *
 * `unscheduled` counts as a task alongside `once`: something with no date at
 * all — "pull out beanie babies to display" — is a one-off somebody has not
 * decided about yet, not a recurring commitment. Treating it as recurring was
 * a real bug in the first version of the proposal's ranking, where the rule
 * kind was compared against `'once'` inline and nothing else.
 */
export function kindOf(schedule: Schedule): ChoreKind {
  return schedule.rule.kind === 'once' || schedule.rule.kind === 'unscheduled' ? 'task' : 'chore';
}

/** True for the repeating half. Reads better than `kindOf(...) === 'chore'` at call sites. */
export function isRecurring(schedule: Schedule): boolean {
  return kindOf(schedule) === 'chore';
}
