/**
 * The chore chart: a week, ruled into days, with a mark for each one done.
 *
 * Jake: *"a chore chart that just has the list of chores and when they were due
 * that week and whether they got done or not, maybe also allow you to check off
 * chores from an earlier day in there in case you did it and just forgot to
 * check it off and don't want to reset the cycle onto the wrong day."*
 *
 * ── Why a grid, when every other screen is a list ─────────────────────────
 *
 * Today and Upcoming answer "what should I do now", and both collapse a chore's
 * missed occurrences into one row so a neglected daily chore cannot fill the
 * screen. That collapse is exactly wrong here: the question is "what did this
 * week look like", and a chore missed on Monday and done on Tuesday is two
 * facts. So this reads `useOccurrences(...).items` — uncollapsed — and lays the
 * week out on two axes instead of one.
 *
 * The design system already names the thing this is: mono figures are there
 * because they *"echo the chore chart on a fridge that this app replaces"*. So
 * it is ruled and printed rather than carded — hairline columns, tabular day
 * numbers, and a filled box in the ink of whoever did it. Blue is you, pink is
 * your housemate, and a glance down a column says who carried the day.
 *
 * ── The backdated tick, which is the feature ──────────────────────────────
 *
 * Tapping Tuesday's box records `completedOn` as **Tuesday**, not today. For an
 * `every N days` chore that is the whole difference: `anchorToCompletion`
 * restarts the interval from the completion date, so ticking it with today's
 * date would push the next one to today + N. Jake's *"reset the cycle onto the
 * wrong day"* is a real mechanism in this codebase, not a worry.
 *
 * Future boxes are not tappable, and skipped ones are not either — un-skipping
 * is a different decision and lives on the occurrence sheet, where there is
 * room to say so.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addDays, startOfWeek } from '@/core/civil/date';
import type { CivilDate, Weekday } from '@/core/civil/types';
import { weekChart, weekDays, weekTotals, type ChartCell, type ChartRow } from '@/core/chart/week';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import { useOccurrences, useToggleCompletion } from '@/data/hooks/useOccurrences';
import { useToday } from '@/data/today';
import { BackBar, ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { inkColor } from '@/design/inks';
import { PagerArrow } from '@/design/PagerArrow';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';
import { dayOfMonth, formatDayShort, monthName, weekdayShort } from '@/features/common/format';

/** The gap between boxes. Hairline, so the week reads as one ruled strip. */
const GUTTER = 3;

export function ChoreChartScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const household = useHousehold();
  const members = useMembers();
  const today = useToday(household.data?.timeZone ?? 'UTC');
  const toggle = useToggleCompletion();

  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as Weekday;
  const thisWeek = startOfWeek(today, weekStartsOn);

  /*
   * Which week is on screen. Seeded to the one containing today, and paging
   * forward stops there: a chart of a week that has not happened is a column of
   * empty boxes you cannot tick.
   */
  const [weekStart, setWeekStart] = useState<CivilDate>(thisWeek);
  const isThisWeek = weekStart === thisWeek;

  const window = useMemo(() => ({ start: weekStart, end: addDays(weekStart, 6) }), [weekStart]);
  const { items, isLoading, error } = useOccurrences(window);

  const rows = useMemo(() => weekChart(items, { weekStart, today }), [items, weekStart, today]);
  const totals = useMemo(() => weekTotals(rows), [rows]);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  const inkFor = (userId: string | null): string | null => {
    if (userId === null) return null;
    const member = (members.data ?? []).find((m) => m.userId === userId);
    return member === undefined ? null : inkColor(member.accent, isDark);
  };

  const onTap = (cell: ChartCell): void => {
    const item = cell.items[0];
    if (item === undefined || cell.tap === null) return;
    /*
     * The first occurrence only, deliberately. A shared day holds one per
     * person, and ticking somebody else's share from a grid — with no
     * indication whose box it was — is the wrong default. Their own box is one
     * tap away on the occurrence sheet.
     */
    toggle.mutate({ item, complete: cell.tap === 'complete', completedOn: cell.date });
  };

  if (isLoading) return <LoadingState label="Working out the week" />;
  if (error !== null) return <ErrorState message={error.message} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        <BackBar onPress={() => (router.canGoBack() ? router.back() : router.replace('/house'))} />

        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
          <Txt variant="display" accessibilityRole="header">
            Chore chart
          </Txt>
          <Txt variant="mono" tone="faint">
            {`${totals.done} OF ${totals.due} DONE`}
          </Txt>
        </Stack>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <PagerArrow
            label="Previous week"
            glyph="chevron-left"
            onPress={() => setWeekStart(addDays(weekStart, -7))}
          />
          <Txt variant="heading" accessibilityRole="header">
            {isThisWeek ? 'This week' : weekLabel(weekStart)}
          </Txt>
          {/* Disabled rather than hidden, so the heading does not shift about
              as you page back and forth. */}
          <PagerArrow
            label="Next week"
            glyph="chevron-right"
            disabled={isThisWeek}
            onPress={() => setWeekStart(addDays(weekStart, 7))}
          />
        </View>

        {/* The ruled head: weekday over day-of-month, in tabular figures so the
            columns line up with the boxes beneath them. */}
        <View
          style={{
            flexDirection: 'row',
            gap: GUTTER,
            paddingTop: space.sm,
            paddingBottom: space.xs,
            borderBottomWidth: 1,
            borderBottomColor: colors.rule,
          }}
        >
          {days.map((date) => (
            <View key={date} style={{ flex: 1, alignItems: 'center', gap: 1 }}>
              <Txt variant="label" tone={date === today ? 'default' : 'faint'}>
                {weekdayShort(date).slice(0, 1)}
              </Txt>
              <Txt variant="mono" tone={date === today ? 'default' : 'faint'}>
                {String(dayOfMonth(date))}
              </Txt>
            </View>
          ))}
        </View>

        {rows.length === 0 ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
              {isThisWeek
                ? 'Nothing is due this week.'
                : `Nothing was due the week of ${formatDayShort(weekStart)}.`}
            </Txt>
          </View>
        ) : (
          <Stack gap={0}>
            {rows.map((row) => (
              <ChartRowView
                key={row.choreId}
                row={row}
                today={today}
                inkFor={inkFor}
                onTap={onTap}
              />
            ))}
          </Stack>
        )}

        {rows.length === 0 ? null : <Key />}
      </ScrollView>
    </SafeAreaView>
  );
}

/** `28 Sep – 4 Oct`, and just `28 – 30 September` when the week does not straddle one. */
function weekLabel(weekStart: CivilDate): string {
  const end = addDays(weekStart, 6);
  const sameMonth = monthName(weekStart) === monthName(end);
  if (sameMonth) {
    return `${dayOfMonth(weekStart)}–${dayOfMonth(end)} ${monthName(weekStart)}`;
  }
  return `${formatDayShort(weekStart).slice(4)} – ${formatDayShort(end).slice(4)}`;
}

function ChartRowView({
  row,
  today,
  inkFor,
  onTap,
}: {
  row: ChartRow;
  today: CivilDate;
  inkFor: (userId: string | null) => string | null;
  onTap: (cell: ChartCell) => void;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.rule,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: space.sm,
          paddingBottom: space.xs,
        }}
      >
        {/* The title above the strip rather than beside it. Beside it, seven
            44pt boxes plus a readable name do not fit across an iPhone 14, and
            the boxes are what has to stay tappable. */}
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
          {row.choreTitle}
        </Txt>
        <Txt variant="mono" tone="faint">
          {`${row.done}/${row.due}`}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', gap: GUTTER }}>
        {row.cells.map((cell) => (
          <Box
            key={cell.date}
            cell={cell}
            title={row.choreTitle}
            isToday={cell.date === today}
            inkFor={inkFor}
            onPress={() => onTap(cell)}
          />
        ))}
      </View>
    </View>
  );
}

function Box({
  cell,
  title,
  isToday,
  inkFor,
  onPress,
}: {
  cell: ChartCell;
  title: string;
  isToday: boolean;
  inkFor: (userId: string | null) => string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const doneBy = cell.items[0]?.completedBy ?? null;
  const ink = inkFor(doneBy);

  const base = {
    flex: 1,
    minHeight: MIN_TARGET,
    borderRadius: radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: 'transparent',
    // Today's column is tinted rather than outlined. An outline would compete
    // with the one that means "due today and not done".
    backgroundColor: isToday ? colors.sunken : 'transparent',
  };

  const style = (() => {
    switch (cell.state) {
      case 'done':
        // The doer's own ink; the overprint when they have since left, because
        // the household still did it.
        return { ...base, backgroundColor: ink ?? colors.overprint, borderColor: 'transparent' };
      case 'today':
        return { ...base, borderWidth: 1.6, borderColor: colors.text };
      case 'missed':
        return { ...base, borderWidth: 1.6, borderColor: colors.overdue };
      case 'ahead':
        return { ...base, borderColor: colors.rule };
      case 'skipped':
        return { ...base, borderColor: colors.rule };
      case 'none':
        return base;
    }
  })();

  const mark = (() => {
    switch (cell.state) {
      case 'done':
        return (
          <Txt variant="bodyStrong" style={{ color: colors.paper }}>
            ✓
          </Txt>
        );
      case 'skipped':
        return (
          <Txt variant="mono" tone="faint">
            –
          </Txt>
        );
      case 'none':
        // A dot, not nothing. Seven boxes with three blanks in the middle read
        // as a broken layout; a faint dot reads as "not due".
        return (
          <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: colors.rule }} />
        );
      case 'today':
      case 'missed':
      case 'ahead':
        return null;
    }
  })();

  if (cell.tap === null) {
    return (
      <View style={style} accessibilityLabel={describe(cell, title)} accessible>
        {mark}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={style}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: cell.state === 'done' }}
      accessibilityLabel={describe(cell, title)}
      accessibilityHint={
        cell.tap === 'complete'
          ? 'Marks it done on that day, which keeps the cycle where it is'
          : 'Undoes it'
      }
    >
      {mark}
    </Pressable>
  );
}

/** What a screen reader says about one box. */
function describe(cell: ChartCell, title: string): string {
  const day = formatDayShort(cell.date);
  switch (cell.state) {
    case 'done':
      return `${title}, ${day}, done`;
    case 'skipped':
      return `${title}, ${day}, skipped`;
    case 'today':
      return `${title}, due today, not done`;
    case 'missed':
      return `${title}, ${day}, not done`;
    case 'ahead':
      return `${title}, due ${day}`;
    case 'none':
      return `${title}, not due ${day}`;
  }
}

/**
 * The legend.
 *
 * Six box styles is more than anybody reads off a grid unaided, and the one
 * that matters — a filled box is in the ink of whoever did it — is the whole
 * point of using ink at all.
 */
function Key() {
  const { colors } = useTheme();
  const swatch = (extra: object) => (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: colors.rule,
        ...extra,
      }}
    />
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: space.md,
        paddingTop: space.lg,
        paddingHorizontal: space.sm,
      }}
    >
      <Legend swatch={swatch({ backgroundColor: colors.overprint, borderColor: 'transparent' })}>
        Done — in their ink
      </Legend>
      <Legend swatch={swatch({ borderColor: colors.overdue, borderWidth: 1.6 })}>Not done</Legend>
      <Legend swatch={swatch({ borderColor: colors.text, borderWidth: 1.6 })}>Due today</Legend>
    </View>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      {swatch}
      <Txt variant="small" tone="faint">
        {children}
      </Txt>
    </View>
  );
}
