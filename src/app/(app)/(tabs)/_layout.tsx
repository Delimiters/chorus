import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';

import { useTheme } from '@/design/theme';
import { type } from '@/design/tokens';
import { useNoteBadge } from '@/features/notes/useUnseenNotes';

/*
 * Four tabs, and the count is load-bearing rather than incidental.
 *
 * Every icon below is the same square, so the *labels* are doing all the work
 * of telling tabs apart — and five would drop each from about 98pt to 78pt on
 * an iPhone 14, squeezing the one thing that differentiates them. Chores moved
 * to the House tab to make room for Notes rather than adding a fifth: it is a
 * library you consult while setting things up, not something you open daily.
 *
 * If a fifth is ever wanted, real icons come first.
 */

/** A simple square glyph — filled when active. Real icons land in Phase 8. */
function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
  return (
    <View
      style={{
        width: 17,
        height: 17,
        borderRadius: 4,
        borderWidth: 1.6,
        borderColor: color,
        backgroundColor: focused ? color : 'transparent',
      }}
    />
  );
}

export default function TabLayout() {
  const { colors } = useTheme();

  /*
   * Counted here rather than inside the Notes screen, because a badge is only
   * useful on a tab you are *not* looking at. The count comes off the same
   * query the board renders, so it follows a realtime edit without a fetch of
   * its own.
   *
   * The colour is the household overprint — where the two inks overlap — not
   * the usual red. Nothing is wrong; somebody wrote something down.
   */
  const badge = useNoteBadge();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.rule },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: type.label.fontWeight,
          letterSpacing: 0.7,
          textTransform: 'uppercase',
        },
        sceneStyle: { backgroundColor: colors.paper },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: TabIcon }} />
      <Tabs.Screen name="upcoming" options={{ title: 'Upcoming', tabBarIcon: TabIcon }} />
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Notes',
          tabBarIcon: TabIcon,
          // Spread rather than `tabBarBadge: badge ?? undefined`:
          // `exactOptionalPropertyTypes` rejects an explicit undefined.
          ...(badge === null ? {} : { tabBarBadge: badge }),
          tabBarBadgeStyle: {
            backgroundColor: colors.overprint,
            color: colors.paper,
            fontSize: 11,
            fontWeight: '700',
          },
        }}
      />
      <Tabs.Screen name="house" options={{ title: 'House', tabBarIcon: TabIcon }} />
    </Tabs>
  );
}
