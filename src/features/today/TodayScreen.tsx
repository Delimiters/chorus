/**
 * Today.
 *
 * Nine times out of ten this is the only screen either person opens. It answers
 * one question — what needs doing, and is it mine — and gets out of the way.
 *
 * Yours first, then everyone else's, then what's already been done. Seeing what
 * your housemate did is half the reason to share a list, and it's the thing that
 * stops you having to ask.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AgendaItem, FloatingGroup } from '@/core/occurrence/agenda';
import { describeRule } from '@/core/recurrence/describe';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import {
  useOccurrenceActions,
  useToday_View,
  useToggleCompletion,
} from '@/data/hooks/useOccurrences';
import { ChoreRow, FloatingRow, SectionHeader } from '@/design/ChoreRow';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { useUserId } from '@/stores/sessionStore';
import { EmptyToday } from './EmptyToday';
import { OccurrenceSheet } from './OccurrenceSheet';
import { formatDayLong, formatFlexibleWindow } from './format';

export function TodayScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const userId = useUserId();
  const members = useMembers();
  const household = useHousehold();
  const { skip, reschedule, clear } = useOccurrenceActions();
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const { view, chores, today, isLoading, error, unreadable, refetch } = useToday_View();
  const toggle = useToggleCompletion();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  /** Who is who, for ink and name lookups. */
  const byMember = useMemo(() => {
    const map = new Map<string, { name: string; ink: string }>();
    for (const member of members.data ?? []) {
      map.set(member.userId, { name: member.displayName, ink: member.accent });
    }
    return map;
  }, [members.data]);

  const scheduleFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const chore of chores) map.set(chore.id, describeRule(chore.schedule.rule));
    return map;
  }, [chores]);

  /**
   * Ink and turn label for a row.
   *
   * The two always travel together: a coloured mark without words would leave
   * anyone with colour vision deficiency guessing. See docs/DESIGN_SYSTEM.md.
   */
  const ownership = (
    assignee: AgendaItem['assignee'],
  ): { ink: string | null; turnLabel: string | null } => {
    if (assignee.kind !== 'member') return { ink: null, turnLabel: null };
    const member = byMember.get(assignee.memberId);
    if (member === undefined) return { ink: null, turnLabel: null };
    return {
      ink: member.ink,
      // "Your turn" for you, first name for everyone else — nobody says
      // "Jake's turn" about themselves.
      turnLabel: assignee.memberId === userId ? 'Your turn' : `${member.name}'s turn`,
    };
  };

  const renderRow = (item: AgendaItem) => {
    const { ink, turnLabel } = ownership(item.assignee);
    return (
      <ChoreRow
        key={item.occurrenceKey}
        item={item}
        ink={ink}
        turnLabel={turnLabel}
        scheduleLabel={scheduleFor.get(item.choreId) ?? ''}
        onToggle={() => toggle.mutate({ item, complete: item.status !== 'completed' })}
        onOpen={() => setOpen(item)}
      />
    );
  };

  const renderFloating = (group: FloatingGroup) => {
    const next = group.nextSlot;
    const { ink, turnLabel } = next ? ownership(next.assignee) : { ink: null, turnLabel: null };
    return (
      <FloatingRow
        key={`${group.choreId}:${group.periodKey}:${group.subject ?? '-'}`}
        group={group}
        ink={ink}
        turnLabel={turnLabel}
        windowLabel={formatFlexibleWindow(group.flexibleFrom, group.flexibleUntil, today)}
        onToggle={() => {
          if (next) toggle.mutate({ item: next, complete: true });
        }}
        // A floating group's row acts on its next outstanding slot, so that is
        // the occurrence the sheet is about.
        onOpen={() => setOpen(next ?? group.slots[0] ?? null)}
      />
    );
  };

  if (isLoading) return <LoadingState label="Loading your chores" />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  const nothingToDo = view.outstandingCount === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: 2 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textFaint}
          />
        }
      >
        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
          <Txt variant="display" accessibilityRole="header">
            Today
          </Txt>
          <Txt variant="mono" tone="faint">
            {formatDayLong(today).toUpperCase()}
            {view.doneCount > 0 ? ` · ${view.doneCount} DONE` : ''}
          </Txt>
        </Stack>

        {unreadable.length > 0 ? (
          <View style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
            <Txt variant="small" tone="danger">
              {unreadable.length} chore{unreadable.length === 1 ? '' : 's'} could not be read and{' '}
              {unreadable.length === 1 ? 'is' : 'are'} hidden.
            </Txt>
          </View>
        ) : null}

        {nothingToDo ? (
          <EmptyToday
            done={view.done}
            byMember={byMember}
            userId={userId}
            hasAnyChores={chores.length > 0}
            onAddChore={() => router.push('/chore/new')}
          />
        ) : null}

        {view.floating.length > 0 ? (
          <>
            <SectionHeader title={formatFlexibleWindow.sectionTitle} />
            <Stack gap={space.xs}>{view.floating.map(renderFloating)}</Stack>
          </>
        ) : null}

        {view.mine.length > 0 ? (
          <>
            <SectionHeader title="Yours" count={view.mine.length} />
            <Stack gap={space.xs}>{view.mine.map(renderRow)}</Stack>
          </>
        ) : null}

        {view.theirs.length > 0 ? (
          <>
            <SectionHeader title="Everyone else" count={view.theirs.length} />
            <Stack gap={space.xs}>{view.theirs.map(renderRow)}</Stack>
          </>
        ) : null}

        {view.done.length > 0 ? (
          <>
            <SectionHeader title="Done" count={view.done.length} />
            <Stack gap={space.xs}>{view.done.map(renderRow)}</Stack>
          </>
        ) : null}

        {/* Skipping is a decision, not a failure — but it is undoable, and undo
            has to be reachable from somewhere. */}
        {view.skipped.length > 0 ? (
          <>
            <SectionHeader title="Skipped" count={view.skipped.length} />
            <Stack gap={space.xs}>{view.skipped.map(renderRow)}</Stack>
          </>
        ) : null}
      </ScrollView>

      <OccurrenceSheet
        item={open}
        today={today}
        weekStartsOn={(household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6}
        onClose={() => setOpen(null)}
        onToggleComplete={(item) => toggle.mutate({ item, complete: item.status !== 'completed' })}
        error={
          ((skip.error ?? reschedule.error ?? clear.error ?? toggle.error) as Error | null)
            ?.message ?? null
        }
        onSkip={(item) => skip.mutate(item)}
        onReschedule={(item, movedTo) => reschedule.mutate({ item, movedTo })}
        onClearException={(item) => clear.mutate(item)}
        onEditChore={(choreId) => router.push(`/chore/${choreId}`)}
      />
    </SafeAreaView>
  );
}
