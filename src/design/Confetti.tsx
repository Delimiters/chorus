/**
 * The loud half of finishing a day.
 *
 * Plain views on the UI thread — `reanimated` is already here for the
 * reorderable list, so this costs no native dependency and no rebuild. Forty
 * pieces is enough to read as celebration and few enough that a three-year-old
 * iPhone does not drop frames.
 *
 * Three rules, all of them about not becoming annoying:
 *
 *   **It never blocks.** No modal, no dismiss. `pointerEvents="none"` over the
 *   whole overlay, so the screen underneath stays usable throughout — you can
 *   tick something else, or undo a mis-tap, while it falls.
 *
 *   **It makes no sound.** Ever. She might be at work or in bed, and a chore
 *   app that makes a noise gets muted permanently after one bad surprise.
 *
 *   **It respects Reduce Motion.** Nothing else in this app checks it, and a
 *   screen-filling burst is exactly the thing it exists for. With it on, this
 *   renders nothing and the haptic and the copy carry the moment — which is
 *   most of the good part anyway.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Dimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { inkColor } from './inks';
import { useTheme } from './theme';

const PIECES = 40;
const FALL_MS = 2600;

/** The household's own inks, so the burst belongs to this app rather than to any app. */
const INKS = ['blue', 'pink', 'teal', 'ochre', 'plum', 'green', 'rust'] as const;

interface Piece {
  readonly key: number;
  readonly left: number;
  readonly size: number;
  readonly ink: string;
  readonly delay: number;
  readonly drift: number;
  readonly spin: number;
}

/**
 * Laid out once, from a seed, rather than re-randomised every render.
 *
 * `Math.random` is banned in `core` and merely unwise here: a re-render
 * mid-fall would teleport every piece.
 */
function makePieces(width: number): readonly Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < PIECES; i += 1) {
    // A cheap deterministic hash, so a given index always lands the same way.
    const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
    pieces.push({
      key: i,
      left: r(1) * width,
      size: 5 + r(2) * 6,
      ink: INKS[Math.floor(r(3) * INKS.length)] ?? 'blue',
      delay: r(4) * 700,
      drift: (r(5) - 0.5) * 90,
      spin: (r(6) - 0.5) * 900,
    });
  }
  return pieces;
}

function Fleck({ piece, height }: { piece: Piece; height: number }) {
  const { isDark } = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      piece.delay,
      withTiming(1, { duration: FALL_MS, easing: Easing.in(Easing.quad) }),
    );
  }, [piece.delay, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: progress.value * height },
      { translateX: progress.value * piece.drift },
      { rotate: `${progress.value * piece.spin}deg` },
    ],
    // Fades in the last third rather than at the end, so nothing pops out of
    // existence at the bottom of the screen.
    opacity: progress.value > 0.66 ? (1 - progress.value) * 3 : 1,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: -20,
          left: piece.left,
          width: piece.size,
          height: piece.size * 1.4,
          borderRadius: 1,
          backgroundColor: inkColor(piece.ink, isDark),
        },
        style,
      ]}
    />
  );
}

export function Confetti({ running }: { running: boolean }) {
  const { height, width } = Dimensions.get('window');
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);

  // Null while the answer is still unknown: starting the animation and then
  // yanking it away a frame later is worse than a beat of nothing.
  if (!running || reduceMotion !== false) return null;

  const pieces = makePieces(width);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      {pieces.map((piece) => (
        <Fleck key={piece.key} piece={piece} height={height} />
      ))}
    </View>
  );
}
