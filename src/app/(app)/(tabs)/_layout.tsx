import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';

import { useTheme } from '@/design/theme';
import { type } from '@/design/tokens';

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
      <Tabs.Screen name="chores" options={{ title: 'Chores', tabBarIcon: TabIcon }} />
      <Tabs.Screen name="house" options={{ title: 'House', tabBarIcon: TabIcon }} />
    </Tabs>
  );
}
