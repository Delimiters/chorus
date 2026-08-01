/**
 * Upcoming.
 *
 * A collapsible month grid above a dated agenda. Collapsed it is a week strip
 * for "what's this week"; pulled down it answers "when is the fridge clean due"
 * — and the dots show the rotation handing over, which is the thing a plain list
 * cannot do. See docs/DESIGN_SYSTEM.md.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addDays, compareCivil, endOfMonth, startOfMonth, startOfWeek } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import { groupFloating, type AgendaItem } from '@/core/occurrence/agenda';
import { describeRule } from '@/core/recurrence/describe';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import {
  useOccurrenceActions,
  useOccurrences,
  useToggleCompletion,
} from '@/data/hooks/useOccurrences';
import { ChoreRow, FloatingRow, SectionHeader } from '@/design/ChoreRow';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useUserId } from '@/stores/sessionStore';
import { useToday } from '@/data/today';
import { OccurrenceSheet } from '../today/OccurrenceSheet';
import { MonthGrid, type DayMark } from './MonthGrid';
import { dayOfMonth, formatDayCaption, formatFlexibleWindow, weekdayShort } from '../today/format';

export function UpcomingScreen() {
  const { colors } = useTheme();
  const userId = useUserId();
  const household = useHousehold();
  const members = useMembers();
  const toggle = useToggleCompletion();
  const router = useRouter();
  const { skip, reschedule, clear } = useOccurrenceActions();
  const [open, setOpen] = useState<AgendaItem | null>(null);

  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const today = useToday(household.data?.timeZone ?? 'UTC');

  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<CivilDate>(today);

  /**
   * The window: whole weeks covering the visible month plus a little either
   * side, so the grid's leading and trailing days have dots too.
   *
   * Quantised to week boundaries so the query key does not churn.
   */
  const window = useMemo(() => {
    const start = addDays(startOfWeek(startOfMonth(selected), weekStartsOn), -7);
    const end = addDays(startOfWeek(endOfMonth(selected), weekStartsOn), 13);
    return { start, end };
  }, [selected, weekStartsOn]);

  // `items`, not `agenda`: the calendar shows what the schedule said on each
  // day. Collapsing superseded misses is a Today decision, and applying it here
  // erased every past dot — including the rotation hand-overs the grid exists
  // to make visible.
  const { items, chores, isLoading, error, refetch } = useOccurrences(window);

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

  const inkOf = (item: AgendaItem): string | null =>
    item.assignee.kind === 'member' ? (byMember.get(item.assignee.memberId)?.ink ?? null) : null;

  const turnLabelOf = (item: AgendaItem): string | null => {
    if (item.assignee.kind !== 'member') return null;
    const member = byMember.get(item.assignee.memberId);
    if (member === undefined) return null;
    return item.assignee.memberId === userId ? 'Your turn' : `${member.name}'s turn`;
  };

  /** A dot per chore per day, in the owner's ink. */
  const marks = useMemo(() => {
    const map = new Map<string, DayMark>();
    for (const item of items) {
      // Floating chores are not on a day, so they get no dot.
      if (item.flexibleFrom !== item.flexibleUntil) continue;
      const existing = map.get(item.dueOn);
      const ink = inkOf(item);
      if (existing) map.set(item.dueOn, { date: item.dueOn, inks: [...existing.inks, ink] });
      else map.set(item.dueOn, { date: item.dueOn, inks: [ink] });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, byMember]);

  /** The agenda below the grid: from the selected day forward, dated days only. */
  const agenda = useMemo(() => {
    const forward = items.filter((i) => compareCivil(i.dueOn, selected) >= 0);
    const { floating, dated } = groupFloating(forward);

    const byDay = new Map<CivilDate, AgendaItem[]>();
    for (const item of dated) {
      const bucket = byDay.get(item.dueOn);
      if (bucket) bucket.push(item);
      else byDay.set(item.dueOn, [item]);
    }
    return {
      floating: floating.filter((g) => compareCivil(g.flexibleUntil, today) >= 0),
      days: [...byDay.entries()].sort((a, b) => compareCivil(a[0], b[0])),
    };
  }, [items, selected, today]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
        <Txt variant="display" accessibilityRole="header">
          Upcoming
        </Txt>
      </View>

      <View
        style={{
          paddingHorizontal: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.rule,
        }}
      >
        <MonthGrid
          anchor={selected}
          selected={selected}
          today={today}
          weekStartsOn={weekStartsOn}
          marks={marks}
          expanded={expanded}
          onSelect={setSelected}
          onToggleExpanded={() => setExpanded((e) => !e)}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        {agenda.floating.length > 0 ? (
          <>
            <SectionHeader title={formatFlexibleWindow.sectionTitle} />
            <Stack gap={space.xs}>
              {agenda.floating.map((group) => {
                const next = group.nextSlot;
                return (
                  <FloatingRow
                    key={`${group.choreId}:${group.periodKey}:${group.subject ?? '-'}`}
                    group={group}
                    ink={next ? inkOf(next) : null}
                    turnLabel={next ? turnLabelOf(next) : null}
                    windowLabel={formatFlexibleWindow(
                      group.flexibleFrom,
                      group.flexibleUntil,
                      today,
                    )}
                    onToggle={() => {
                      if (next) toggle.mutate({ item: next, complete: true });
                    }}
                    onOpen={() => setOpen(next ?? group.slots[0] ?? null)}
                  />
                );
              })}
            </Stack>
          </>
        ) : null}

        {agenda.days.length === 0 ? (
          <View style={{ paddingVertical: space.xxxl, alignItems: 'center' }}>
            <Txt tone="faint">Nothing scheduled from here on.</Txt>
          </View>
        ) : null}

        {agenda.days.map(([date, dayItems]) => (
          <View
            key={date}
            style={{
              flexDirection: 'row',
              gap: space.md,
              paddingTop: space.md,
              borderTopWidth: 1,
              borderTopColor: colors.rule,
              marginTop: space.sm,
            }}
          >
            <View style={{ width: 44, gap: 1 }}>
              <Txt
                variant="label"
                tone={date === today ? 'accent' : 'faint'}
                style={{ fontSize: 9 }}
              >
                {weekdayShort(date)}
              </Txt>
              <Txt
                variant="mono"
                style={{ fontSize: 17, color: date === today ? colors.inkA : colors.text }}
              >
                {dayOfMonth(date)}
              </Txt>
              <Txt variant="small" tone="faint" style={{ fontSize: 10 }}>
                {formatDayCaption(date, today)}
              </Txt>
            </View>

            <Stack gap={space.xs} style={{ flex: 1 }}>
              {dayItems.map((item) => (
                <ChoreRow
                  key={item.occurrenceKey}
                  item={item}
                  ink={inkOf(item)}
                  turnLabel={turnLabelOf(item)}
                  scheduleLabel={scheduleFor.get(item.choreId) ?? ''}
                  onToggle={() => toggle.mutate({ item, complete: item.status !== 'completed' })}
                  onOpen={() => setOpen(item)}
                />
              ))}
            </Stack>
          </View>
        ))}
      </ScrollView>

      <OccurrenceSheet
        item={open}
        today={today}
        weekStartsOn={weekStartsOn}
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

/** Rounded corners on the grid container, kept here so the screen stays flat. */
export const gridRadius = radius.md;
