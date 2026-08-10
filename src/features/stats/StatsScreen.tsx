/**
 * What happened, over the last month.
 *
 * Descriptive, not competitive. Two people sharing a flat do not need a
 * leaderboard, and a screen that ranks them would change what the app is for —
 * so the per-person figures are a split rather than a score, there is no
 * winner, and "missed" is stated without comment.
 *
 * The number worth having is **expected versus actual**, and it exists only
 * because occurrences are computed: the expander is replayed over a past
 * window and compared with what was recorded. In a design that materialised
 * occurrences, that figure would depend on whether a backfill had run.
 */

import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addDays } from '@/core/civil/date';
import { currentStreak, summarise } from '@/core/stats/summarise';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import { useOccurrences } from '@/data/hooks/useOccurrences';
import { useToday } from '@/data/today';
import { SectionHeader } from '@/design/ChoreRow';
import { BackBar, ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { inkColor } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useRouter } from 'expo-router';

/** Four weeks back. Long enough for a monthly chore to appear at least once. */
const WINDOW_DAYS = 28;

export function StatsScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const household = useHousehold();
  const members = useMembers();
  const today = useToday(household.data?.timeZone ?? 'UTC');

  const window = useMemo(() => ({ start: addDays(today, -WINDOW_DAYS), end: today }), [today]);
  const { items, isLoading, error } = useOccurrences(window);

  const summary = useMemo(
    () => summarise({ occurrences: items, from: window.start, to: window.end, today }),
    [items, window, today],
  );
  const streak = useMemo(() => currentStreak(items, today), [items, today]);

  const nameFor = (memberId: string | null): string => {
    if (memberId === null) return 'Someone who left';
    return members.data?.find((m) => m.userId === memberId)?.displayName ?? 'Someone';
  };
  const inkFor = (memberId: string | null): string | null =>
    memberId === null ? null : (members.data?.find((m) => m.userId === memberId)?.accent ?? null);

  if (isLoading) return <LoadingState label="Working out the last four weeks" />;
  if (error !== null) return <ErrorState message={error.message} />;

  const rate =
    summary.expected === 0 ? 0 : Math.round((summary.completed / summary.expected) * 100);
  const punctual =
    summary.completed === 0 ? 0 : Math.round((summary.onTime / summary.completed) * 100);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        <BackBar onPress={() => (router.canGoBack() ? router.back() : router.replace('/house'))} />

        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
          <Txt variant="display" accessibilityRole="header">
            Last four weeks
          </Txt>
          <Txt variant="mono" tone="faint">
            {`${summary.completed} OF ${summary.expected} DONE`}
          </Txt>
        </Stack>

        {summary.expected === 0 ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <Txt tone="faint">Nothing was due in the last four weeks.</Txt>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Stat
                label="Done"
                value={`${rate}%`}
                hint={`${summary.completed} of ${summary.expected}`}
              />
              <Stat
                label="On time"
                value={`${punctual}%`}
                hint={
                  summary.averageDaysLate === 0
                    ? 'nothing was late'
                    : `late ones by ${summary.averageDaysLate.toFixed(1)} days`
                }
              />
              <Stat
                label="Streak"
                value={`${streak}`}
                hint={streak === 1 ? 'day running' : 'days running'}
              />
            </View>

            {summary.byPerson.length === 0 ? null : (
              <>
                <SectionHeader title="Who did what" />
                <Stack gap={space.xs}>
                  {summary.byPerson.map((person) => (
                    <View
                      key={person.memberId ?? 'gone'}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm,
                        padding: space.md,
                        borderRadius: radius.md,
                        backgroundColor: colors.sunken,
                      }}
                    >
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor:
                            inkFor(person.memberId) === null
                              ? colors.textFaint
                              : inkColor(inkFor(person.memberId) as string, isDark),
                        }}
                      />
                      <Txt style={{ flex: 1 }}>{nameFor(person.memberId)}</Txt>
                      <Txt variant="mono" tone="muted">
                        {`${person.completed}`}
                      </Txt>
                    </View>
                  ))}
                </Stack>
              </>
            )}

            <SectionHeader title="By chore" />
            <Stack gap={space.xs}>
              {summary.byChore.map((chore) => (
                <View
                  key={chore.choreId}
                  style={{
                    padding: space.md,
                    borderRadius: radius.md,
                    backgroundColor: colors.sunken,
                    gap: 2,
                  }}
                >
                  <Txt variant="bodyStrong">{chore.choreTitle}</Txt>
                  <Txt variant="small" tone="faint">
                    {`${chore.completed} of ${chore.expected} done` +
                      (chore.skipped > 0 ? ` · ${chore.skipped} skipped` : '') +
                      (chore.missed > 0 ? ` · ${chore.missed} missed` : '')}
                  </Txt>
                </View>
              ))}
            </Stack>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 100,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.sunken,
        gap: 2,
      }}
      accessibilityLabel={`${label}: ${value}, ${hint}`}
    >
      <Txt variant="label" tone="faint">
        {label}
      </Txt>
      <Txt variant="display">{value}</Txt>
      <Txt variant="small" tone="faint">
        {hint}
      </Txt>
    </View>
  );
}
