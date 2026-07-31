/**
 * Planning reminders.
 *
 * Pure, and in `core` for the usual reason: the interesting failures here are
 * arithmetic, not plumbing. "Never remind me about something I already did",
 * "never exceed the cap", "the cap keeps the *nearest* ones" — all of those are
 * properties over a list, and none of them need a device to check.
 *
 * The scheduling itself lives behind a transport (see `src/data/notifications`).
 * This decides *what* to schedule and *when* each one fires; something else
 * decides how. See docs/decisions/ADR-0005-local-notifications-first.md.
 */

import { addDays, compareCivil, toEpochDay } from '../civil/date';
import type { CivilDate, CivilTime } from '../civil/types';
import type { ProjectedOccurrence } from '../occurrence/types';

/**
 * iOS keeps at most 64 pending local notifications per app and silently drops
 * the rest. Sixty leaves headroom for the keep-alive and for anything a future
 * feature schedules, because being at the limit means the next thing scheduled
 * displaces something without saying so.
 */
export const MAX_PENDING = 60;

/**
 * Identifier for the keep-alive, so it can be recognised and replaced.
 *
 * Prefixed distinctly because it is the one scheduled item that is not an
 * occurrence — anything matching on occurrence keys must not pick it up.
 */
export const KEEP_ALIVE_ID = 'keepalive:v1';

/** Default reminder time when a chore does not name one. */
export const DEFAULT_REMINDER_TIME = '09:00' as CivilTime;

export interface ReminderPolicy {
  /** Off entirely. Everything else here is irrelevant when false. */
  readonly enabled: boolean;
  /** When a chore has no `timeOfDay` of its own. */
  readonly defaultTime: CivilTime;
  /**
   * Remind about chores that are nobody's in particular.
   *
   * Off by default in a shared house: two phones both buzzing about the same
   * unassigned job is how people learn to ignore the app.
   */
  readonly includeUnassigned: boolean;
  /** How many days ahead to plan. Bounded so the queue cannot run away. */
  readonly horizonDays: number;
}

export const DEFAULT_POLICY: ReminderPolicy = {
  enabled: true,
  defaultTime: DEFAULT_REMINDER_TIME,
  includeUnassigned: false,
  horizonDays: 30,
};

export interface PlannedReminder {
  /**
   * Stable across replans, so re-planning updates in place rather than
   * producing a second notification for the same thing. It is the occurrence
   * key, which is already deterministic and already unique.
   */
  readonly id: string;
  readonly choreId: string;
  readonly title: string;
  readonly body: string;
  readonly onDate: CivilDate;
  readonly atTime: CivilTime;
}

export interface PlanInput {
  readonly occurrences: readonly ProjectedOccurrence[];
  readonly today: CivilDate;
  /** Whose device this is. Only their chores are planned — see below. */
  readonly userId: string;
  readonly policy: ReminderPolicy;
}

/**
 * Which occurrences deserve a reminder, and when.
 *
 * Only the current user's. A local notification can only fire on the device
 * that scheduled it, so planning somebody else's chores would produce reminders
 * on the wrong phone — and there is no mechanism here to reach theirs. That is
 * the main thing remote push buys, and it waits.
 */
export function planReminders(input: PlanInput): readonly PlannedReminder[] {
  const { policy, today, userId } = input;
  if (!policy.enabled) return [];

  const horizonEnd = addDays(today, Math.max(0, policy.horizonDays));

  const candidates = input.occurrences.filter((occ) => {
    // Done, skipped, or moved out of sight: nothing to remind about. A reminder
    // for something already ticked off is the fastest way to teach someone that
    // this app's notifications are noise.
    if (occ.status === 'completed' || occ.status === 'skipped') return false;
    if (occ.displaced) return false;

    // Never remind about the past. An overdue chore is already visible on
    // Today, and a notification about last Tuesday helps nobody.
    if (compareCivil(occ.dueOn, today) < 0) return false;
    if (compareCivil(occ.dueOn, horizonEnd) > 0) return false;

    if (occ.assignee.kind === 'member') return occ.assignee.memberId === userId;
    if (occ.assignee.kind === 'anyone') return policy.includeUnassigned;
    // `unassignable` — a rotation with no roster covering this date. There is
    // nobody to tell.
    return false;
  });

  const planned = candidates.map((occ): PlannedReminder => ({
    id: occ.occurrenceKey,
    choreId: occ.choreId,
    title: occ.choreTitle,
    body: bodyFor(occ),
    onDate: occ.dueOn,
    atTime: occ.timeOfDay ?? policy.defaultTime,
  }));

  /**
   * Sorted by when it fires, then truncated — so the cap keeps the *nearest*
   * reminders rather than an arbitrary subset. Getting this backwards would
   * silently drop tomorrow's reminder in favour of one three weeks out, and
   * nothing on screen would show it.
   */
  return [...planned]
    .sort(
      (a, b) =>
        toEpochDay(a.onDate) - toEpochDay(b.onDate) ||
        a.atTime.localeCompare(b.atTime) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_PENDING);
}

/**
 * What the notification says.
 *
 * Deliberately plain. "Dishes" and "due today" is the whole message; a chore
 * reminder that tries to be charming is a chore reminder people turn off.
 *
 * Note there is no comparison against `today`. A reminder fires **on** the date
 * it is planned for, so by the time anybody reads this, that date *is* today —
 * whatever it was when the plan was made. The first version compared the two
 * and so labelled everything more than a day out "Due tomorrow", which is the
 * text that would then arrive on the morning it was actually due. The tests
 * only covered offsets 0 and 1, which is exactly the range where that is
 * invisible.
 */
function bodyFor(occ: ProjectedOccurrence): string {
  const flexible = occ.flexibleFrom !== occ.flexibleUntil;
  return flexible ? 'Due sometime this period' : 'Due today';
}

/**
 * A reminder whose only job is to get the app opened before the queue runs dry.
 *
 * ADR-0005 specifies this and the first implementation quietly omitted it,
 * which left one real failure mode: local notifications are scheduled by the
 * app, so if nobody opens the app, nothing tops the queue back up. A week away
 * is fine — the horizon is thirty days. A month away is not: the queue drains,
 * reminders stop, and nothing anywhere says why.
 *
 * It is placed just before the *last* planned reminder rather than at the far
 * end of the horizon, so it arrives while there is still something left to
 * rescue. Returns null when there is nothing to keep alive.
 */
export function keepAliveFor(
  planned: readonly PlannedReminder[],
  policy: ReminderPolicy,
): PlannedReminder | null {
  if (!policy.enabled) return null;
  const last = planned[planned.length - 1];
  if (last === undefined) return null;

  return {
    id: KEEP_ALIVE_ID,
    choreId: '',
    title: 'Chorus',
    body: 'Open the app to keep your reminders coming.',
    // A day before the queue empties. Cutting it finer would risk the reminder
    // and the drain landing on the same day.
    onDate: addDays(last.onDate, -1),
    atTime: policy.defaultTime,
  };
}
