/**
 * The floating "add a chore" button.
 *
 * Bottom right rather than top right, and floating rather than in a header.
 * Adding a chore is the one thing you might want from anywhere in a long list,
 * and the bottom right corner is the part of a phone a thumb reaches without
 * regripping — a top-right button on a modern phone is the furthest point from
 * where your hand already is.
 *
 * It sits above the tab bar rather than over it, so it never covers a tab, and
 * it stays put while the list scrolls underneath.
 */

import { Pressable, View } from 'react-native';

import { Txt } from './components';
import { useTheme } from './theme';
import { space } from './tokens';

/** Clear of the tab bar, with a thumb's worth of margin. */
const BOTTOM_OFFSET = 92;

export function AddChoreButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();

  return (
    // `pointerEvents: box-none` on the wrapper, or an invisible full-width
    // container would swallow taps meant for the list behind it.
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: space.lg,
        bottom: BOTTOM_OFFSET,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Add a chore"
        style={({ pressed }) => ({
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.text,
          opacity: pressed ? 0.85 : 1,
          // A shadow rather than a border, so it reads as sitting above the
          // list rather than being part of it.
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        })}
      >
        <Txt
          variant="display"
          style={{
            color: colors.surface,
            // The glyph is optically low in its line box; nudging it up
            // centres the cross rather than the box around it.
            lineHeight: 34,
            marginTop: -2,
          }}
        >
          +
        </Txt>
      </Pressable>
    </View>
  );
}
