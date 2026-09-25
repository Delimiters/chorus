/**
 * Telling the server where this phone is.
 *
 * Runs once per signed-in session, near the app shell, and does nothing at all
 * on a device that cannot receive a push. It is separate from `useReminders`
 * on purpose: that hook owns the *local* queue and replans constantly, while
 * this writes one row and stops.
 *
 * ── Why the permission prompt is not asked for here ───────────────────────
 *
 * `useReminders` already asks, because local reminders are the feature people
 * turned notifications on for. Asking a second time from a second place is how
 * an app ends up prompting on launch for something the person already granted
 * — so this only *reads* the decision. With permission refused there is no
 * token to fetch and nothing to register, which is the correct outcome rather
 * than a special case.
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useUserId } from '@/stores/sessionStore';

import { registerPushToken } from '../api/pushTokens';
import { notificationsAvailable } from '../notifications';

/**
 * The Expo project this build belongs to.
 *
 * `getExpoPushTokenAsync` needs it explicitly in a bare build — it is only
 * inferred inside Expo Go — and getting it wrong yields a token addressed to
 * somebody else's project, which fails silently at send time rather than here.
 */
const PROJECT_ID = '5f10c62d-c21b-461b-b4a2-197403f80e4e';

/** The token this device last registered, so sign-out can delete the right row. */
let currentToken: string | null = null;

export function lastRegisteredPushToken(): string | null {
  return currentToken;
}

export function usePushRegistration(): void {
  const userId = useUserId();
  /*
   * Once per session. `getExpoPushTokenAsync` is a network call to Expo, and
   * the effect's dependencies settle several times during a cold start.
   */
  const doneFor = useRef<string | null>(null);

  useEffect(() => {
    if (!notificationsAvailable || userId === null) return;
    if (doneFor.current === userId) return;
    doneFor.current = userId;

    void (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;

        const { data: token } = await Notifications.getExpoPushTokenAsync({
          projectId: PROJECT_ID,
        });
        currentToken = token;

        await registerPushToken({
          userId,
          token,
          platform: Platform.OS === 'android' ? 'android' : 'ios',
          deviceName: Device.deviceName ?? null,
        });
      } catch {
        /*
         * Swallowed deliberately. A device that fails to register is a device
         * that will not get remote pushes — it is not a reason to interrupt
         * somebody opening the app, and the next launch tries again.
         *
         * This is also the ordinary path on the simulator, which has no APNs
         * registration at all and throws rather than returning a token.
         */
        doneFor.current = null;
      }
    })();
  }, [userId]);
}
