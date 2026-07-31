/**
 * The chore library.
 *
 * The edit surface, not a to-do list: every chore with its schedule stated in
 * plain words, plus the Someday section for things with no date. Creating and
 * editing arrive in Phase 6; this is the read view they will hang off.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { describeSchedule } from '@/core/recurrence/describe';
import { listChores, type Chore } from '@/data/api/chores';
import { useMembers } from '@/data/hooks/useHousehold';
import { qk } from '@/data/queryKeys';
import { SectionHeader } from '@/design/ChoreRow';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { inkColor } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useActiveHouseholdId } from '@/stores/sessionStore';
import { skipToken, useQuery } from '@tanstack/react-query';

export function ChoresScreen() {
  const { colors, isDark } = useTheme();
  const householdId = useActiveHouseholdId();
  const members = useMembers();
  const [showArchived, setShowArchived] = useState(false);

  const query = useQuery({
    queryKey: qk.choreList(householdId ?? '__none__', { archived: showArchived }),
    queryFn:
      householdId === null
        ? skipToken
        : () => listChores(householdId, { includeArchived: showArchived }),
  });

  const inkFor = (chore: Chore): string | null => {
    // Only a fixed assignment has a single owner. Rotating and fan-out chores
    // belong to everyone in turn, so the library shows them unmarked.
    const assignment = chore.assignment;
    if (assignment.kind !== 'fixed') return null;
    return members.data?.find((m) => m.userId === assignment.memberId)?.accent ?? null;
  };

  const { active, someday, archived } = useMemo(() => {
    const all = query.data?.chores ?? [];
    return {
      active: all.filter((c) => !c.archived && c.schedule.rule.kind !== 'unscheduled'),
      someday: all.filter((c) => !c.archived && c.schedule.rule.kind === 'unscheduled'),
      archived: all.filter((c) => c.archived),
    };
  }, [query.data]);

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState message={(query.error as Error).message} />;

  const row = (chore: Chore, dashed = false) => {
    const ink = inkFor(chore);
    return (
      <View
        key={chore.id}
        style={{
          flexDirection: 'row',
          gap: space.md,
          alignItems: 'flex-start',
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: dashed ? 'transparent' : colors.sunken,
          borderWidth: dashed ? 1 : 0,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: colors.rule,
          opacity: chore.archived ? 0.5 : 1,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            marginTop: 1,
            borderRadius: radius.sm,
            borderWidth: 1.5,
            borderColor: ink === null ? colors.textFaint : inkColor(ink, isDark),
          }}
        />
        <Stack gap={3} style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{chore.title}</Txt>
          <Txt variant="small" tone="faint">
            {describeSchedule(chore.schedule)}
          </Txt>
        </Stack>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
          <Txt variant="display" accessibilityRole="header">
            Chores
          </Txt>
          <Txt variant="mono" tone="faint">
            {active.length} ACTIVE · {someday.length} SOMEDAY
          </Txt>
        </Stack>

        {active.length > 0 ? (
          <>
            <SectionHeader title="Repeating" />
            <Stack gap={space.xs}>{active.map((c) => row(c))}</Stack>
          </>
        ) : (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <Txt tone="faint">No chores yet.</Txt>
          </View>
        )}

        {someday.length > 0 ? (
          <>
            <SectionHeader title="Someday · no date" />
            <Stack gap={space.xs}>{someday.map((c) => row(c, true))}</Stack>
          </>
        ) : null}

        <Pressable
          onPress={() => setShowArchived((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showArchived }}
          style={{ paddingVertical: space.lg, paddingHorizontal: space.sm }}
        >
          <Txt variant="small" tone="accent">
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Txt>
        </Pressable>

        {showArchived && archived.length > 0 ? (
          <>
            <SectionHeader title="Archived" count={archived.length} />
            <Stack gap={space.xs}>{archived.map((c) => row(c))}</Stack>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
