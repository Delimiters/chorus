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
import { useUserId } from '@/stores/sessionStore';
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
  const userId = useUserId();
  const today = useToday(household.data?.timeZone ?? 'UTC');
  const toggle = useToggleCompletion();

  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as Weekday;
  const thisWeek = startOfWeek(today, weekStartsOn);

  /*
   * How many weeks back you have paged — **not** the week itself.
   *
   * Storing the date looked equivalent and was not. `weekStartsOn` arrives with
   * the household, a fetch later than the first render, so seeding state from
   * it captures the placeholder: this household starts its week on Monday, the
   * chart opened on a Sunday-to-Saturday grid, and "This week" never appeared
   * because the seeded date no longer equalled the one being computed. Caught
   * by looking at the screen; nothing was red.
   *
   * An offset has no such failure mode — the week is derived on every render,
   * so it corrects itself the moment the household lands, and paging back stays
   * where you put it.
   */
  const [weeksBack, setWeeksBack] = useState(0);
  const weekStart = addDays(thisWeek, -7 * weeksBack);
  const isThisWeek = weeksBack === 0;

  /*
   * The query window is deliberately much wider than the week on screen, and
   * grows in eight-week steps rather than moving with every page.
   *
   * A window of exactly the seven days shown produced a new query key on every
   * tap of the arrow, so `isLoading` went true and the whole screen — heading
   * and both arrows included — was replaced by a spinner. The arrow you needed
   * to page again had gone. `weekChart` already ignores occurrences outside its
   * seven days, which is what makes over-fetching free here.
   */
  const span = (Math.floor(weeksBack / 8) + 1) * 8;
  const window = useMemo(
    () => ({ start: addDays(thisWeek, -7 * span), end: addDays(thisWeek, 6) }),
    [thisWeek, span],
  );
  const { items, isLoading, error } = useOccurrences(window);

  const rows = useMemo(
    () => weekChart(items, { weekStart, today, userId }),
    [items, weekStart, today, userId],
  );
  const totals = useMemo(() => weekTotals(rows), [rows]);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  const inkFor = (userId: string | null): string | null => {
    if (userId === null) return null;
    const member = (members.data ?? []).find((m) => m.userId === userId);
    return member === undefined ? null : inkColor(member.accent, isDark);
  };

  const onTap = (cell: ChartCell): void => {
    if (cell.target === null || cell.tap === null) return;
    toggle.mutate({
      item: cell.target,
      complete: cell.tap === 'complete',
      completedOn: cell.date,
    });
  };

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
            onPress={() => setWeeksBack(weeksBack + 1)}
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
            onPress={() => setWeeksBack(Math.max(0, weeksBack - 1))}
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

        {/* Above the rows, not below them. A household with a hundred chores
            has a legend nobody will ever scroll to. */}
        {isLoading || rows.length === 0 ? null : <Key />}

        {isLoading ? (
          /* Inside the scroll view, so the heading and both arrows stay put.
             Replacing the screen took away the arrow you needed to page on. */
          <LoadingState label="Working out the week" />
        ) : rows.length === 0 ? (
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
              <ChartRowView key={row.choreId} row={row} inkFor={inkFor} onTap={onTap} />
            ))}
          </Stack>
        )}
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
  inkFor,
  onTap,
}: {
  row: ChartRow;
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
  inkFor,
  onPress,
}: {
  cell: ChartCell;
  title: string;
  inkFor: (userId: string | null) => string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  /*
   * Whose ink a finished box wears.
   *
   * One person's ink when one person did all of it, and the overprint when
   * both had a share — which is what the overprint means everywhere else in
   * the app. Reading `items[0]` painted a shared day solid blue, so a box two
   * people had each done half of claimed one of them did it.
   */
  const doers = new Set(cell.items.map((item) => item.completedBy));
  const ink = doers.size === 1 ? inkFor([...doers][0] ?? null) : null;

  const base = {
    flex: 1,
    minHeight: MIN_TARGET,
    borderRadius: radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: 'transparent',
    /*
     * No tinted column for today.
     *
     * Two goes at one. `sunken` was #F4F4F1 against #F3F2EE paper — a one-unit
     * difference that rendered as nothing. `raised` was visible and worse: on a
     * day the chore was not due it painted a solid grey block, which outweighed
     * every real box on the row and read as a state of its own.
     *
     * Today is already marked twice — the bold date in the head, and the one
     * box on the grid that lifts off the paper. A third marker was competing
     * with both.
     */
    backgroundColor: 'transparent',
  };

  const style = (() => {
    switch (cell.state) {
      case 'done':
        // The doer's own ink; the overprint when they have since left, because
        // the household still did it.
        return { ...base, backgroundColor: ink ?? colors.overprint, borderColor: 'transparent' };
      /*
       * Three weights, not three colours.
       *
       * `colors.overdue` is deliberately *the same value* as `colors.text` —
       * the design system's position is that a red wash makes an ordinary
       * Tuesday feel like an incident. On a list that works, because lateness
       * is spelled out beside the row. On a grid there is no text, so the two
       * states rendered as literally the same box and the legend showed two
       * identical swatches.
       *
       * So today's box is the only one that lifts off the paper, missed is a
       * firm ring, and a day still to come is a hairline. No new colour, and
       * the "outlined, not red" decision stands.
       */
      case 'today':
        return {
          ...base,
          borderWidth: 2,
          borderColor: colors.text,
          backgroundColor: colors.surface,
        };
      case 'missed':
        return { ...base, borderWidth: 1.6, borderColor: colors.textMuted };
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
        paddingTop: space.md,
        paddingBottom: space.xs,
        paddingHorizontal: space.sm,
      }}
    >
      <Legend swatch={swatch({ backgroundColor: colors.overprint, borderColor: 'transparent' })}>
        Done — in their ink
      </Legend>
      <Legend swatch={swatch({ borderColor: colors.textMuted, borderWidth: 1.6 })}>Missed</Legend>
      <Legend
        swatch={swatch({
          borderColor: colors.text,
          borderWidth: 2,
          backgroundColor: colors.surface,
        })}
      >
        Due today
      </Legend>
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
