/**
 * A thing just happened, and it can be taken back.
 *
 * Built for one sentence in Emily's feedback — *"i accidentally checked
 * something off and it disappeared 😭"* — which is a trust failure rather than
 * a layout one. An action you cannot see the result of, and cannot reverse, is
 * an action you stop taking.
 *
 * Deliberately not a modal. It sits above the content, never over the row it is
 * about, and the screen underneath stays usable the whole time: dismissing it is
 * something you *may* do, not something you must do before carrying on.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';

import { Txt } from './components';
import { useTheme } from './theme';
import { MIN_TARGET, radius, space } from './tokens';

/**
 * Long enough to notice and reach, short enough not to loiter.
 *
 * Five seconds is the common floor for an undo affordance; below about four,
 * one-handed users reliably miss it.
 */
export const TOAST_MS = 5000;

interface ToastProps {
  /** Null hides it. Changing it restarts the clock. */
  message: string | null;
  /**
   * Draw a bar that shrinks as the time runs out.
   *
   * On when there is something to undo, off for an error. A countdown is a
   * promise that the thing goes away on its own, which is reassuring next to
   * "Undo" and misleading next to "that didn't work" — an error you have not
   * read yet should not look like it is expiring.
   */
  countdown?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Lifted clear of the add button and the tab bar. */
  bottomInset?: number;
}

export function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  bottomInset = 0,
  countdown = false,
}: ToastProps) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  /** 1 → 0 over `TOAST_MS`. Drives the bar's width. */
  const remaining = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // Held in a ref so the effect below depends on the message alone. With
  // `onDismiss` in the dependency list, a parent that re-creates the callback
  // each render would restart the timer on every render and the toast would
  // never go away.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (message === null) return;

    AccessibilityInfo.announceForAccessibility(
      actionLabel === undefined ? message : `${message}. ${actionLabel} available.`,
    );

    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }).start();

    /*
     * The bar is animated, the dismissal is a `setTimeout`, and they are not
     * the same clock — so the bar is cosmetic and the timeout is the truth. A
     * dropped frame makes the bar lag a little; it cannot make the toast
     * outlive its five seconds or vanish early.
     *
     * `useNativeDriver` is false because this animates layout width, which the
     * native driver cannot do. The alternative — `scaleX` on a full-width bar
     * — scales from the centre by default and needs a transform origin fix
     * that costs more than it saves for one thin rectangle.
     */
    remaining.setValue(1);
    if (!reduceMotion) {
      Animated.timing(remaining, {
        toValue: 0,
        duration: TOAST_MS,
        easing: (t) => t,
        useNativeDriver: false,
      }).start();
    }

    const timer = setTimeout(() => dismiss.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message, actionLabel, opacity, remaining, reduceMotion]);

  if (message === null) return null;

  return (
    <Animated.View
      // Not `accessibilityViewIsModal`: the list behind it must stay reachable,
      // both for a sighted user and for VoiceOver.
      style={{
        position: 'absolute',
        left: space.lg,
        right: space.lg,
        bottom: bottomInset + space.lg,
        opacity,
      }}
      pointerEvents="box-none"
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          backgroundColor: colors.raised,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.rule,
          paddingLeft: space.lg,
          paddingRight: actionLabel === undefined ? space.lg : space.xs,
          paddingVertical: actionLabel === undefined ? space.md : 0,
          minHeight: MIN_TARGET,
        }}
      >
        <Txt variant="small" tone="muted" numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>
          {message}
        </Txt>

        {actionLabel === undefined || onAction === undefined ? null : (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={({ pressed }) => ({
              minHeight: MIN_TARGET,
              justifyContent: 'center',
              paddingHorizontal: space.md,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Txt variant="label" style={{ color: colors.overprint }}>
              {actionLabel.toUpperCase()}
            </Txt>
          </Pressable>
        )}
      </View>

      {/*
        The time running out, as a bar that shrinks.
        
        Underneath rather than inside, so it cannot reflow the row or crowd the
        action: a 2pt rule along the bottom edge, in the same ink as the Undo
        label it belongs to. Hidden entirely under Reduce Motion — a bar whose
        whole content is movement has nothing to say when it cannot move, and
        a static full-width line would read as a progress bar that is stuck.
      */}
      {!countdown || reduceMotion ? null : (
        <View
          // Not part of the row's accessibility: VoiceOver already announces
          // the message and that an action is available, and "72 per cent"
          // would be noise.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="toast-countdown"
          style={{
            height: 2,
            marginHorizontal: space.md,
            borderBottomLeftRadius: radius.md,
            borderBottomRightRadius: radius.md,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={{
              height: 2,
              backgroundColor: colors.overprint,
              width: remaining.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            }}
          />
        </View>
      )}
    </Animated.View>
  );
}
