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

import { useEffect, useRef } from 'react';
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
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Lifted clear of the add button and the tab bar. */
  bottomInset?: number;
}

export function Toast({ message, actionLabel, onAction, onDismiss, bottomInset = 0 }: ToastProps) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

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

    const timer = setTimeout(() => dismiss.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message, actionLabel, opacity]);

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
    </Animated.View>
  );
}
