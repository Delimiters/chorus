/**
 * Today — placeholder.
 *
 * The real agenda arrives in Phase 5, on top of the projector. This exists so
 * Phase 4's demo is complete: sign up, create a household, land somewhere real,
 * and see that the session and household actually resolved.
 */

import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSignOut } from '@/data/hooks/useAuth';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import { Button, LoadingState, Stack, Txt } from '@/design/components';
import { useColors } from '@/design/theme';
import { accentColor, radius, space } from '@/design/tokens';

export function TodayScreen() {
  const colors = useColors();
  const household = useHousehold();
  const members = useMembers();
  const signOut = useSignOut();

  if (household.isLoading) return <LoadingState />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
        <Stack gap={space.xs}>
          <Txt variant="display" accessibilityRole="header">
            Today
          </Txt>
          <Txt tone="muted">{household.data?.name ?? 'Your household'}</Txt>
        </Stack>

        <Stack gap={space.sm}>
          <Txt variant="label" tone="faint">
            Who lives here
          </Txt>
          {members.data?.map((member) => (
            <View
              key={member.userId}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                backgroundColor: colors.sunken,
                borderRadius: radius.md,
                padding: space.md,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.pill,
                  backgroundColor: accentColor(member.accent, colors),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt variant="bodyStrong" style={{ color: '#FFFFFF' }}>
                  {member.displayName.slice(0, 1).toUpperCase()}
                </Txt>
              </View>
              <Stack gap={0}>
                <Txt variant="bodyStrong">{member.displayName}</Txt>
                <Txt variant="small" tone="faint">
                  {member.role}
                </Txt>
              </Stack>
            </View>
          ))}
        </Stack>

        <Stack gap={space.sm}>
          <Txt variant="label" tone="faint">
            Next
          </Txt>
          <Txt tone="muted">
            Chores and the agenda land in the next phase. The household, the members and the session
            are all real — everything below this is built on them.
          </Txt>
        </Stack>

        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => signOut.mutate()}
          loading={signOut.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
