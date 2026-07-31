/**
 * The last line of defence.
 *
 * A render-time throw anywhere below this unmounts the whole tree, and without
 * a boundary React Native shows a blank screen — no message, no way back, and
 * on a release build no red box either. Given the app is two screens and a
 * list, "it went white and I had to force-quit" is the worst outcome available
 * and the cheapest to prevent.
 *
 * Deliberately a class component: `componentDidCatch` has no hook equivalent,
 * and there is no version of this that can be written with hooks today.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { palette, radius, space, type as typeScale } from './tokens';

interface Props {
  children: ReactNode;
  /** Called on a caught error, so a future crash reporter has a seam. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    /**
     * Raw React Native primitives, and the light palette unconditionally.
     *
     * Nothing here may read context. This boundary sits *above* every provider,
     * because a throw inside one of them is exactly what a nested boundary
     * could not catch — and `Txt` and `Button` both call `useTheme`, which
     * throws outside its provider. The first version of this file used them and
     * so would have crashed inside its own fallback the first time it caught
     * anything, turning a recoverable error into the blank screen it exists to
     * prevent. A test caught it; the app would have caught it later and worse.
     */
    const colors = palette.light;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.paper,
          justifyContent: 'center',
          padding: space.xl,
        }}
      >
        <ScrollView contentContainerStyle={{ gap: space.lg }}>
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header" style={{ ...typeScale.display, color: colors.text }}>
              That went wrong
            </Text>
            <Text style={{ ...typeScale.body, color: colors.textMuted }}>
              Nothing has been lost — your chores live on the server, not in this screen. Try again,
              and if it keeps happening a restart will clear it.
            </Text>
          </View>

          <Pressable
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={{
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              backgroundColor: colors.text,
            }}
          >
            <Text style={{ ...typeScale.bodyStrong, color: colors.surface }}>Try again</Text>
          </Pressable>

          {/*
            The message, verbatim and selectable.

            A support conversation that starts with the actual error is worth a
            great deal more than one that starts with "it broke", and this is a
            two-person app with no crash reporting behind it.
          */}
          <View
            style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.sunken }}
          >
            <Text style={{ ...typeScale.label, color: colors.textFaint }}>WHAT HAPPENED</Text>
            <Text selectable style={{ ...typeScale.small, color: colors.textMuted }}>
              {error.message || String(error)}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }
}
