/**
 * Keeping the home screen in step with the plan.
 *
 * Every call is a no-op that reports failure rather than throwing, because a
 * widget is an accessory: an install whose provisioning profile lacks the App
 * Group, a user who has turned Live Activities off, a phone on iOS 15, and a
 * jest run are all ordinary, and none of them should be able to break the
 * app's own rendering.
 *
 * The transport pattern — a narrow interface, a real implementation and a
 * recording fake — is the same one `notifications.ts` uses, and for the same
 * reason: the interesting logic is the projection, and it should be testable
 * without a device.
 */

import { Platform } from 'react-native';

import type { ActivityState, WidgetSnapshot } from '@/core/widget/snapshot';
/*
 * A relative path, not an alias. A local Expo module is not a package, and
 * `@/*` only covers `src/`; adding a third alias for one import would mean
 * teaching tsc, jest and Metro about it separately, and Metro's tsconfig-paths
 * support is a default rather than something this repo configures.
 */
import bridge from '../../modules/widget-bridge';

export interface WidgetTransport {
  /** Writes the snapshot and asks the widget to redraw. */
  publish(snapshot: WidgetSnapshot): boolean;
  /** Shows or updates the persistent card. */
  showActivity(day: string, state: ActivityState): Promise<boolean>;
  /** Removes the persistent card. */
  endActivity(): Promise<boolean>;
  /** Ticks made from the home screen since last asked. Clears them. */
  takePendingTicks(): readonly string[];
}

/** False on web, in jest, and on a build without the native module. */
export const widgetAvailable = Platform.OS === 'ios' && bridge !== null;

export const nativeWidget: WidgetTransport = {
  publish(snapshot) {
    if (bridge === null) return false;
    const written = bridge.writeSnapshot(JSON.stringify(snapshot));
    /*
     * Only reload when the write landed. Asking WidgetKit to redraw from a
     * file that did not change spends one of the ~40–70 reloads iOS budgets
     * per day for nothing.
     */
    if (written) bridge.reloadTimelines();
    return written;
  },

  async showActivity(day, state) {
    if (bridge === null) return false;
    return bridge.showActivity(
      day,
      state.title,
      state.occurrenceKey,
      state.remaining,
      state.total,
      state.ink,
      state.inkDark,
    );
  },

  async endActivity() {
    if (bridge === null) return false;
    return bridge.endActivities();
  },

  takePendingTicks() {
    if (bridge === null) return [];
    return bridge.takePendingTicks();
  },
};
