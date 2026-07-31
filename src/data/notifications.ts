/**
 * Scheduling what the planner decided.
 *
 * The seam. `planReminders` says *what* and *when*; this says *how*, and it is
 * the only file that knows local notifications exist. Adding remote push later
 * is a second implementation of `NotificationTransport` plus a database
 * trigger — not a change to any call site. See ADR-0005.
 *
 * The reconcile below is deliberately blunt: cancel everything, schedule the
 * plan. Diffing pending notifications against a plan is a page of code whose
 * failure mode is a reminder that fires for something already done, and the
 * whole queue is at most sixty entries.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { PlannedReminder } from '@/core/notify/plan';

export interface NotificationTransport {
  /** Ask, if we have not already. Returns whether we may post notifications. */
  ensurePermission: () => Promise<boolean>;
  /** Replace every pending reminder with this plan. */
  reconcile: (plan: readonly PlannedReminder[], timeZone: string) => Promise<void>;
  cancelAll: () => Promise<void>;
}

/**
 * Turns a civil date and time into the instant a notification fires.
 *
 * This is the one place in the app allowed to build a `Date` from a due date,
 * and it is the app's edge — the operating system wants an instant, and a civil
 * date is not one. The engine stays free of both.
 *
 * `DateTriggerInput` takes a `Date`, which is interpreted in the *device's*
 * current zone. That is the right behaviour for a reminder: if you fly
 * somewhere, "09:00" should still mean nine in the morning where you are, not
 * nine o'clock back home.
 */
export function fireAt(onDate: string, atTime: string): Date {
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  const [hh, mm] = atTime.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  // `canAskAgain` false means the user said no in the OS dialog; asking again
  // does nothing and the settings screen has to send them to system settings.
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export const localTransport: NotificationTransport = {
  ensurePermission,

  async reconcile(plan) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (plan.length === 0) return;

    const now = Date.now();
    for (const reminder of plan) {
      const when = fireAt(reminder.onDate, reminder.atTime);
      // A reminder for 09:00 planned at 14:00 the same day is already past.
      // Scheduling it would fire immediately, which reads as a bug.
      if (when.getTime() <= now) continue;

      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: {
          title: reminder.title,
          body: reminder.body,
          data: { choreId: reminder.choreId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
        },
      });
    }
  },

  async cancelAll() {
    await Notifications.cancelAllScheduledNotificationsAsync();
  },
};

/**
 * How a notification behaves when the app is open.
 *
 * Set once at module load. Banners while you are already looking at the list
 * would be noise, so a foreground reminder makes no sound and shows no alert —
 * the row it refers to is on screen already.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Whether this build can schedule notifications at all.
 *
 * Expo Go dropped notification support on Android in SDK 53 and the story has
 * been narrowing since. The settings screen says so plainly rather than showing
 * a toggle that silently does nothing.
 */
export const notificationsAvailable = Platform.OS !== 'web';
