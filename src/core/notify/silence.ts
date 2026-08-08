/**
 * Why a chore's reminder would never reach you.
 *
 * Two defaults that are each right on their own combine into silence: a new
 * chore is assigned to "anyone", and the reminder policy excludes unassigned
 * chores so both phones do not buzz about the same job. The result is that a
 * chore created entirely with defaults is never reminded about, and setting a
 * time on it does nothing and says nothing.
 *
 * The planner is not wrong — it does exactly what its filter says. What was
 * missing is any way for a screen to explain the outcome *before* the person
 * waits for a notification that was never scheduled. This is that explanation,
 * kept pure so it can be tested against the same policy the planner uses.
 *
 * It answers about the *chore*, from its assignment, rather than about a
 * resolved occurrence — a form has no occurrences yet. So it is deliberately
 * approximate in one direction: for a rotation it asks whether you are ever on
 * the roster, not whether you happen to own the next turn.
 */

import type { Assignment } from '../rotation/types';
import type { ReminderPolicy } from './plan';

export type ReminderSilence =
  /** Reminders are switched off entirely on this device. */
  | 'off'
  /** Nobody owns it, and unassigned chores are excluded. */
  | 'unassigned'
  /** It belongs to somebody else, and other people's chores are excluded. */
  | 'someone-else';

/**
 * Null when a reminder would reach you, otherwise the reason it would not.
 */
export function whyNoReminder(input: {
  readonly assignment: Assignment;
  readonly userId: string;
  readonly policy: ReminderPolicy;
}): ReminderSilence | null {
  const { assignment, userId, policy } = input;

  if (!policy.enabled) return 'off';

  switch (assignment.kind) {
    case 'anyone':
      return policy.includeUnassigned ? null : 'unassigned';

    case 'fixed':
      if (assignment.memberId === userId) return null;
      return policy.includeOthers ? null : 'someone-else';

    // One occurrence per member, so one of them is always yours.
    case 'everyone':
      return null;

    case 'rotate': {
      // Being on any segment means some turns are yours. Which ones is a
      // question about dates, and this is asked before any date exists.
      const onRoster = assignment.segments.some((s) => s.memberIds.includes(userId));
      if (onRoster) return null;
      return policy.includeOthers ? null : 'someone-else';
    }
  }
}

/** Something to put on screen. Phrased as what to do, not what went wrong. */
export function describeSilence(reason: ReminderSilence): string {
  switch (reason) {
    case 'off':
      return 'Reminders are off for this phone. Turn them on in Settings.';
    case 'unassigned':
      return 'Nobody is assigned, so this will not remind you. Assign it to yourself, or turn on “Also unassigned chores” in Settings.';
    case 'someone-else':
      return 'This is someone else’s, so it will not remind you. Turn on “Also everyone else’s chores” in Settings if you want it to.';
  }
}
