/**
 * How the app feels in the hand.
 *
 * Most of what "satisfying" means for a checkbox is a tick you can feel, and
 * `expo-haptics` is already a dependency, so this is close to free. It is also
 * the only feedback channel this app is allowed to use: no sound, ever, because
 * somebody might be at work or in bed and one bad surprise gets an app muted
 * for good.
 *
 * Every call is fire-and-forget and swallows its own errors. A haptic is a
 * nicety; a rejected promise crashing a completion would not be.
 */

import * as Haptics from 'expo-haptics';

/** Ticking something off. The twenty-times-a-week one, so it stays light. */
export function tapped(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** The last item on the plan. Heavier, and earned. */
export function finished(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/**
 * A day worth marking — the loud tier.
 *
 * Two beats rather than one long buzz: a pattern reads as deliberate where a
 * single heavy thump reads as an error. iOS has no way to express this
 * directly, so it is two successes a beat apart.
 */
export function celebrated(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  setTimeout(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, 140);
}
