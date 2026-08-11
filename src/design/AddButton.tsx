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
import { readableOn } from './contrast';
import { inkColor } from './inks';
import { useTheme } from './theme';
import { space } from './tokens';

/** The button itself. Exported so screens can reserve room below their content. */
const SIZE = 56;

/**
 * How far above the tab bar it sits.
 *
 * The screen already ends above the tab bar, so this is a gap rather than a
 * clearance — a large value floats the button awkwardly high in the middle of
 * the screen instead of anchoring it to the corner.
 */
const BOTTOM_OFFSET = space.lg;

/**
 * What a scrolling screen must add to its bottom padding.
 *
 * Without it the last row sits under the button and cannot be scrolled clear —
 * the one chore you cannot reach being, reliably, the one you want.
 */
export const ADD_BUTTON_CLEARANCE = SIZE + BOTTOM_OFFSET + space.lg;

export function AddChoreButton({
  onPress,
  ink = null,
}: {
  onPress: () => void;
  /** The signed-in member's accent, or null for the default near-black. */
  ink?: string | null;
}) {
  const { colors, isDark } = useTheme();

  /**
   * The button wears your colour, and the glyph is chosen by measurement.
   *
   * The inks are tuned to be legible *as foreground* on paper, which says
   * nothing about what reads on top of them — the light-mode blue is dark
   * enough for a white cross, and the dark-mode blue is light enough that a
   * white cross would nearly vanish. Asking which of the two candidates has
   * more contrast means a bright ink degrades to a dark glyph instead of an
   * unreadable control, and a new ink cannot quietly break it.
   */
  const background = ink === null ? colors.text : inkColor(ink, isDark);
  const glyph = readableOn(background, [colors.surface, colors.text]);

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
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
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
            color: glyph,
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
