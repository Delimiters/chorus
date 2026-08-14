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

import { ADD_BUTTON_CLEARANCE, AddChoreButton } from '@/design/AddButton';

import { addDays, compareCivil, endOfMonth, startOfMonth, startOfWeek } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import { groupFloating, type AgendaItem, type FloatingGroup } from '@/core/occurrence/agenda';
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
import { OccurrenceSheet } from '@/features/common/OccurrenceSheet';
import { MonthGrid, type DayMark } from './MonthGrid';
import {
  dayOfMonth,
  formatDayCaption,
  formatFlexibleWindow,
  formatWeekBand,
  weekdayShort,
} from '@/features/common/format';

export function UpcomingScreen() {
  const { colors } = useTheme();
  const userId = useUserId();
  const household = useHousehold();
  const members = useMembers();

  /** Your own accent, so the add button wears your colour rather than a generic one. */
  const myInk = members.data?.find((m) => m.userId === userId)?.accent ?? null;
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

  /**
   * The agenda below the grid, a week at a time.
   *
   * Flexible chores are filed under the week they are actually due in, rather
   * than piled into one band at the top. Upcoming shows a month or more at
   * once, so that band held every occurrence in range — a single "3× a week"
   * chore appeared three or four times over, under a heading that said "this
   * week" about all of them.
   *
   * A chore whose window is longer than a week (monthly floating) is filed
   * under the first visible week its window overlaps, so it is listed once and
   * near the top rather than at the far end of its month.
   */
  const weeks = useMemo(() => {
    /*
     * Dated rows are filtered by day; flexible ones by whether their window is
     * still open.
     *
     * Filtering floating groups by slot date — which is what filtering the
     * items first did — deleted the current week's band from Thursday onward,
     * because a "2× this week" chore has its nominal slots early in the week.
     * The chore is still due this week; the day its slot notionally sits on is
     * an implementation detail of how the engine spreads them.
     */
    const { floating: allFloating, dated: allDated } = groupFloating(items);
    const dated = allDated.filter((i) => compareCivil(i.dueOn, selected) >= 0);
    const cutoff = compareCivil(selected, today) > 0 ? selected : today;
    const floating = allFloating.filter((g) => compareCivil(g.flexibleUntil, cutoff) >= 0);
    const selectedWeek = startOfWeek(selected, weekStartsOn);

    type Week = {
      weekStart: CivilDate;
      floating: FloatingGroup[];
      days: Map<CivilDate, AgendaItem[]>;
    };
    const byWeek = new Map<CivilDate, Week>();
    const weekFor = (date: CivilDate): Week => {
      const weekStart = startOfWeek(date, weekStartsOn);
      const found = byWeek.get(weekStart);
      if (found) return found;
      const made: Week = { weekStart, floating: [], days: new Map() };
      byWeek.set(weekStart, made);
      return made;
    };

    for (const item of dated) {
      const week = weekFor(item.dueOn);
      const bucket = week.days.get(item.dueOn);
      if (bucket) bucket.push(item);
      else week.days.set(item.dueOn, [item]);
    }

    for (const group of floating) {
      // Clamped, so a window that began before the selected day is filed under
      // the week you are looking at rather than one scrolled off the top.
      const anchor =
        compareCivil(group.flexibleFrom, selected) >= 0 ? group.flexibleFrom : selected;
      const week = weekFor(anchor);
      if (compareCivil(week.weekStart, selectedWeek) < 0) continue;
      week.floating.push(group);
    }

    return [...byWeek.values()]
      .sort((a, b) => compareCivil(a.weekStart, b.weekStart))
      .map((week) => ({
        weekStart: week.weekStart,
        floating: week.floating,
        days: [...week.days.entries()].sort((a, b) => compareCivil(a[0], b[0])),
      }));
  }, [items, selected, today, weekStartsOn]);

  const hasAnything = weeks.some((w) => w.days.length > 0 || w.floating.length > 0);

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

      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xxxl + ADD_BUTTON_CLEARANCE,
        }}
      >
        {!hasAnything ? (
          <View style={{ paddingVertical: space.xxxl, alignItems: 'center' }}>
            <Txt tone="faint">Nothing scheduled from here on.</Txt>
          </View>
        ) : null}

        {/*
          A week at a time: the flexible band, then that week's days.
          
          The band sits above the days of its own week, so the current week's
          flexible chores are still the first thing on the screen — and a
          chore due the week after next is filed under a heading that says so
          rather than one claiming it is due this week.
        */}
        {weeks.map((week) => (
          <View key={week.weekStart}>
            {week.floating.length > 0 ? (
              <>
                <SectionHeader title={formatWeekBand(week.weekStart, today)} />
                <Stack gap={space.xs}>
                  {week.floating.map((group) => {
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

            {week.days.map(([date, dayItems]) => (
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
                      onToggle={() =>
                        toggle.mutate({ item, complete: item.status !== 'completed' })
                      }
                      onOpen={() => setOpen(item)}
                    />
                  ))}
                </Stack>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <AddChoreButton onPress={() => router.push('/chore/new')} ink={myInk} />

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
