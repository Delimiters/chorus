import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { useSignOut } from '@/data/hooks/useAuth';
import { Button, Stack, Txt } from '@/design/components';
import { useColors } from '@/design/theme';
import { space } from '@/design/tokens';

/**
 * The app's mark: two rings overlapping. Two people, one household, the shared
 * middle — the same idea as the two inks.
 */
function Mark() {
  const colors = useColors();
  return (
    <Svg width={72} height={48} viewBox="0 0 60 40" accessibilityRole="image">
      <Circle cx={22} cy={20} r={15} stroke={colors.inkA} strokeWidth={2} fill="none" />
      <Circle cx={38} cy={20} r={15} stroke={colors.inkB} strokeWidth={2} fill="none" />
    </Svg>
  );
}

export function WelcomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const signOut = useSignOut();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
        <Stack gap={space.xxl}>
          <Stack gap={space.md}>
            <Mark />
            <Txt variant="display" accessibilityRole="header">
              One list, both of you
            </Txt>
            <Txt tone="muted">
              Set up your household, then send an invite. Chores you add show up for both of you,
              and Chorus keeps track of whose turn it is.
            </Txt>
          </Stack>

          <Stack gap={space.sm}>
            <Button label="Create a household" onPress={() => router.push('/create-household')} />
            <Button
              label="Join with an invite code"
              variant="secondary"
              onPress={() => router.push('/join-household')}
            />
          </Stack>

          <Button
            label="Sign out"
            variant="ghost"
            onPress={() => signOut.mutate()}
            loading={signOut.isPending}
          />
        </Stack>
      </View>
    </SafeAreaView>
  );
}
