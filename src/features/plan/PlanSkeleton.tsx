/**
 * The plan's shape, before the plan.
 *
 * Jake: *"there is a kind of ugly moment sometimes when you open the app and
 * the plan screen like has nothing on it and then loads some stuff and
 * everything kind of jumps around."*
 *
 * The jump was never a slow query — it was the screen painting three times.
 * The first paint waited only on the occurrences, so the plan appeared with no
 * rows at all; the entries landed and rows appeared; then the fill wrote more
 * and they appeared too. A spinner does not help with that, because a spinner
 * is a different *shape* from what replaces it, so the swap is itself a
 * reflow.
 *
 * So this is the same layout, in grey: the same heading block, the same
 * progress rule, the same section header, rows at the same height. Swapping it
 * for the real thing moves nothing — which is the whole point, and the reason
 * it is worth keeping the two in step if the plan's header ever changes.
 */

import { View, type DimensionValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

/** One grey block. `rule` is the faintest token, which is what a placeholder wants. */
function Bar({ w, h = 14 }: { w: DimensionValue; h?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: w, height: h, borderRadius: radius.sm, backgroundColor: colors.rule }} />
  );
}

/**
 * A row the height of a real one.
 *
 * `ChoreRow`'s own minimum is `MIN_TARGET` plus its vertical padding; 58 is
 * what that comes to for a single-line title, which is the common case. A
 * placeholder taller than the row it stands in for would make the swap jump
 * the other way.
 */
function Row() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 58,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.rule,
        paddingHorizontal: space.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          borderWidth: 1.6,
          borderColor: colors.rule,
        }}
      />
      <Bar w="55%" />
    </View>
  );
}

export function PlanSkeleton() {
  const { colors } = useTheme();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.paper }}
      edges={['top']}
      accessibilityLabel="Loading your day"
      accessible
    >
      <View style={{ padding: space.lg, gap: space.md }}>
        <View style={{ paddingHorizontal: space.sm, gap: space.sm }}>
          <Bar w={140} h={30} />
          <Bar w={220} h={13} />
          <Bar w={170} h={13} />
        </View>

        {/* The progress rule, which is a fixed 4pt on the real screen. */}
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.rule }} />

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: space.sm,
            paddingTop: space.sm,
          }}
        >
          <Bar w={110} h={11} />
          <Bar w={90} h={11} />
        </View>

        <View style={{ gap: space.xs }}>
          <Row />
          <Row />
          <Row />
          <Row />
          <Row />
        </View>
      </View>
    </SafeAreaView>
  );
}
