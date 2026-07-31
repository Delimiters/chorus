/**
 * The household.
 *
 * Who lives here, how the week split, and the invite code. The balance bar is
 * deliberately descriptive rather than competitive — no streaks, no points, no
 * winner. Roughly even is quietly reassuring; lopsided starts a conversation.
 * That is the whole feature.
 */

import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addDays, startOfWeek } from '@/core/civil/date';
import { listCompletions } from '@/data/api/chores';
import { useSignOut } from '@/data/hooks/useAuth';
import {
  useActiveInvite,
  useCreateInvite,
  useHousehold,
  useMembers,
} from '@/data/hooks/useHousehold';
import { formatInviteCode } from '@/data/inviteCode';
import { qk } from '@/data/queryKeys';
import { useToday } from '@/data/today';
import { SectionHeader } from '@/design/ChoreRow';
import { Button, LoadingState, Stack, Txt } from '@/design/components';
import { inkColor } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useActiveHouseholdId } from '@/stores/sessionStore';
import { skipToken, useQuery } from '@tanstack/react-query';

export function HouseScreen() {
  const router = useRouter();
  const invite = useActiveInvite();
  const createInvite = useCreateInvite();
  const { colors, isDark } = useTheme();
  const householdId = useActiveHouseholdId();
  const household = useHousehold();
  const members = useMembers();
  const signOut = useSignOut();
  const today = useToday(household.data?.timeZone ?? 'UTC');
  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  const week = useMemo(() => {
    const start = startOfWeek(today, weekStartsOn);
    return { start, end: addDays(start, 6) };
  }, [today, weekStartsOn]);

  const completions = useQuery({
    queryKey: qk.completions(householdId ?? '__none__', week.start, week.end),
    queryFn:
      householdId === null ? skipToken : () => listCompletions(householdId, week.start, week.end),
  });

  /** Completions this week, per person. Descriptive, not a leaderboard. */
  const split = useMemo(() => {
    const counts = new Map<string, number>();
    for (const completion of completions.data ?? []) {
      counts.set(completion.completedBy, (counts.get(completion.completedBy) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return { counts, total };
  }, [completions.data]);

  if (household.isLoading) return <LoadingState />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
          <Txt variant="display" accessibilityRole="header">
            {household.data?.name ?? 'The house'}
          </Txt>
          <Txt variant="mono" tone="faint">
            {(members.data ?? []).length} {(members.data ?? []).length === 1 ? 'PERSON' : 'PEOPLE'}
          </Txt>
        </Stack>

        <SectionHeader title="Who lives here" />
        <Stack gap={space.xs}>
          {(members.data ?? []).map((member) => (
            <View
              key={member.userId}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: colors.sunken,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: radius.pill,
                  backgroundColor: inkColor(member.accent, isDark),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt variant="bodyStrong" style={{ color: '#FFFFFF' }}>
                  {member.displayName.slice(0, 1).toUpperCase()}
                </Txt>
              </View>
              <Stack gap={1} style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{member.displayName}</Txt>
                <Txt variant="small" tone="faint">
                  {member.role}
                </Txt>
              </Stack>
              <Txt variant="mono" tone="faint">
                {split.counts.get(member.userId) ?? 0}
              </Txt>
            </View>
          ))}
        </Stack>

        <SectionHeader title="This week" />
        {split.total === 0 ? (
          <Txt variant="small" tone="faint" style={{ paddingHorizontal: space.sm }}>
            Nothing done yet this week.
          </Txt>
        ) : (
          <Stack gap={space.sm} style={{ paddingHorizontal: space.sm }}>
            <View
              style={{
                flexDirection: 'row',
                height: 10,
                borderRadius: 5,
                overflow: 'hidden',
                backgroundColor: colors.sunken,
              }}
              accessibilityLabel={(members.data ?? [])
                .map((m) => `${m.displayName} ${split.counts.get(m.userId) ?? 0}`)
                .join(', ')}
            >
              {(members.data ?? []).map((member) => {
                const count = split.counts.get(member.userId) ?? 0;
                if (count === 0) return null;
                return (
                  <View
                    key={member.userId}
                    style={{
                      flex: count,
                      backgroundColor: inkColor(member.accent, isDark),
                    }}
                  />
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {(members.data ?? []).map((member) => (
                <Txt key={member.userId} variant="small" tone="faint">
                  {member.displayName} · {split.counts.get(member.userId) ?? 0}
                </Txt>
              ))}
            </View>
          </Stack>
        )}

        {/*
          The invite. Without this the app is single-player: `createInvite` and
          `getActiveInvite` existed with no caller, so there was no way for a
          second person to join a household — which is the one thing this app is
          for. Found by a retrospective, not by a test, because every test that
          touched invites went through the data layer the UI was missing.
        */}
        <SectionHeader title="Add someone" />
        <Stack gap={space.sm}>
          {invite.data ? (
            <View
              style={{
                gap: space.xs,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: colors.sunken,
              }}
            >
              <Txt variant="label" tone="faint">
                THEIR CODE
              </Txt>
              {/* Selectable and spaced, because this gets read aloud or typed
                  into another phone rather than tapped. */}
              <Txt
                variant="display"
                selectable
                style={{ letterSpacing: 2, fontVariant: ['tabular-nums'] }}
              >
                {formatInviteCode(invite.data.code)}
              </Txt>
              <Txt variant="small" tone="faint">
                They enter this when they sign up. It works once, and expires if unused.
              </Txt>
            </View>
          ) : (
            <Txt variant="small" tone="faint">
              Make a code and give it to whoever you share the house with.
            </Txt>
          )}
          <Button
            label={invite.data ? 'Make a new code' : 'Make an invite code'}
            variant="ghost"
            onPress={() => createInvite.mutate()}
            loading={createInvite.isPending}
          />
          {createInvite.error ? (
            <Txt variant="small" tone="danger">
              {(createInvite.error as Error).message}
            </Txt>
          ) : null}
        </Stack>

        <View style={{ paddingTop: space.xxl, gap: space.sm }}>
          <Button label="Settings" variant="ghost" onPress={() => router.push('/settings')} />
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() => signOut.mutate()}
            loading={signOut.isPending}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
