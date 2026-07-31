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
 * the rest. Sixty leaves headroom for the keep-alive below and for anything a
 * future feature schedules, because being at the limit means the next thing
 * scheduled displaces something without saying so.
 */
export const MAX_PENDING = 60;

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
    body: bodyFor(occ, today),
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
 */
function bodyFor(occ: ProjectedOccurrence, today: CivilDate): string {
  const flexible = occ.flexibleFrom !== occ.flexibleUntil;
  if (flexible) return 'Sometime this week';
  return compareCivil(occ.dueOn, today) === 0 ? 'Due today' : 'Due tomorrow';
}

/**
 * True when the queue is close enough to the cap that some reminders were
 * dropped — the settings screen says so rather than letting people wonder.
 */
export function planWasTruncated(
  planned: readonly PlannedReminder[],
  candidatesConsidered: number,
): boolean {
  return candidatesConsidered > planned.length;
}
