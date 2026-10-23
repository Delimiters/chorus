/**
 * The typed face of `WidgetBridgeModule`.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module
 * exists only in a native iOS build, and the app also runs in jest and on web.
 * The hard variant throws at import time, which would take the whole app down
 * on a platform where the widget simply does not exist.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface WidgetBridge {
  /** Writes the snapshot into the App Group container. False if it could not. */
  writeSnapshot(json: string): boolean;
  /** Asks every placed widget to rebuild. */
  reloadTimelines(): void;
  /** The ticks made from the home screen. Does not clear them. */
  pendingTicks(): string[];
  /** Forgets the given keys, leaving any that arrived since. */
  acknowledgeTicks(keys: readonly string[]): void;
  /** Starts the activity, or updates the one already running for `day`. */
  showActivity(
    day: string,
    title: string,
    occurrenceKey: string,
    remaining: number,
    total: number,
    ink: string | null,
    inkDark: string | null,
  ): Promise<boolean>;
  /** Ends every running activity. */
  endActivities(): Promise<boolean>;
}

const native = requireOptionalNativeModule<WidgetBridge>('WidgetBridge');

/** Null on web and in tests, where there is no widget to talk to. */
export default native;
